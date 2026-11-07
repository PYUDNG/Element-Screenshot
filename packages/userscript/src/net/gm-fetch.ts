export interface GMResponse {
  status: number
  statusText?: string
  responseHeaders?: string
  response?: unknown
  responseText?: string
  finalUrl?: string
}

export interface GMRequestOptions {
  method?: string
  url: string
  headers?: Record<string, string>
  data?: string
  responseType?: 'text' | 'arraybuffer' | 'blob' | 'json'
  timeout?: number
  anonymous?: boolean
  onload?: (response: GMResponse) => void
  onerror?: (response: GMResponse) => void
  ontimeout?: (response: GMResponse) => void
  onabort?: (response: GMResponse) => void
}

export interface GMRequestHandle {
  abort(): void
}

export type GMRequest = (options: GMRequestOptions) => GMRequestHandle

export interface GMFetchOptions {
  request: GMRequest
  /** Per-request timeout in milliseconds. */
  timeout?: number
}

export type GMFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function parseResponseHeaders(raw: string | undefined): Headers {
  const headers = new Headers()
  if (!raw) return headers

  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const name = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!name) continue
    try {
      headers.append(name, value)
    } catch {
      // Ignore malformed header names from the userscript manager.
    }
  }
  return headers
}

function toBodySource(init: RequestInit, request: Request | null): string | undefined {
  const body = init.body ?? request?.body
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return body
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
    return body.toString()
  throw new TypeError('[element-screenshot] GM fetch only supports text request bodies')
}

function withUrl(response: Response, url: string): Response {
  try {
    Object.defineProperty(response, 'url', { value: url, configurable: true })
  } catch {
    // Response.url is read-only in some engines; it is only used in error messages.
  }
  return response
}

/**
 * A `fetch`-compatible function backed by `GM_xmlhttpRequest`.
 *
 * html-to-image uses fetch for cross-origin images, stylesheets and fonts; the
 * userscript manager request bypasses the page CORS policy so those resources
 * can be inlined into the SVG canvas.
 */
export function createGMFetch(options: GMFetchOptions): GMFetch {
  const { request } = options
  const defaultTimeout = options.timeout ?? 20_000
  const nativeFetch =
    typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null

  return async function gmFetch(input, init = {}) {
    const requestInput = typeof Request !== 'undefined' && input instanceof Request ? input : null
    let url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (requestInput?.url ?? '')

    if (!url) throw new TypeError('[element-screenshot] GM fetch requires a URL')

    // html-to-image passes stylesheet URLs such as `//fonts.gstatic.com/...`
    // verbatim. GM_xmlhttpRequest needs an absolute URL; leaving it relative
    // can leave the request waiting without ever calling back.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      const base = globalThis.location?.href
      if (base) {
        try {
          url = new URL(url, base).href
        } catch {
          // Keep the original URL and let the request surface its error.
        }
      }
    }

    if (url.startsWith('data:')) {
      if (nativeFetch) return nativeFetch(url, init)
      throw new TypeError('[element-screenshot] data URLs require native fetch')
    }

    const method = (init.method ?? requestInput?.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    for (const [name, value] of new Headers(requestInput?.headers).entries()) {
      headers[name] = value
    }
    for (const [name, value] of new Headers(init.headers).entries()) {
      headers[name] = value
    }

    const data = toBodySource(init, requestInput)
    const anonymous = init.credentials === 'omit'
    const signal = init.signal

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    return new Promise<Response>((resolve, reject) => {
      let settled = false
      let handle: GMRequestHandle | null = null
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort)
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
      }

      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const succeed = (response: Response): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve(response)
      }

      function onAbort(): void {
        handle?.abort()
        fail(new DOMException('The operation was aborted.', 'AbortError'))
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      timer = setTimeout(() => {
        handle?.abort()
        fail(new DOMException('The operation timed out.', 'TimeoutError'))
      }, defaultTimeout)

      try {
        handle = request({
          method,
          url,
          headers,
          data,
          anonymous,
          timeout: defaultTimeout,
          responseType: 'blob',
          onload: (response) => {
            void (async () => {
              try {
                const status = Number(response.status) || 0
                if (status < 200 || status > 599) {
                  fail(new TypeError(`[element-screenshot] Request failed: ${status} ${url}`))
                  return
                }

                const responseHeaders = parseResponseHeaders(response.responseHeaders)
                const noBody =
                  method === 'HEAD' || status === 204 || status === 205 || status === 304
                const responseInit: ResponseInit = {
                  status,
                  statusText: response.statusText ?? '',
                  headers: responseHeaders
                }

                let body: BodyInit | null = null
                if (!noBody) {
                  const raw = response.response
                  if (raw instanceof Blob) {
                    body = await raw.arrayBuffer()
                  } else if (raw instanceof ArrayBuffer) {
                    body = raw
                  } else if (ArrayBuffer.isView(raw)) {
                    body = raw.buffer.slice(
                      raw.byteOffset,
                      raw.byteOffset + raw.byteLength
                    ) as ArrayBuffer
                  } else if (typeof raw === 'string') {
                    body = raw
                  } else if (typeof response.responseText === 'string') {
                    body = response.responseText
                  }
                }

                succeed(withUrl(new Response(body, responseInit), response.finalUrl ?? url))
              } catch (error) {
                fail(error)
              }
            })()
          },
          onerror: () => {
            fail(new TypeError(`[element-screenshot] Network error: ${url}`))
          },
          ontimeout: () => {
            fail(new TypeError(`[element-screenshot] Request timed out: ${url}`))
          },
          onabort: () => {
            fail(new DOMException('The operation was aborted.', 'AbortError'))
          }
        })
      } catch (error) {
        fail(error)
      }
    })
  }
}

