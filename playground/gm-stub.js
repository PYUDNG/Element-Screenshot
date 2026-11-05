/* Minimal GM_* shims for local playground testing. No userscript manager needed. */
;(() => {
  const PREFIX = 'gm:'
  const menus = []
  let menuId = 0

  const read = (key, fallback) => {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  window.GM_getValue = (key, fallback) => read(key, fallback)
  window.GM_setValue = (key, value) => {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  }
  window.GM_deleteValue = (key) => {
    localStorage.removeItem(PREFIX + key)
  }
  window.GM_registerMenuCommand = (label, onClick) => {
    menuId += 1
    menus.push({ id: menuId, label, onClick })
    window.__menuCommands = menus
    return menuId
  }
  window.GM_unregisterMenuCommand = (id) => {
    const index = menus.findIndex((menu) => menu.id === id)
    if (index >= 0) menus.splice(index, 1)
    window.__menuCommands = menus
  }
  window.GM_info = {
    script: { version: '0.1.1', name: 'Element Shot', namespace: 'playground' }
  }
  window.GM_xmlhttpRequest = (options) => {
    const controller = new AbortController()
    let aborted = false

    fetch(options.url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.data,
      credentials: 'include',
      signal: controller.signal
    })
      .then(async (response) => {
        const buffer = await response.arrayBuffer()
        const responseHeaders = [...response.headers.entries()]
          .map(([name, value]) => `${name}: ${value}`)
          .join('\r\n')
        const blob = new Blob([buffer], {
          type: response.headers.get('content-type') || ''
        })
        options.onload?.({
          status: response.status,
          statusText: response.statusText,
          responseHeaders,
          response: blob,
          finalUrl: response.url
        })
      })
      .catch((error) => {
        if (aborted) return
        options.onerror?.({ status: 0, error: String(error) })
      })

    return {
      abort() {
        aborted = true
        controller.abort()
      }
    }
  }

  window.__resetPlayground = () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
    }
    location.reload()
  }
})()
