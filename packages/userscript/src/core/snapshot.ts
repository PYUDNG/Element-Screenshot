import { native } from './native'

/**
 * Render target for one capture.
 *
 * html-to-image resolves the computed style of every node from the document it
 * renders, and both capture paths have to rewrite the page to do their job
 * (expand the scroll containers of an element, rebuild each scrolled pane as a
 * picture, hide what was already painted). Doing that on the live document locks
 * the user out of the page for the whole render — and any interaction in that
 * window corrupts the picture.
 *
 * A snapshot gives the renderer a private copy of the page inside an off-screen
 * same-origin iframe. The live page is only read, never written, so the capture
 * can yield to the event loop for as long as it needs while the user keeps
 * working, and there is nothing left to restore when it ends.
 */

const IGNORE_ATTRIBUTE = 'data-element-screenshot-ignore'
const SNAPSHOT_ATTRIBUTE = 'data-element-screenshot-snapshot'
/** Nodes that never paint, or must not run a second time inside the snapshot. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'NOSCRIPT'])
const DEFAULT_TIMEOUT = 8000
const FRAME_OFFSET = 400

export interface Snapshot {
  /** The snapshot document: hand this to the renderer instead of `native.document`. */
  readonly doc: Document
  readonly win: Window
  /** Counterpart of `options.target` inside the snapshot, if one was requested. */
  readonly target: Element | null
  /** Frames inside the copy whose pixels have to be composited separately. */
  readonly frames: FrameRecord[]
  /** Detach the iframe. The live page never needed restoring. */
  dispose(): void
}

export interface SnapshotOptions {
  /** Element to resolve inside the snapshot. */
  target?: Element
  /** Per-element veto, used to drop the script's own UI. */
  skip?: (element: Element) => boolean
  /** Budget for fonts and images, in milliseconds. */
  timeout?: number
}

/** The parts of a live element the snapshot builder reads. */
type LiveElement = Element & {
  shadowRoot?: ShadowRoot | null
  contentDocument?: Document | null
  adoptedStyleSheets?: CSSStyleSheet[]
  width?: number
  height?: number
  videoWidth?: number
  videoHeight?: number
  poster?: string
  value?: string
  checked?: boolean
  selectedIndex?: number
  scrollTop: number
  scrollLeft: number
}

interface ShadowPair {
  live: LiveElement
  clone: Element
  content: DocumentFragment
}

interface CloneContext {
  /** The live document, used to create the cloned nodes. */
  doc: Document
  pairs: Array<{ live: LiveElement; clone: Element }>
  shadows: ShadowPair[]
  frames: FrameRecord[]
  target: LiveElement | null
  targetClone: Element | null
  skip?: (element: Element) => boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    native.setTimeout(resolve, ms)
  })
}

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    native.setTimeout(finish, 100)
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(finish)
  })
}

function tagOf(element: Element): string {
  return element.tagName.toUpperCase()
}

/**
 * Flatten a stylesheet into text so it can ride along inside the snapshot.
 *
 * `null` means "unreadable" (a cross-origin sheet), which is different from an
 * empty string: an empty string is a real answer, and writing it into a copy
 * clears rules the page deleted with `deleteRule()`.
 */
function sheetText(sheet: CSSStyleSheet): string | null {
  try {
    return Array.from(sheet.cssRules)
      .map((rule) => rule.cssText)
      .join('\n')
  } catch (_error) {
    // A cross-origin sheet cannot be read; the snapshot does without it.
    return null
  }
}

function mediaDataUrl(element: LiveElement, ctx: CloneContext): string {
  try {
    if (tagOf(element) === 'VIDEO') {
      const video = element as HTMLVideoElement
      const canvas = ctx.doc.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth || video.clientWidth))
      canvas.height = Math.max(1, Math.round(video.videoHeight || video.clientHeight))
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      const frame = canvas.toDataURL()
      if (frame !== 'data:,') return frame
      return video.poster || ''
    }
    const canvas = element as HTMLCanvasElement
    const dataUrl = canvas.toDataURL()
    return dataUrl === 'data:,' ? '' : dataUrl
  } catch (_error) {
    // A tainted canvas or a cross-origin video has no readable pixels. Keep the
    // element's box so the layout stays intact and let it paint blank.
    return tagOf(element) === 'VIDEO' ? String((element as LiveElement).poster ?? '') : ''
  }
}

