import { describe, expect, it, vi } from 'vitest'
import { createGMFetch, createGMXHRClass } from '../src/net/gm-fetch'
import type { GMRequest, GMRequestOptions } from '../src/net/gm-fetch'

function requestWithBlob(body = 'hello'): GMRequest {
  return (details) => {
    setTimeout(() => {
      details.onload?.({
        status: 200,
        statusText: 'OK',
        responseHeaders: 'Content-Type: text/plain\r\nX-Test: yes',
        response: new Blob([body], { type: 'text/plain' }),
        finalUrl: details.url
      })
    }, 0)
    return { abort: vi.fn() }
  }
}

describe('GM fetch adapter', () => {
  it('resolves a Response with headers, status and body', async () => {
    const fetchFn = createGMFetch({ request: requestWithBlob() })
    const response = await fetchFn('https://example.com/data')
    expect(response.status).toBe(200)
    expect(response.statusText).toBe('OK')
    expect(response.headers.get('x-test')).toBe('yes')
    expect(await response.text()).toBe('hello')
  })

  it('resolves protocol-relative URLs before calling the manager', async () => {
    const seen: GMRequestOptions[] = []
    const fetchFn = createGMFetch({
      request: (details) => {
        seen.push(details)
        details.onload?.({ status: 200, response: new Blob(['']) })
        return { abort: vi.fn() }
      }
    })

    await fetchFn('//fonts.gstatic.com/font.woff2')
    expect(seen[0]?.url).toBe(new URL('//fonts.gstatic.com/font.woff2', location.href).href)
  })

  it('times out a manager request that never calls back', async () => {
    vi.useFakeTimers()
    try {
      const abort = vi.fn()
      const fetchFn = createGMFetch({
        request: () => ({ abort }),
        timeout: 1_000
      })
      const promise = fetchFn('https://example.com/stuck')
      const assertion = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(1_000)
      await assertion
      expect(abort).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes method, headers and body to the manager request', async () => {
    const seen: GMRequestOptions[] = []
    const request: GMRequest = (details) => {
      seen.push(details)
      details.onload?.({
        status: 201,
        responseHeaders: 'Content-Type: text/plain',
        response: new Blob(['ok'])
      })
      return { abort: vi.fn() }
    }

    const fetchFn = createGMFetch({ request })
    await fetchFn('https://example.com', {
      method: 'POST',
      headers: { 'X-Custom': '1' },
      body: 'a=1'
    })

    const details = seen[0]
    expect(details?.method).toBe('POST')
    expect(details?.data).toBe('a=1')
    expect(details?.headers).toMatchObject({ 'x-custom': '1' })
  })

  it('rejects network errors and ignores non-2xx status bodies', async () => {
    const fetchFn = createGMFetch({
      request: (details) => {
        details.onerror?.({ status: 0 })
        return { abort: vi.fn() }
      }
    })
    await expect(fetchFn('https://example.com/fail')).rejects.toThrow(/Network error/)

    const notFound = createGMFetch({
      request: (details) => {
        details.onload?.({
          status: 404,
          responseHeaders: 'Content-Type: text/plain',
          response: new Blob(['missing'])
        })
        return { abort: vi.fn() }
      }
    })
    const response = await notFound('https://example.com/missing')
    expect(response.status).toBe(404)
    expect(response.ok).toBe(false)
    expect(await response.text()).toBe('missing')
  })

  it('aborts the manager request through AbortSignal', async () => {
    const abort = vi.fn()
    const fetchFn = createGMFetch({
      request: (details) => ({
        abort: () => {
          abort()
          details.onabort?.({ status: 0 })
        }
      })
    })
    const controller = new AbortController()
    const promise = fetchFn('https://example.com/slow', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalled()
  })
})

describe('GM XMLHttpRequest shim', () => {
  const request: GMRequest = (details) => {
    setTimeout(() => {
      details.onload?.({
        status: 200,
        statusText: 'OK',
        responseHeaders: 'Content-Type: text/plain\r\nX-Test: yes',
        response: new Blob([details.url.includes('json') ? '{"a":1}' : 'hello'], {
          type: 'text/plain'
        })
      })
    }, 0)
    return { abort: vi.fn() }
  }

  it('loads text responses and exposes headers', async () => {
    const GMXHR = createGMXHRClass(request)
    const xhr = new GMXHR()
    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve()
      xhr.onerror = () => reject(new Error('xhr failed'))
    })

    xhr.open('GET', 'https://example.com/text')
    xhr.responseType = 'text'
    xhr.send()

    await loaded
    expect(xhr.status).toBe(200)
    expect(xhr.statusText).toBe('OK')
    expect(xhr.responseText).toBe('hello')
    expect(xhr.response).toBe('hello')
    expect(xhr.getResponseHeader('x-test')).toBe('yes')
    expect(xhr.getAllResponseHeaders()).toContain('content-type')
    expect(xhr.readyState).toBe(4)
  })

  it('parses JSON responses', async () => {
    const GMXHR = createGMXHRClass(request)
    const xhr = new GMXHR()
    const loaded = new Promise<void>((resolve) => {
      xhr.onload = () => resolve()
    })
    xhr.open('GET', 'https://example.com/json')
    xhr.responseType = 'json'
    xhr.send()
    await loaded
    expect(xhr.response).toEqual({ a: 1 })
  })
})
