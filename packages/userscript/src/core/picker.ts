import { getElementStack, resolveCandidate } from './target'

export interface ElementPickerOptions {
  onHover: (element: Element | null, index: number, total: number) => void
  onSelect: (element: Element) => void
  onCancel: () => void
  onCursor?: (x: number, y: number) => void
  isUiEvent?: (event: Event) => boolean
}

/**
 * Page-level element picker. All listeners live in the capture phase so page
 * handlers never see the clicks, wheel or keystrokes used for selection.
 */
export class ElementPicker {
  private active = false
  private stack: Element[] = []
  private index = 0
  private cursor = { x: 0, y: 0 }
  private rafId = 0
  private previousCursor = ''
  private previousCursorPriority = ''
  private previousUserSelect = ''
  private previousUserSelectPriority = ''

  constructor(private readonly options: ElementPickerOptions) {}

  get isActive(): boolean {
    return this.active
  }

  start(): void {
    if (this.active) return
    this.active = true

    const rootStyle = document.documentElement.style
    this.previousCursor = rootStyle.getPropertyValue('cursor')
    this.previousCursorPriority = rootStyle.getPropertyPriority('cursor')
    this.previousUserSelect = rootStyle.getPropertyValue('user-select')
    this.previousUserSelectPriority = rootStyle.getPropertyPriority('user-select')
    rootStyle.setProperty('cursor', 'crosshair', 'important')
    rootStyle.setProperty('user-select', 'none', 'important')

    window.addEventListener('mousemove', this.handleMouseMove, true)
    window.addEventListener('pointerdown', this.handlePointerDown, true)
    window.addEventListener('mousedown', this.handlePointerDown, true)
    window.addEventListener('mouseup', this.handlePointerDown, true)
    window.addEventListener('click', this.handleClick, true)
    window.addEventListener('dblclick', this.handleDblClick, true)
    window.addEventListener('wheel', this.handleWheel, { capture: true, passive: false })
    window.addEventListener('keydown', this.handleKeyDown, true)
    window.addEventListener('contextmenu', this.handleContextMenu, true)
    window.addEventListener('dragstart', this.handleDragStart, true)
    window.addEventListener('resize', this.handleResize, true)

    this.cursor = {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2)
    }
    this.options.onCursor?.(this.cursor.x, this.cursor.y)
    this.refresh()
  }

  stop(): void {
    if (!this.active) return
    this.active = false

    window.removeEventListener('mousemove', this.handleMouseMove, true)
    window.removeEventListener('pointerdown', this.handlePointerDown, true)
    window.removeEventListener('mousedown', this.handlePointerDown, true)
    window.removeEventListener('mouseup', this.handlePointerDown, true)
    window.removeEventListener('click', this.handleClick, true)
    window.removeEventListener('dblclick', this.handleDblClick, true)
    window.removeEventListener('wheel', this.handleWheel, true)
    window.removeEventListener('keydown', this.handleKeyDown, true)
    window.removeEventListener('contextmenu', this.handleContextMenu, true)
    window.removeEventListener('dragstart', this.handleDragStart, true)
    window.removeEventListener('resize', this.handleResize, true)

    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }

    const rootStyle = document.documentElement.style
    if (this.previousCursor) {
      rootStyle.setProperty('cursor', this.previousCursor, this.previousCursorPriority)
    } else {
      rootStyle.removeProperty('cursor')
    }
    if (this.previousUserSelect) {
      rootStyle.setProperty('user-select', this.previousUserSelect, this.previousUserSelectPriority)
    } else {
      rootStyle.removeProperty('user-select')
    }
  }

  cycle(delta: number): void {
    if (!this.active || this.stack.length === 0) return
    const next = Math.min(Math.max(this.index + delta, 0), this.stack.length - 1)
    if (next === this.index) return
    this.index = next
    this.emitHover()
  }

  private emitHover(): void {
    const element = resolveCandidate(this.stack, this.index)
    this.options.onHover(element, this.index, this.stack.length)
  }

  private refresh(): void {
    // getElementStack returns topmost first; reverse so index 0 is the
    // outermost layer and the innermost element is selected initially.
    this.stack = getElementStack(this.cursor.x, this.cursor.y).reverse()
    this.index = Math.max(0, this.stack.length - 1)
    this.emitHover()
  }

  private scheduleRefresh(): void {
    if (this.rafId) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0
      if (!this.active) return
      this.refresh()
    })
  }

  private isUi(event: Event): boolean {
    return this.options.isUiEvent?.(event) ?? false
  }

  private selectAll(): void {
    const root = document.documentElement
    this.stop()
    this.options.onSelect(root)
  }

  private selectCurrent(): void {
    const element = resolveCandidate(this.stack, this.index)
    if (!element) return
    this.stop()
    this.options.onSelect(element)
  }

  private cancel(): void {
    this.stop()
    this.options.onCancel()
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.active || this.isUi(event)) return
    this.cursor = { x: event.clientX, y: event.clientY }
    this.options.onCursor?.(this.cursor.x, this.cursor.y)
    this.scheduleRefresh()
  }

  private readonly handlePointerDown = (event: Event): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.selectCurrent()
  }

  private readonly handleDblClick = (event: MouseEvent): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.deltaY > 0) this.cycle(1)
    else if (event.deltaY < 0) this.cycle(-1)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || this.isUi(event)) return

    const key = event.key
    const command = event.ctrlKey || event.metaKey

    if (command && key.toLowerCase() === 'a') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.selectAll()
      return
    }

    if (key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cancel()
      return
    }

    if (key === '+' || key === '=' || key === 'ArrowDown' || key === 'PageDown') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cycle(1)
      return
    }

    if (key === '-' || key === '_' || key === 'ArrowUp' || key === 'PageUp') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cycle(-1)
      return
    }

    if (key === 'Enter') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.selectCurrent()
      return
    }

    if (
      key === ' ' ||
      key === 'Tab' ||
      key === 'Home' ||
      key === 'End' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight'
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly handleDragStart = (event: DragEvent): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly handleResize = (): void => {
    if (!this.active) return
    this.cursor = {
      x: Math.min(this.cursor.x, window.innerWidth - 1),
      y: Math.min(this.cursor.y, window.innerHeight - 1)
    }
    this.refresh()
  }
}