/**
 * A cloned `<canvas>` carries no bitmap and a cloned `<video>` carries no frame,
 * so both are replaced by an image with the same attributes (and therefore the
 * same box). Tainted sources keep the original element, which paints empty.
 */
function mediaClone(element: LiveElement, ctx: CloneContext): Element {
  const dataUrl = mediaDataUrl(element, ctx)
  const clone = element.cloneNode(false) as Element
  if (!dataUrl) return clone

  const image = ctx.doc.createElement('img')
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'src' || attribute.name === 'srcset') continue
    image.setAttribute(attribute.name, attribute.value)
  }
  image.setAttribute('src', dataUrl)
  return image
}

function applyFormState(live: LiveElement, clone: Element): void {
  const tag = tagOf(live)
  if (tag === 'INPUT') {
    const input = live as HTMLInputElement
    clone.setAttribute('value', input.value)
    if (input.checked) clone.setAttribute('checked', '')
    return
  }
  if (tag === 'TEXTAREA') {
    clone.textContent = (live as HTMLTextAreaElement).value
    return
  }
  if (tag === 'SELECT') {
    const select = live as HTMLSelectElement
    const options = clone.querySelectorAll('option')
    const selected = select.selectedIndex
    options.forEach((option, index) => {
      if (index === selected) option.setAttribute('selected', '')
      else option.removeAttribute('selected')
    })
  }
}

/**
 * A `<style>` inside a shadow root can gain or lose rules at runtime through
 * `CSSStyleSheet.insertRule()`. Those rules live only in the CSSOM, so cloned
 * markup would be stale — copy the sheet itself, the way `copyStyleSheets()`
 * does for the light DOM (which `querySelectorAll('style')` cannot reach).
 */
function replayShadowStyle(live: Node, clone: Node): void {
  if (live.nodeType !== 1 || tagOf(live as Element) !== 'STYLE') return
  const sheet = (live as HTMLStyleElement).sheet
  if (!sheet) return
  const text = sheetText(sheet)
  if (text === null) return
  ;(clone as Element).textContent = text
}

function collectShadow(live: LiveElement, clone: Element, ctx: CloneContext): void {
  const shadow = live.shadowRoot
  if (!shadow || shadow.mode !== 'open') return

  const content = ctx.doc.createDocumentFragment()
  for (const sheet of Array.from(shadow.adoptedStyleSheets ?? [])) {
    const style = ctx.doc.createElement('style')
    style.textContent = sheetText(sheet) ?? ''
    content.append(style)
  }
  for (const child of shadow.childNodes) {
    const cloned = cloneNodeAny(child, ctx)
    if (!cloned) continue
    replayShadowStyle(child, cloned)
    content.append(cloned)
  }
  ctx.shadows.push({ live, clone, content })
}

/**
 * A frame whose content has to be rendered on its own and composited into the
 * result. Cloning the frame body into a nested `<iframe>` never reached the
 * picture (html-to-image clones an `<iframe>` without its browsing context), so
 * the copy keeps an empty box and the renderer fills it in later.
 */
export interface FrameRecord {
  /** The live frame, kept for its content document and current viewport. */
  live: HTMLIFrameElement
  /** Content box in viewport coordinates, borders and padding excluded. */
  rect: { left: number; top: number; width: number; height: number }
  /** Corner radii in pixels, for clipping the composited picture. */
  radius: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }
  /** Null for a cross-origin frame, whose pixels need a helper instance. */
  doc: Document | null
}

function parsePx(value: string | undefined | null): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function frameStyle(element: Element): CSSStyleDeclaration | null {
  try {
    return native.getComputedStyle(element)
  } catch (_error) {
    return null
  }
}

function frameDocument(frame: Element): Document | null {
  try {
    // A cross-origin frame throws (or answers null) and needs a helper.
    return (frame as HTMLIFrameElement).contentDocument ?? null
  } catch (_error) {
    return null
  }
}

