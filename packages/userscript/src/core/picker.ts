import { native } from './native'
import type { PickTarget } from './pick-target'
import { exceedsDragThreshold, isCaptureRegion, regionFromPoints } from './region'
import type { Point } from './region'
import type { TargetBox } from './target'

export interface ElementPickerOptions {
  onHover: (target: PickTarget | null, index: number, total: number) => void
  onSelect: (target: PickTarget) => void
  onCancel: () => void
  /**
   * Layers under a point, outermost first. A frame has to be asked over the
   * bridge, so this may answer later; the picker keeps showing the previous
   * stack until it does.
   */
  resolve: (x: number, y: number) => PickTarget[] | Promise<PickTarget[]>
  /** The whole document, for Ctrl+A. */
  resolveDocument: () => PickTarget
  onCursor?: (x: number, y: number) => void
  isUiEvent?: (event: Event) => boolean
  /** A drag passed the click threshold and became a rectangle. */
  onRegionStart?: () => void
  onRegionChange?: (rect: TargetBox) => void
  onRegionEnd?: (rect: TargetBox) => void
  onRegionCancel?: () => void
}

interface DragSession {
  start: Point
  current: Point
  moved: boolean
}

/**
 * Page-level element picker. All listeners live in the capture phase so page
 * handlers never see the clicks, wheels, drags or keystrokes used for
 * selection. A press that stays inside the drag threshold still picks the
 * element under the cursor; a longer press drags out a capture region.
 */
export class ElementPicker {
  private active = false
  private stack: PickTarget[] = []
  private index = 0
  /** Identifies the newest resolution; older answers are dropped. */
  private resolution = 0
  private cursor = { x: 0, y: 0 }
  private rafId = 0
  private drag: DragSession | null = null
  private suppressClick = false
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
    this.drag = null
    this.suppressClick = false

    const rootStyle = (native.document.documentElement ?? document.documentElement).style
    this.previousCursor = rootStyle.getPropertyValue('cursor')
    this.previousCursorPriority = rootStyle.getPropertyPriority('cursor')
    this.previousUserSelect = rootStyle.getPropertyValue('user-select')
    this.previousUserSelectPriority = rootStyle.getPropertyPriority('user-select')
    rootStyle.setProperty('cursor', 'crosshair', 'important')
    rootStyle.setProperty('user-select', 'none', 'important')

    native.addEventListener(window, 'mousemove', this.handleMouseMove, true)
    native.addEventListener(window, 'pointerdown', this.handlePointerDown, true)
    native.addEventListener(window, 'mousedown', this.handlePointerDown, true)
    native.addEventListener(window, 'mouseup', this.handlePointerUp, true)
    native.addEventListener(window, 'pointerup', this.handlePointerUp, true)
    native.addEventListener(window, 'pointermove', this.handlePointerMove, true)
    native.addEventListener(window, 'click', this.handleClick, true)
    native.addEventListener(window, 'dblclick', this.handleDblClick, true)
    native.addEventListener(window, 'wheel', this.handleWheel, { capture: true, passive: false })
    native.addEventListener(window, 'keydown', this.handleKeyDown, true)
    native.addEventListener(window, 'contextmenu', this.handleContextMenu, true)
    native.addEventListener(window, 'dragstart', this.handleDragStart, true)
    native.addEventListener(window, 'resize', this.handleResize, true)
    native.addEventListener(window, 'blur', this.handleBlur, true)

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
    this.drag = null
    this.suppressClick = false

    native.removeEventListener(window, 'mousemove', this.handleMouseMove, true)
    native.removeEventListener(window, 'pointerdown', this.handlePointerDown, true)
    native.removeEventListener(window, 'mousedown', this.handlePointerDown, true)
    native.removeEventListener(window, 'mouseup', this.handlePointerUp, true)
    native.removeEventListener(window, 'pointerup', this.handlePointerUp, true)
    native.removeEventListener(window, 'pointermove', this.handlePointerMove, true)
    native.removeEventListener(window, 'click', this.handleClick, true)
    native.removeEventListener(window, 'dblclick', this.handleDblClick, true)
    native.removeEventListener(window, 'wheel', this.handleWheel, true)
    native.removeEventListener(window, 'keydown', this.handleKeyDown, true)
    native.removeEventListener(window, 'contextmenu', this.handleContextMenu, true)
    native.removeEventListener(window, 'dragstart', this.handleDragStart, true)
    native.removeEventListener(window, 'resize', this.handleResize, true)
    native.removeEventListener(window, 'blur', this.handleBlur, true)

    if (this.rafId) {
      native.cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }

    const rootStyle = (native.document.documentElement ?? document.documentElement).style
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

  /**
   * Jump straight to the next (or previous) layer that scrolls by itself.
   * Walking a deep stack one layer at a time is the slow part of picking a
   * scroll container that shares its box with an un-scrollable wrapper.
   */
  cycleScroll(delta: number): void {
    if (!this.active || this.stack.length === 0) return
    const step = delta >= 0 ? 1 : -1
    for (
      let index = this.index + step;
      index >= 0 && index < this.stack.length;
      index += step
    ) {
      const target = this.stack[index]
      if (target && target.scrollAxis !== null) {
        this.index = index
        this.emitHover()
        return
      }
    }
  }

  private emitHover(): void {
    this.options.onHover(this.stack[this.index] ?? null, this.index, this.stack.length)
  }

