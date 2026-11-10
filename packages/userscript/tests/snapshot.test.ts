import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { createSnapshot } from '../src/core/snapshot'

const FAST = { timeout: 20 }

function snapshotFrames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('[data-element-screenshot-snapshot]'))
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('page snapshot', () => {
  it('copies the page into an off-screen frame and detaches it again', async () => {
    document.body.innerHTML = '<main id="app"><p class="lead">hello</p></main>'
    const snapshot = await createSnapshot(FAST)

    expect(snapshot.doc).not.toBe(document)
    expect(snapshot.target).toBeNull()
    expect(snapshot.doc.querySelector('.lead')?.textContent).toBe('hello')
    const frame = snapshotFrames()[0]
    expect(frame).toBeTruthy()
    // The frame has to take part in layout, so it is moved off screen instead of
    // being hidden with `display: none`.
    expect(frame?.style.getPropertyValue('display')).toBe('block')
    expect(frame?.style.getPropertyValue('visibility')).toBe('visible')

    snapshot.dispose()
    expect(snapshotFrames()).toHaveLength(0)
  })

  it('drops scripts and noscript fallbacks', async () => {
    document.body.innerHTML = `
      <div id="root">visible</div>
      <script>window.__ran = true</script>
      <noscript><p>fallback</p></noscript>
    `
    const snapshot = await createSnapshot(FAST)
    expect(snapshot.doc.querySelector('script')).toBeNull()
    expect(snapshot.doc.querySelector('noscript')).toBeNull()
    expect(snapshot.doc.querySelector('#root')?.textContent).toBe('visible')
    snapshot.dispose()
  })

  it('honours the per-element skip callback', async () => {
    document.body.innerHTML = '<div id="keep">keep</div><div id="drop">drop</div>'
    const snapshot = await createSnapshot({
      ...FAST,
      skip: (element) => element.id === 'drop'
    })
    expect(snapshot.doc.querySelector('#keep')).toBeTruthy()
    expect(snapshot.doc.querySelector('#drop')).toBeNull()
    snapshot.dispose()
  })

  it('resolves the requested element inside the snapshot', async () => {
    document.body.innerHTML = '<section><span id="target">pick me</span></section>'
    const target = document.getElementById('target')
    const snapshot = await createSnapshot({ ...FAST, target: target ?? undefined })
    expect(snapshot.target).toBeTruthy()
    expect(snapshot.target).not.toBe(target)
    expect(snapshot.target?.textContent).toBe('pick me')
    expect(snapshot.target?.ownerDocument).toBe(snapshot.doc)
    snapshot.dispose()
  })

  it('resolves the document element as a target too', async () => {
    document.body.innerHTML = '<div id="anything">full page</div>'
    const snapshot = await createSnapshot({ ...FAST, target: document.documentElement })
    expect(snapshot.target).toBe(snapshot.doc.documentElement)
    snapshot.dispose()
  })

  it('reports a copy whose cascade disagrees with the page', async () => {
    document.body.innerHTML = '<div id="target">text</div>'
    const target = document.getElementById('target')
    const pageStyle = {
      getPropertyValue: (property: string) => (property === 'padding-left' ? '16px' : '0px')
    } as CSSStyleDeclaration
    const copyStyle = {
      getPropertyValue: (property: string) => (property === 'padding-left' ? '0px' : '0px')
    } as CSSStyleDeclaration
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element: Element) =>
      element.ownerDocument === document ? pageStyle : copyStyle
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const snapshot = await createSnapshot({ ...FAST, target: target ?? undefined })
    const copy = snapshot.doc.getElementById('target') as HTMLElement

    // Reported, not patched: the fix belongs in the copy itself.
    expect(warn).toHaveBeenCalledWith(
      '[element-screenshot] snapshot cascade differs from the page',
      expect.objectContaining({ element: 'div' })
    )
    expect(copy.style.getPropertyValue('padding-left')).toBe('')
    snapshot.dispose()
  })

  it('stays quiet when the cascade matches', async () => {
    document.body.innerHTML = '<div id="target" style="padding-left: 8px">text</div>'
    const target = document.getElementById('target')
    const same = {
      getPropertyValue: (property: string) => (property === 'padding-left' ? '8px' : '0px')
    } as CSSStyleDeclaration
    vi.spyOn(native, 'getComputedStyle').mockReturnValue(same)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const snapshot = await createSnapshot({ ...FAST, target: target ?? undefined })
    const copy = snapshot.doc.getElementById('target') as HTMLElement

    expect(copy.style.getPropertyValue('padding-left')).toBe('8px')
    expect(warn).not.toHaveBeenCalled()
    snapshot.dispose()
  })

  it('replays rules that the page added with insertRule', async () => {
    document.head.innerHTML = '<style id="atoms">.a { color: red }</style>'
    document.body.innerHTML = '<div id="target" class="a b">text</div>'
    const sheet = (document.getElementById('atoms') as HTMLStyleElement).sheet
    // The rule exists only in the CSSOM, never in the <style> text.
    sheet?.insertRule('.b { padding-left: 16px; }', sheet.cssRules.length)

    const snapshot = await createSnapshot(FAST)
    const style = snapshot.doc.getElementById('atoms')

    expect(style?.textContent).toContain('.b')
    expect(style?.textContent).toContain('padding-left: 16px')
    snapshot.dispose()
  })

  it('keeps a base element so relative urls resolve like the page', async () => {
    document.body.innerHTML = '<div>base</div>'
    const snapshot = await createSnapshot(FAST)
    const base = snapshot.doc.querySelector('base')
    expect(base?.getAttribute('href')).toBe(document.baseURI)
    snapshot.dispose()
  })

  it('carries form state into the copy', async () => {
    document.body.innerHTML = `
      <input id="text" value="typed">
      <input id="check" type="checkbox" checked>
      <textarea id="area"></textarea>
      <select id="select"><option>a</option><option>b</option></select>
    `
    const text = document.getElementById('text') as HTMLInputElement
    text.value = 'edited'
    const area = document.getElementById('area') as HTMLTextAreaElement
    area.value = 'multi\nline'
    const select = document.getElementById('select') as HTMLSelectElement
    select.selectedIndex = 1

    const snapshot = await createSnapshot(FAST)
    const copyText = snapshot.doc.getElementById('text') as HTMLInputElement
    const copyCheck = snapshot.doc.getElementById('check') as HTMLInputElement
    const copyArea = snapshot.doc.getElementById('area') as HTMLTextAreaElement
    const copySelect = snapshot.doc.getElementById('select') as HTMLSelectElement

    expect(copyText.getAttribute('value')).toBe('edited')
    expect(copyCheck.hasAttribute('checked')).toBe(true)
    expect(copyArea.textContent).toBe('multi\nline')
    expect(copySelect.options[1]!.hasAttribute('selected')).toBe(true)
    expect(copySelect.options[0]!.hasAttribute('selected')).toBe(false)
    snapshot.dispose()
  })

  it('replays scroll offsets onto the copy', async () => {
    document.body.innerHTML = '<div id="pane" style="overflow:auto"></div>'
    const pane = document.getElementById('pane') as HTMLElement
    Object.defineProperty(pane, 'scrollTop', { configurable: true, value: 120 })
    Object.defineProperty(pane, 'scrollLeft', { configurable: true, value: 8 })

    const snapshot = await createSnapshot(FAST)
    const copy = snapshot.doc.getElementById('pane') as HTMLElement
    expect(copy.scrollTop).toBe(120)
    expect(copy.scrollLeft).toBe(8)
    snapshot.dispose()
  })

  it('rebuilds open shadow roots inside the copy', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    const host = document.getElementById('host')
    const shadow = host?.attachShadow({ mode: 'open' })
    if (!shadow) throw new Error('shadow root missing')
    shadow.innerHTML = '<style>:host{display:block}</style><b>shadowed</b>'

    const snapshot = await createSnapshot(FAST)
    const copy = snapshot.doc.getElementById('host')
    expect(copy?.shadowRoot).toBeTruthy()
    expect(copy?.shadowRoot?.querySelector('b')?.textContent).toBe('shadowed')
    expect(copy?.shadowRoot?.querySelector('style')).toBeTruthy()
    snapshot.dispose()
  })

  it('replays rules that a shadow-root style gained with insertRule', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    const shadow = document.getElementById('host')?.attachShadow({ mode: 'open' })
    if (!shadow) throw new Error('shadow root missing')
    shadow.innerHTML = '<style>.card { color: red }</style><p class="card">shadowed</p>'
    const style = shadow.querySelector('style') as HTMLStyleElement
    style.sheet?.insertRule('.card { padding-left: 16px }', style.sheet.cssRules.length)
    // Mirrors the x.com case: the rule exists only in the CSSOM.
    expect(style.textContent).not.toContain('padding-left')

    const snapshot = await createSnapshot(FAST)
    const copyStyle = snapshot.doc.getElementById('host')?.shadowRoot?.querySelector('style')
    expect(copyStyle?.textContent).toContain('color: red')
    expect(copyStyle?.textContent).toContain('padding-left: 16px')
    snapshot.dispose()
  })

  it('replays nested shadow roots and the styles they rewrite', async () => {
    document.body.innerHTML = '<div id="outer"></div>'
    const outer = document.getElementById('outer')?.attachShadow({ mode: 'open' })
    if (!outer) throw new Error('shadow root missing')
    outer.innerHTML = '<style>.outer { color: red }</style><div id="inner"></div>'
    const inner = outer.querySelector('#inner')?.attachShadow({ mode: 'open' })
    if (!inner) throw new Error('nested shadow root missing')
    inner.innerHTML = '<style>.inner { color: blue }</style><b class="inner">deep</b>'
    const style = inner.querySelector('style') as HTMLStyleElement
    style.sheet?.insertRule('.inner { margin-left: 4px }', style.sheet.cssRules.length)

    const snapshot = await createSnapshot(FAST)
    const copyOuter = snapshot.doc.getElementById('outer')?.shadowRoot
    const copyInner = copyOuter?.querySelector('#inner')?.shadowRoot
    expect(copyInner?.querySelector('b')?.textContent).toBe('deep')
    expect(copyInner?.querySelector('style')?.textContent).toContain('margin-left: 4px')
    snapshot.dispose()
  })

  it('clears shadow-root rules the page deleted', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    const shadow = document.getElementById('host')?.attachShadow({ mode: 'open' })
    if (!shadow) throw new Error('shadow root missing')
    shadow.innerHTML = '<style>.gone { color: red }</style><p class="gone">text</p>'
    const style = shadow.querySelector('style') as HTMLStyleElement
    style.sheet?.deleteRule(0)

    const snapshot = await createSnapshot(FAST)
    const copyStyle = snapshot.doc.getElementById('host')?.shadowRoot?.querySelector('style')
    expect(copyStyle?.textContent).toBe('')
    snapshot.dispose()
  })

  it('leaves a canvas without readable pixels as an element with its box', async () => {
    document.body.innerHTML = '<canvas id="chart" width="60" height="40"></canvas>'
    const canvas = document.getElementById('chart') as HTMLCanvasElement
    canvas.toDataURL = () => 'data:,'

    const snapshot = await createSnapshot(FAST)
    const copy = snapshot.doc.getElementById('chart')
    expect(copy?.tagName).toBe('CANVAS')
    expect(copy?.getAttribute('width')).toBe('60')
    snapshot.dispose()
  })

  it('swaps a drawable canvas for an image', async () => {
    document.body.innerHTML = '<canvas id="chart" width="4" height="4" class="plot"></canvas>'
    const canvas = document.getElementById('chart') as HTMLCanvasElement
    canvas.toDataURL = () => 'data:image/png;base64,AAAA'

    const snapshot = await createSnapshot(FAST)
    const copy = snapshot.doc.getElementById('chart')
    expect(copy?.tagName).toBe('IMG')
    expect(copy?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(copy?.getAttribute('class')).toBe('plot')
    snapshot.dispose()
  })

  it('drops the frame when the copy fails', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument')
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
      configurable: true,
      get: () => null
    })
    try {
      await expect(createSnapshot(FAST)).rejects.toThrow(/no document/)
      expect(snapshotFrames()).toHaveLength(0)
    } finally {
      if (original) Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', original)
      else Reflect.deleteProperty(HTMLIFrameElement.prototype, 'contentDocument')
    }
  })
})