function collectFrame(live: LiveElement, clone: HTMLIFrameElement, ctx: CloneContext): void {
  // The snapshot must not fetch the frame's URL again: that would run the page a
  // second time (and may be slow). The copy keeps an empty box of the same size.
  clone.removeAttribute('src')
  clone.removeAttribute('srcdoc')

  const rect = native.getBoundingClientRect(live)
  const style = frameStyle(live)
  const inside = {
    left: parsePx(style?.borderLeftWidth) + parsePx(style?.paddingLeft),
    top: parsePx(style?.borderTopWidth) + parsePx(style?.paddingTop),
    right: parsePx(style?.borderRightWidth) + parsePx(style?.paddingRight),
    bottom: parsePx(style?.borderBottomWidth) + parsePx(style?.paddingBottom)
  }

  ctx.frames.push({
    live: live as unknown as HTMLIFrameElement,
    rect: {
      left: rect.left + inside.left,
      top: rect.top + inside.top,
      width: Math.max(1, Math.round(rect.width - inside.left - inside.right)),
      height: Math.max(1, Math.round(rect.height - inside.top - inside.bottom))
    },
    radius: {
      topLeft: parsePx(style?.borderTopLeftRadius),
      topRight: parsePx(style?.borderTopRightRadius),
      bottomRight: parsePx(style?.borderBottomRightRadius),
      bottomLeft: parsePx(style?.borderBottomLeftRadius)
    },
    doc: frameDocument(live)
  })
}

function cloneElement(live: LiveElement, ctx: CloneContext): Element | null {
  if (SKIPPED_TAGS.has(tagOf(live))) return null
  // Never copy the capture machinery itself (the off-screen snapshot frame).
  if (live.hasAttribute?.(SNAPSHOT_ATTRIBUTE) || live.hasAttribute?.(IGNORE_ATTRIBUTE)) return null
  if (ctx.skip?.(live)) return null

  const tag = tagOf(live)
  if (tag === 'CANVAS' || tag === 'VIDEO') {
    const media = mediaClone(live, ctx)
    if (ctx.target && live === ctx.target) ctx.targetClone = media
    ctx.pairs.push({ live, clone: media })
    return media
  }

  const clone = live.cloneNode(false) as Element
  if (tag === 'IFRAME') collectFrame(live, clone as HTMLIFrameElement, ctx)
  collectShadow(live, clone, ctx)

  for (const child of Array.from(live.childNodes)) {
    const cloned = cloneNodeAny(child, ctx)
    if (cloned) clone.append(cloned)
  }
  // Select state needs the options to exist, so this runs after the children.
  applyFormState(live, clone)

  if (ctx.target && live === ctx.target) ctx.targetClone = clone
  ctx.pairs.push({ live, clone })
  return clone
}

function cloneNodeAny(node: Node, ctx: CloneContext): Node | null {
  switch (node.nodeType) {
    case 1:
      return cloneElement(node as LiveElement, ctx)
    case 3:
      return node.cloneNode(false)
    case 8:
      // Comments never paint and only inflate the serialized SVG.
      return null
    default:
      return node.cloneNode(false)
  }
}

/** Attach the collected shadow trees. */
function attachDeferred(ctx: CloneContext): void {
  for (const shadow of ctx.shadows) {
    try {
      const root = shadow.clone.shadowRoot ?? shadow.clone.attachShadow({ mode: 'open' })
      // A custom element constructor runs when its clone is created and may have
      // built a shadow tree of its own; the collected content is the faithful
      // copy, so it replaces whatever the constructor produced.
      root.replaceChildren(shadow.content)
    } catch (error) {
      console.warn('[element-screenshot] snapshot shadow root failed', error)
    }
  }
}

/** Put every scroll offset back, including the window's. */
function restoreScroll(ctx: CloneContext, liveWin: Window, win: Window): void {
  // With scroll offset zero there is nothing to replay, and some engines do not
  // implement `scrollTo` at all (jsdom logs "Not implemented" and moves on).
  if (liveWin.scrollX || liveWin.scrollY) {
    try {
      win.scrollTo({ left: liveWin.scrollX, top: liveWin.scrollY, behavior: 'instant' })
    } catch (_error) {
      // A missing window method leaves the snapshot at scroll offset zero.
    }
  }
  for (const { live, clone } of ctx.pairs) {
    const top = Number(live.scrollTop) || 0
    const left = Number(live.scrollLeft) || 0
    if (!top && !left) continue
    try {
      clone.scrollTop = top
      clone.scrollLeft = left
    } catch (_error) {
      // Not scrollable in the snapshot: nothing to replay.
    }
  }
}