  private refresh(): void {
    const resolution = (this.resolution += 1)
    let layers: PickTarget[] | Promise<PickTarget[]>
    try {
      layers = this.options.resolve(this.cursor.x, this.cursor.y)
    } catch (_error) {
      return
    }
    if (Array.isArray(layers)) {
      this.applyStack(layers)
      return
    }
    void layers
      .then((stack) => {
        // A newer move (or a selection) has already taken over.
        if (resolution !== this.resolution || !this.active) return
        this.applyStack(stack)
      })
      .catch(() => {
        // Keep the previous stack; a frame that cannot answer is not an error.
      })
  }

  private applyStack(stack: PickTarget[]): void {
    // `resolve` answers outermost first, so the innermost layer is selected.
    this.stack = stack
    // A running drag owns the box, so keep the layer index stable until it ends.
    if (this.drag) return
    this.index = Math.max(0, this.stack.length - 1)
    this.emitHover()
  }

  private scheduleRefresh(): void {
    if (this.rafId) return
    this.rafId = native.requestAnimationFrame(() => {
      this.rafId = 0
      if (!this.active) return
      this.refresh()
    })
  }

  private isUi(event: Event): boolean {
    if (this.isPickSurface(event)) return false
    return this.options.isUiEvent?.(event) ?? false
  }

  private isPickSurface(event: Event): boolean {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    return path.some(
      (node) =>
        (node as Node).nodeType === 1 &&
        native.getAttribute(node as Element, 'data-element-screenshot-pick-surface') !== null
    )
  }

  private viewport(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight }
  }

  private startDrag(event: MouseEvent): void {
    if (this.drag || event.button !== 0) return
    const point = { x: event.clientX, y: event.clientY }
    this.drag = { start: point, current: point, moved: false }
    this.suppressClick = false
  }

  /**
   * Update the running drag. Returns true when the event belonged to a drag, so
   * the caller skips hover hit-testing for it.
   */
  private updateDrag(event: MouseEvent): boolean {
    const drag = this.drag
    if (!drag) return false

    if (drag.current.x === event.clientX && drag.current.y === event.clientY) return true
    drag.current = { x: event.clientX, y: event.clientY }
    if (!drag.moved && !exceedsDragThreshold(drag.start, drag.current)) {
      return true
    }
    if (!drag.moved) {
      drag.moved = true
      this.options.onRegionStart?.()
    }
    this.options.onRegionChange?.(regionFromPoints(drag.start, drag.current, this.viewport()))
    return true
  }

  /** Finish the drag; a plain click is handed back to the click handler. */
  private endDrag(event: MouseEvent): boolean {
    const drag = this.drag
    if (!drag) return false

    this.updateDrag(event)
    this.drag = null
    if (!drag.moved) return false

    // A drag also fires `click`; consume it so the region is not replaced by
    // the element under the release point.
    this.suppressClick = true
    const rect = regionFromPoints(drag.start, drag.current, this.viewport())
    this.stop()
    if (isCaptureRegion(rect)) this.options.onRegionEnd?.(rect)
    else this.options.onRegionCancel?.()
    return true
  }

  private cancelDrag(): boolean {
    if (!this.drag) return false
    this.drag = null
    this.options.onRegionCancel?.()
    return true
  }

  private selectAll(): void {
    this.stop()
    this.options.onSelect(this.options.resolveDocument())
  }

  private selectCurrent(): void {
    const target = this.stack[this.index]
    if (!target) return
    this.stop()
    this.options.onSelect(target)
  }

  private cancel(): void {
    this.stop()
    this.options.onCancel()
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.active || this.isUi(event)) return
    this.cursor = { x: event.clientX, y: event.clientY }
    this.options.onCursor?.(this.cursor.x, this.cursor.y)
    if (this.updateDrag(event)) return
    this.scheduleRefresh()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.drag) return
    if (this.isUi(event)) return
    this.updateDrag(event)
  }

  private readonly handlePointerDown = (event: Event): void => {
    if (!this.active || this.isUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.startDrag(event as MouseEvent)
  }

  private readonly handlePointerUp = (event: Event): void => {
    if (!this.active) return
    if (this.endDrag(event as MouseEvent)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.active) return
    if (this.suppressClick) {
      this.suppressClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.isUi(event)) return
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
    if (this.drag) return
    // Shift turns the wheel into a jump between scroll containers; some
    // platforms put a vertical wheel on the horizontal axis while Shift is held.
    const direction = event.deltaY || event.deltaX
    if (event.shiftKey) {
      if (direction) this.cycleScroll(direction > 0 ? 1 : -1)
      return
    }
    if (event.deltaY > 0) this.cycle(1)
    else if (event.deltaY < 0) this.cycle(-1)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || this.isUi(event)) return

    const key = event.key
    const command = event.ctrlKey || event.metaKey

    if (key === 'Escape' && this.drag) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cancelDrag()
      return
    }

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

    if (event.shiftKey && (key === 'ArrowDown' || key === 'PageDown' || key === '+' || key === '=')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cycleScroll(1)
      return
    }

    if (event.shiftKey && (key === 'ArrowUp' || key === 'PageUp' || key === '-' || key === '_')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cycleScroll(-1)
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
    if (this.drag) this.cancelDrag()
    this.cursor = {
      x: Math.min(this.cursor.x, window.innerWidth - 1),
      y: Math.min(this.cursor.y, window.innerHeight - 1)
    }
    this.refresh()
  }

  private readonly handleBlur = (): void => {
    if (!this.active) return
    this.cancelDrag()
  }
}