function headersToString(headers: Headers): string {
  let output = ''
  headers.forEach((value, name) => {
    output += `${name}: ${value}\r\n`
  })
  return output
}

/**
 * Minimal XMLHttpRequest-shaped shim backed by `GM_xmlhttpRequest`.
 * Exposed so libraries that still use XHR can be routed through the manager.
 */
export function createGMXHRClass(request: GMRequest) {
  return class GMXMLHttpRequest {
    static readonly UNSENT = 0
    static readonly OPENED = 1
    static readonly HEADERS_RECEIVED = 2
    static readonly LOADING = 3
    static readonly DONE = 4

    readonly UNSENT = 0
    readonly OPENED = 1
    readonly HEADERS_RECEIVED = 2
    readonly LOADING = 3
    readonly DONE = 4

    readyState = 0
    status = 0
    statusText = ''
    response: unknown = null
    responseText = ''
    responseType = ''
    responseURL = ''
    withCredentials = false
    timeout = 0

    onreadystatechange: (() => void) | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    ontimeout: (() => void) | null = null

    private method = 'GET'
    private url = ''
    private headers: Record<string, string> = {}
    private handle: GMRequestHandle | null = null
    private aborted = false
    private responseHeaders = new Headers()

    open(method: string, url: string): void {
      this.method = method.toUpperCase()
      this.url = url
      this.readyState = 1
      this.onreadystatechange?.()
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value
    }

    getResponseHeader(name: string): string | null {
      return this.responseHeaders.get(name)
    }

    getAllResponseHeaders(): string {
      return headersToString(this.responseHeaders)
    }

    abort(): void {
      if (this.readyState === 4 || this.readyState === 0) return
      this.aborted = true
      this.handle?.abort()
      this.readyState = 4
      this.onreadystatechange?.()
      this.onabort?.()
    }

    send(body?: string | null): void {
      if (this.readyState !== 1) {
        throw new DOMException('XHR is not opened', 'InvalidStateError')
      }
      this.aborted = false

      const responseType =
        this.responseType === 'arraybuffer' || this.responseType === 'json'
          ? this.responseType === 'json'
            ? 'blob'
            : 'arraybuffer'
          : 'blob'

      this.handle = request({
        method: this.method,
        url: this.url,
        headers: this.headers,
        data: body ?? undefined,
        responseType,
        timeout: this.timeout || 60_000,
        onload: (response) => {
          if (this.aborted) return
          this.status = response.status
          this.statusText = response.statusText ?? ''
          this.responseHeaders = parseResponseHeaders(response.responseHeaders)
          this.responseURL = response.finalUrl ?? this.url
          this.readyState = 2
          this.onreadystatechange?.()
          this.readyState = 3
          this.onreadystatechange?.()

          const finish = (value: unknown): void => {
            this.response = value
            if (this.responseType === '' || this.responseType === 'text') {
              this.responseText = typeof value === 'string' ? value : ''
            }
            this.readyState = 4
            this.onreadystatechange?.()
            this.onload?.()
          }

          if (this.responseType === 'json') {
            const blob = response.response instanceof Blob ? response.response : null
            if (blob) {
              void blob.text().then((text) => {
                try {
                  finish(JSON.parse(text))
                } catch {
                  finish(null)
                }
              })
            } else {
              finish(null)
            }
            return
          }

          if (this.responseType === 'arraybuffer' && response.response instanceof ArrayBuffer) {
            finish(response.response)
            return
          }

          if (response.response instanceof Blob) {
            if (this.responseType === '' || this.responseType === 'text') {
              void response.response.text().then(finish)
            } else {
              finish(response.response)
            }
            return
          }

          finish(response.response ?? response.responseText ?? '')
        },
        onerror: () => {
          if (this.aborted) return
          this.readyState = 4
          this.onreadystatechange?.()
          this.onerror?.()
        },
        ontimeout: () => {
          if (this.aborted) return
          this.readyState = 4
          this.onreadystatechange?.()
          this.ontimeout?.()
        },
        onabort: () => {
          if (this.aborted) return
          this.aborted = true
          this.readyState = 4
          this.onreadystatechange?.()
          this.onabort?.()
        }
      })
    }
  }
}