/** Resolve once a link either applied its sheet or failed to load. */
function linkReady(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    if (link.sheet) {
      resolve()
      return
    }
    const done = (): void => {
      link.removeEventListener('load', done)
      link.removeEventListener('error', done)
      resolve()
    }
    link.addEventListener('load', done)
    link.addEventListener('error', done)
  })
}

/** Properties that decide where the content starts and how text measures. */
const CASCADE_PROBES = [
  'box-sizing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-left-width',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing'
] as const

/**
 * The copy can still miss a rule the page applies (a shadow-root sheet, a class
 * set by page script). Report it instead of silently patching: the root cause
 * belongs in the copy, and a log is what a bug report needs.
 */
function reportCascadeMismatch(live: Element, clone: Element): void {
  let liveStyle: CSSStyleDeclaration
  let cloneStyle: CSSStyleDeclaration
  try {
    liveStyle = native.getComputedStyle(live)
    cloneStyle = native.getComputedStyle(clone)
  } catch (_error) {
    return
  }

  const detail: Record<string, string> = {}
  for (const property of CASCADE_PROBES) {
    const expected = liveStyle.getPropertyValue(property)
    const actual = cloneStyle.getPropertyValue(property)
    if (!expected || expected === actual) continue
    detail[property] = `${actual || '(empty)'} -> ${expected}`
  }
  if (Object.keys(detail).length === 0) return

  console.warn('[element-screenshot] snapshot cascade differs from the page', {
    element: live.tagName.toLowerCase(),
    properties: detail
  })
}

/**
 * Copy stylesheet *objects*, not their markup.
 *
 * A page can add rules with `CSSStyleSheet.insertRule()`; those rules live only
 * in the CSSOM and never appear in the `<style>` text, so a plain `cloneNode`
 * silently drops them. x.com adds about a thousand atoms that way (padding,
 * margins, flex directions), and without them the copy lays the page out with
 * the wrong box metrics even though it looks styled.
 */
function copyStyleSheets(live: Document, cloneRoot: ParentNode): void {
  const liveStyles = Array.from(live.querySelectorAll('style'))
  const cloneStyles = Array.from(cloneRoot.querySelectorAll('style'))
  const count = Math.min(liveStyles.length, cloneStyles.length)
  for (let index = 0; index < count; index += 1) {
    const style = liveStyles[index]
    const clone = cloneStyles[index]
    if (!style || !clone) continue
    const sheet = style.sheet
    if (!sheet) continue
    const text = sheetText(sheet)
    // `''` is a legitimate answer: every rule was deleted, so clear the markup.
    if (text !== null) clone.textContent = text
  }
}

/** Resolve once stylesheets and images are applied, fonts are ready, or the budget runs out. */
async function settle(doc: Document, timeout: number): Promise<void> {
  const win = doc.defaultView
  const deadline = Date.now() + timeout
  /** A broken stylesheet link must not eat the whole budget. */
  const linkBudget = Math.min(1500, timeout)
  const forceLayout = (): void => {
    // Reading a layout property runs style + layout, which is what actually
    // requests `@font-face` downloads and applies the copied stylesheets.
    void doc.documentElement?.clientHeight
  }

  forceLayout()

  // A copied `<link rel=stylesheet>` keeps laying out until its sheet is parsed;
  // measuring before that reads unstyled boxes.
  const links = Array.from(doc.querySelectorAll('link[href]')).filter((link) =>
    (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')
  )
  await Promise.race([
    Promise.all(links.map((link) => linkReady(link as HTMLLinkElement))),
    sleep(linkBudget)
  ])

  const images = Array.from(doc.images).filter((image) => !image.complete)
  const waits = images.map(
    (image) =>
      new Promise<void>((resolve) => {
        if (image.complete) {
          resolve()
          return
        }
        const done = (): void => {
          image.removeEventListener('load', done)
          image.removeEventListener('error', done)
          resolve()
        }
        image.addEventListener('load', done)
        image.addEventListener('error', done)
      })
  )

  /**
   * Fonts are the difference between "looks right" and "measures 14px off": a
   * freshly built iframe has not laid anything out yet, so `fonts.ready` can
   * resolve before the first `@font-face` request even starts and the snapshot
   * would keep fallback metrics. Force a layout, wait, force another one, and
   * only stop once the font set reports itself loaded.
   */
  const fontDeadline = Math.min(deadline, Date.now() + 3000)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    forceLayout()
    const fonts = doc.fonts
    if (!fonts) break
    try {
      await Promise.race([fonts.ready, sleep(500)])
    } catch (_error) {
      // A rejected font set must not block the capture.
    }
    forceLayout()
    if (fonts.status === 'loaded' || Date.now() >= fontDeadline) break
    await sleep(50)
  }

  await Promise.race([Promise.all(waits), sleep(Math.max(0, deadline - Date.now()))])
  if (win) await nextFrame(win)
}

