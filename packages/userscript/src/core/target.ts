export interface TargetBox {
  left: number
  top: number
  width: number
  height: number
}

export interface TargetInfo {
  label: string
  box: TargetBox
  scrollable: boolean
  element: Element
}

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'TITLE',
  'HEAD',
  'NOSCRIPT',
  'TEMPLATE'
])

export function isUiElement(element: Element): boolean {
  return element.closest('[data-element-shot-root]') !== null
}

/**
 * Returns every element under the point, topmost first, including open shadow
 * roots. Closed shadow roots cannot be pierced and resolve to their host.
 */
export function getElementStack(x: number, y: number, doc: Document = document): Element[] {
  let stack = Array.from(doc.elementsFromPoint(x, y))
  let top: Element | undefined = stack[0]
  let guard = 0

  while (top?.shadowRoot && guard < 32) {
    guard += 1
    let inner: Element[]
    try {
      inner = Array.from(top.shadowRoot.elementsFromPoint(x, y))
    } catch {
      break
    }
    if (inner.length === 0) break
    stack = [...inner, ...stack]
    top = inner[0]
  }

  const seen = new Set<Element>()
  const result: Element[] = []
  for (const element of stack) {
    if (seen.has(element)) continue
    seen.add(element)
    if (IGNORED_TAGS.has(element.tagName)) continue
    if (isUiElement(element)) continue
    result.push(element)
  }
  return result
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getTargetBox(element: Element): TargetBox {
  const doc = element.ownerDocument
  const win = doc.defaultView ?? window
  const rect = element.getBoundingClientRect()

  if (element === doc.documentElement) {
    const width = Math.max(doc.documentElement.scrollWidth, doc.documentElement.clientWidth)
    const height = Math.max(doc.documentElement.scrollHeight, doc.documentElement.clientHeight)
    return { left: 0, top: 0, width, height }
  }

  const style = win.getComputedStyle(element)
  const borderX = parsePx(style.borderLeftWidth) + parsePx(style.borderRightWidth)
  const borderY = parsePx(style.borderTopWidth) + parsePx(style.borderBottomWidth)

  const width = Math.max(Math.ceil(rect.width), element.scrollWidth + borderX)
  const height = Math.max(Math.ceil(rect.height), element.scrollHeight + borderY)

  return {
    left: rect.left,
    top: rect.top,
    width,
    height
  }
}

export function elementLabel(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const id = element.id ? `#${element.id}` : ''
  const rawClass = typeof element.className === 'string' ? element.className : ''
  const classes = rawClass
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('')
  const label = `${tag}${id}${classes}`
  return label.length > 80 ? `${label.slice(0, 77)}...` : label
}

export function describeTarget(element: Element): TargetInfo {
  const box = getTargetBox(element)
  return {
    label: elementLabel(element),
    box,
    scrollable:
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1,
    element
  }
}

export function resolveCandidate(stack: readonly Element[], index: number): Element | null {
  if (stack.length === 0) return null
  const clamped = Math.min(Math.max(index, 0), stack.length - 1)
  return stack[clamped] ?? null
}
