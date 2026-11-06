import { toBlob } from 'html-to-image'
import { native } from './native'
import type { TargetBox } from './target'

interface BackgroundSource {
  style: CSSStyleDeclaration
  fixed: boolean
  pageLeft: number
  pageTop: number
  width: number
  height: number
}

function hasBackgroundImage(style: CSSStyleDeclaration): boolean {
  return Boolean(style.backgroundImage && style.backgroundImage !== 'none')
}

function backgroundSource(
  element: Element,
  style: CSSStyleDeclaration,
  doc: Document,
  win: Window
): BackgroundSource {
  const fixed = style.backgroundAttachment
    .split(',')
    .some((value) => value.trim().toLowerCase() === 'fixed')
  if (fixed) {
    return {
      style,
      fixed,
      pageLeft: 0,
      pageTop: 0,
      width: Math.max(1, win.innerWidth || doc.documentElement?.clientWidth || 1),
      height: Math.max(1, win.innerHeight || doc.documentElement?.clientHeight || 1)
    }
  }

  const rect = native.getBoundingClientRect(element)
  const root = doc.documentElement
  const fallbackWidth = Math.max(
    win.innerWidth || 0,
    root?.scrollWidth || 0,
    element.scrollWidth || 0
  )
  const fallbackHeight = Math.max(
    win.innerHeight || 0,
    root?.scrollHeight || 0,
    element.scrollHeight || 0
  )

  return {
    style,
    fixed,
    pageLeft: Math.max(0, Math.round(rect.left + win.scrollX)),
    pageTop: Math.max(0, Math.round(rect.top + win.scrollY)),
    width: Math.max(1, Math.round(rect.width > 1 ? rect.width : fallbackWidth)),
    height: Math.max(1, Math.round(rect.height > 1 ? rect.height : fallbackHeight))
  }
}

function sourceLayers(element: Element): BackgroundSource[] {
  const doc = element.ownerDocument
  const win = doc.defaultView
  if (!win) return []

  const sources: BackgroundSource[] = []
  for (const source of [doc.documentElement, doc.body]) {
    if (!source) continue
    try {
      const style = native.getComputedStyle(source)
      if (hasBackgroundImage(style)) {
        sources.push(backgroundSource(source, style, doc, win))
      }
    } catch {
      // Keep the sources that were readable.
    }
  }
  return sources
}

/**
 * A non-solid page background (gradient or image) cannot be represented by the
 * single canvas fill html-to-image accepts. Render the root/body background
 * into a hidden layer at the target's crop size, preserving the original
 * background box, size, position and repeat, then composite it behind the
 * element capture.
 */
export function hasComplexBackground(element: Element): boolean {
  return sourceLayers(element).length > 0
}

function createLayer(
  doc: Document,
  source: BackgroundSource,
  targetPageLeft: number,
  targetPageTop: number,
  targetViewportLeft: number,
  targetViewportTop: number
): HTMLDivElement {
  const layer = doc.createElement('div')
  const style = layer.style
  style.position = 'absolute'
  style.margin = '0'
  style.padding = '0'
  style.border = '0'
  style.pointerEvents = 'none'
  style.backgroundImage = source.style.backgroundImage
  style.backgroundColor = source.style.backgroundColor
  style.backgroundSize = source.style.backgroundSize
  style.backgroundPosition = source.style.backgroundPosition
  style.backgroundRepeat = source.style.backgroundRepeat
  style.backgroundOrigin = source.style.backgroundOrigin
  style.backgroundClip = source.style.backgroundClip
  // The layer is already positioned in crop coordinates. Keeping `fixed`
  // would anchor it to the hidden wrapper's viewport instead.
  style.backgroundAttachment = 'scroll'
  style.backgroundBlendMode = source.style.backgroundBlendMode
  style.opacity = source.style.opacity
  style.width = `${source.width}px`
  style.height = `${source.height}px`
  style.left = `${source.fixed ? -targetViewportLeft : source.pageLeft - targetPageLeft}px`
  style.top = `${source.fixed ? -targetViewportTop : source.pageTop - targetPageTop}px`
  return layer
}

export async function captureBackdropScene(
  element: Element,
  box: TargetBox,
  pixelRatio: number,
  baseColor: string
): Promise<Blob | null> {
  const doc = element.ownerDocument
  const win = doc.defaultView
  if (!win) return null

  const sources = sourceLayers(element)
  if (sources.length === 0) return null

  const wrapper = doc.createElement('div')
  wrapper.setAttribute('data-element-shot-ignore', '')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '0'
  wrapper.style.top = '0'
  wrapper.style.width = `${Math.max(1, Math.ceil(box.width))}px`
  wrapper.style.height = `${Math.max(1, Math.ceil(box.height))}px`
  wrapper.style.overflow = 'hidden'
  wrapper.style.pointerEvents = 'none'
  wrapper.style.zIndex = '-1'
  wrapper.style.margin = '0'
  wrapper.style.padding = '0'
  wrapper.style.border = '0'
  wrapper.style.backgroundColor = baseColor
  wrapper.style.isolation = 'isolate'
  const targetPageLeft = box.left + win.scrollX
  const targetPageTop = box.top + win.scrollY

  for (const source of sources) {
    wrapper.appendChild(createLayer(doc, source, targetPageLeft, targetPageTop, box.left, box.top))
  }

  const host = doc.createElement('div')
  host.style.display = 'none'
  host.setAttribute('data-element-shot-ignore', '')
  host.appendChild(wrapper)
  const parent = doc.body ?? doc.documentElement
  if (!parent) return null
  parent.appendChild(host)

  try {
    const blob = await toBlob(wrapper, {
      width: Math.max(1, Math.ceil(box.width)),
      height: Math.max(1, Math.ceil(box.height)),
      pixelRatio,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
      imagePlaceholder: undefined,
      style: {
        position: 'absolute',
        left: '0px',
        top: '0px',
        margin: '0px',
        width: `${Math.max(1, Math.ceil(box.width))}px`,
        height: `${Math.max(1, Math.ceil(box.height))}px`
      }
    })
    return blob
  } catch (error) {
    console.warn('[element-shot] backdrop scene failed', error)
    return null
  } finally {
    host.remove()
  }
}