function createFrame(doc: Document, width: number, height: number): HTMLIFrameElement {
  const frame = doc.createElement('iframe')
  frame.setAttribute(SNAPSHOT_ATTRIBUTE, '')
  frame.setAttribute(IGNORE_ATTRIBUTE, '')
  const styles: Record<string, string> = {
    // The frame has to be laid out: `display:none` would leave every measurement
    // at zero. Off-screen is enough to keep it invisible.
    display: 'block',
    position: 'fixed',
    left: `${-(width + FRAME_OFFSET)}px`,
    top: '0px',
    width: `${width}px`,
    height: `${height}px`,
    border: '0',
    margin: '0',
    padding: '0',
    visibility: 'visible',
    opacity: '1',
    'pointer-events': 'none',
    'z-index': '-2147483647'
  }
  for (const [property, value] of Object.entries(styles)) {
    frame.style.setProperty(property, value, 'important')
  }
  return frame
}

/**
 * Copy the live page into an off-screen iframe and return the document to
 * render. Everything that follows runs against that copy: mutations, expanded
 * scroll containers and rebuilt panes are invisible to the user.
 */
export async function createSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
  const liveDoc = document
  const liveWin = window
  const width = Math.max(1, Math.round(liveWin.innerWidth))
  const height = Math.max(1, Math.round(liveWin.innerHeight))
  const timeout = options.timeout ?? DEFAULT_TIMEOUT

  const frame = createFrame(liveDoc, width, height)
  // Attach to `<html>` rather than `<body>`: pages watch the body for overlays
  // and re-render on any child change, and a snapshot must not look like one.
  const parent = liveDoc.documentElement ?? liveDoc.body
  if (!parent) throw new Error('The page has no document to snapshot')
  parent.append(frame)

  const dispose = (): void => {
    frame.remove()
  }

  try {
    const doc = frame.contentDocument
    if (!doc) throw new Error('The snapshot frame has no document')

    const ctx: CloneContext = {
      doc: liveDoc,
      pairs: [],
      shadows: [],
      frames: [],
      target: (options.target as LiveElement | undefined) ?? null,
      targetClone: null,
      skip: options.skip
    }

    const root = liveDoc.documentElement
    const clones = Array.from(root.childNodes)
      .map((child) => cloneNodeAny(child, ctx))
      .filter((child): child is Node => child !== null)
    const html = liveDoc.createElement('html')
    for (const attribute of Array.from(root.attributes)) {
      html.setAttribute(attribute.name, attribute.value)
    }
    for (const child of clones) html.append(child)
    // The root is rebuilt by hand, so it is not part of the cloned children.
    if (ctx.target === root) ctx.targetClone = html

    const base = liveDoc.createElement('base')
    base.setAttribute('href', liveDoc.baseURI)
    const head = html.querySelector('head')
    if (head) head.prepend(base)
    else html.prepend(base)

    for (const sheet of Array.from(liveDoc.adoptedStyleSheets ?? [])) {
      const style = liveDoc.createElement('style')
      style.textContent = sheetText(sheet)
      ;(head ?? html).append(style)
    }

    // `insertRule` atoms never reach the markup, so replay the CSSOM instead.
    copyStyleSheets(liveDoc, html)

    const current = doc.documentElement
    if (current) doc.replaceChild(html, current)
    else doc.appendChild(html)

    await nextFrame(liveWin)
    attachDeferred(ctx)
    await settle(doc, timeout)
    restoreScroll(ctx, liveWin, doc.defaultView ?? liveWin)
    await nextFrame(liveWin)
    restoreScroll(ctx, liveWin, doc.defaultView ?? liveWin)

    if (ctx.target && ctx.targetClone) reportCascadeMismatch(ctx.target, ctx.targetClone)

    const snapshotWin = doc.defaultView ?? liveWin
    return { doc, win: snapshotWin, target: ctx.targetClone, frames: ctx.frames, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
