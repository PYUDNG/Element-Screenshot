import { createApp, reactive, watch } from 'vue'
import type { App } from 'vue'
import { applyShadowStyles } from '@element-screenshot/settings'
import type { I18n, SettingsController } from '@element-screenshot/settings'
import {
  cancelCapture,
  captureElement,
  captureRegion,
  describeCaptureError,
  shouldCaptureNode
} from '../core/capture'
import type { CaptureBackground } from '../core/capture'
import { resolvePageBackground } from '../core/background'
import { buildScreenshotName } from '../core/filename'
import { requestFrameCapture, requestFramePick } from '../core/frame-bridge'
import type { FramePickItem } from '../core/frame-bridge'
import { frameLevels } from '../core/frame-levels'
import { frameContentBox } from '../core/frame-size'
import { native } from '../core/native'
import { ElementPicker } from '../core/picker'
import { elementTarget, frameTargets } from '../core/pick-target'
import type { PickTarget } from '../core/pick-target'
import { dispatchCaptureUiKey, isPickerKey } from '../core/relay-key'
import type { RelayedKey } from '../core/relay-key'
import { clampRegion } from '../core/region'
import { getElementStack, getTargetBox } from '../core/target'
import type { TargetBox } from '../core/target'
import InPageApp from './InPageApp.vue'
import type { ShotAppApi, ShotState, ToastTone } from './api'
import { freeRatio, placeStored, readDock, resolveDrop, clampToViewport } from './fab-position'
import type { FabViewport } from './fab-position'

export interface ShotAppOptions {
  settings: SettingsController
  i18n: I18n
  styles: string
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

interface WritableFile {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface SaveFileHandle {
  createWritable(): Promise<WritableFile>
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<SaveFileHandle>
}

/** Marks the shadow host; also used to keep a second script copy from mounting. */
export const UI_ROOT_ATTRIBUTE = 'data-element-screenshot-root'
/** How long a frame that failed a hover is left alone before it is asked again. */
const FRAME_PICK_RETRY = 2_000
const UI_MARKERS = [
  UI_ROOT_ATTRIBUTE,
  'data-element-screenshot-settings',
  'data-element-screenshot-ignore'
] as const

function isMarkedUiNode(node: EventTarget): boolean {
  if ((node as Node).nodeType !== 1) return false
  return UI_MARKERS.some((name) => native.getAttribute(node as Element, name) !== null)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Used when the page's `img-src` policy rejects a `blob:` URL: data URLs are
 * allowed on far more pages, and the preview is the only consumer.
 */
function readAsDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new native.FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    } catch {
      resolve(null)
    }
  })
}

export class ShotApp implements ShotAppApi {
  readonly state: ShotState = reactive({
    mode: 'idle',
    hover: null,
    box: null,
    marquee: null,
    cursor: { x: 0, y: 0 },
    capturing: false,
    ready: false,
    error: null,
    captureSize: null,
    previewUrl: null,
    toasts: [],
    fab: { left: 0, top: 0, dock: null },
    viewport: { width: 0, height: 0 }
  })

  private readonly picker: ElementPicker
  private host: HTMLElement | null = null
  private app: App | null = null
  private blob: Blob | null = null
  private pending: Promise<void> | null = null
  private captureToken = 0
  private toastId = 0
  private previewFallback = false
  private guardsInstalled = false
  private cancelKeyInstalled = false
  private stopSettingsWatch: (() => void) | null = null
  /**
   * Frames that just failed to answer a hover. Every mouse move would otherwise
   * pay another timeout; the frame gets asked again once the deadline passes,
   * because a helper may still be starting up when the picker opens.
   */
  private readonly framePickRetry = new Map<HTMLIFrameElement, number>()

  constructor(
    readonly settings: SettingsController,
    readonly i18n: I18n,
    private readonly styles: string
  ) {
    this.picker = new ElementPicker({
      onHover: (target, index, total) => this.handleHover(target, index, total),
      onSelect: (target) => this.handleSelect(target),
      onCancel: () => this.reset(),
      resolve: (x, y) => this.resolveTargets(x, y),
      resolveDocument: () => this.documentTarget(),
      onCursor: (x, y) => {
        this.state.cursor = { x, y }
      },
      onRegionStart: () => this.handleRegionStart(),
      onRegionChange: (rect) => this.handleRegionChange(rect),
      onRegionEnd: (rect) => this.handleRegion(rect),
      onRegionCancel: () => {
        this.state.marquee = null
      },
      isUiEvent: (event) => this.isUiEvent(event)
    })
  }

  mount(): void {
    if (this.host) return
    const host = native.document.createElement('div')
    native.setAttribute(host, UI_ROOT_ATTRIBUTE, '')
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;pointer-events:none;color-scheme:normal;'
    const shadow = host.attachShadow({ mode: 'open' })
    applyShadowStyles(shadow, this.styles)
    const container = native.document.createElement('div')
    native.appendChild(shadow, container)
    const root = native.document.documentElement ?? document.documentElement
    native.appendChild(root, host)
    this.host = host

    this.app = createApp(InPageApp, { app: this })
    this.app.config.errorHandler = (error) => {
      console.error('[element-screenshot] ui error', error)
    }
    this.app.mount(container)

    this.updateViewport()
    native.addEventListener(window, 'resize', this.handleResize, { passive: true })
    this.stopSettingsWatch = watch(
      () => [
        this.settings.get('trigger.fabSize'),
        this.settings.get('trigger.fabX'),
        this.settings.get('trigger.fabY'),
        this.settings.get('trigger.fabDock')
      ],
      () => this.repositionFab()
    )
  }

  dispose(): void {
    this.cancel()
    this.picker.stop()
    this.stopSettingsWatch?.()
    this.stopSettingsWatch = null
    this.app?.unmount()
    this.app = null
    this.host?.remove()
    this.host = null
    native.removeEventListener(window, 'resize', this.handleResize)
  }

  isUiEvent = (event: Event): boolean => {
    if (!this.host) return false
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    return path.some((node) => isMarkedUiNode(node))
  }

  startPicker(): void {
    if (this.settings.isOpen.value || this.state.mode !== 'idle') return
    this.clearSelection()
    // A frame that was unresponsive last time gets a fresh chance: its helper may
    // have finished loading since.
    this.framePickRetry.clear()
    this.state.mode = 'picking'
    this.picker.start()
  }

  /**
   * Follow the pointer a frame reported.
   *
   * With mouse passthrough on there is no transparent layer, so the pointer lives
   * inside a frame and the top window never sees it. Replaying the event keeps one
   * pointer path inside the picker: it moves the crosshair, resolves the stack
   * under the point and, on a click, picks the layer the user is looking at.
   */
  handleFramePointer(point: { x: number; y: number }, kind: 'move' | 'click'): void {
    if (this.state.mode !== 'picking') return
    const target = native.document.body ?? native.document.documentElement
    if (!target) return
    target.dispatchEvent(
      new native.MouseEvent(kind === 'click' ? 'click' : 'mousemove', {
        clientX: point.x,
        clientY: point.y,
        bubbles: true,
        cancelable: true,
        composed: true
      })
    )
  }

  /**
   * Act on a picker key reported by a frame.
   *
   * A click inside a frame leaves the keyboard there, so the picker would never
   * see Esc or its layer keys. The press is replayed as a `keydown` so the picker
   * keeps one keyboard path; only keys it consumes are replayed, so nothing leaks
   * to the page. Starting a capture blurs the focused element anyway, which is
   * why the preview does not need this.
   */
  handleRelayedKey(stroke: RelayedKey): boolean {
    if (this.state.mode !== 'picking') return false
    if (!isPickerKey(stroke)) return false
    return dispatchCaptureUiKey(stroke)
  }

  cancel(): void {
    if (this.state.mode === 'idle') return
    this.reset()
  }

  reset(): void {
    this.captureToken += 1
    // Nothing is mutated on the live page any more, but a render may still be
    // running on its snapshot; ask it to unwind.
    cancelCapture()
    this.picker.stop()
    this.removeGuards()
    this.removeCancelKey()
    this.pending = null
    this.blob = null
    this.state.mode = 'idle'
    this.state.hover = null
    this.state.box = null
    this.state.marquee = null
    this.state.capturing = false
    this.state.ready = false
    this.state.error = null
    this.state.captureSize = null
    this.setPreviewUrl(null)
  }

  cycle(delta: number): void {
    this.picker.cycle(delta)
  }

  cycleScroll(delta: number): void {
    this.picker.cycleScroll(delta)
  }

  async copy(): Promise<void> {
    const blob = await this.ensureBlob()
    if (!blob) return

    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Clipboard image writing is not supported')
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      this.toast('app.toast.copied', 'success')
      this.reset()
    } catch (error) {
      console.error('[element-screenshot] copy failed', error)
      this.toast('app.toast.copyFailed', 'error')
    }
  }

  async save(): Promise<void> {
    const blob = await this.ensureBlob()
    if (!blob) return

    const name = buildScreenshotName(location.href)
    const pickerWindow = window as SavePickerWindow
    const showSaveFilePicker = pickerWindow.showSaveFilePicker

    try {
      if (showSaveFilePicker && native.isSecureContext) {
        const handle = await showSaveFilePicker.call(pickerWindow, {
          suggestedName: name,
          types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }]
        })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        this.toast('app.toast.saved', 'success')
        this.reset()
        return
      }

      this.download(blob, name)
      this.toast('app.toast.saved', 'success')
      this.reset()
    } catch (error) {
      if (isAbortError(error)) return
      console.error('[element-screenshot] save failed', error)
      this.toast('app.toast.saveFailed', 'error')
    }
  }

  repositionFab(): void {
    const size = this.fabSize()
    const viewport = this.fabViewport()
    this.state.fab = placeStored(
      clamp(this.readRatio('trigger.fabX', 1), 0, 1),
      clamp(this.readRatio('trigger.fabY', 1), 0, 1),
      viewport,
      size,
      readDock(this.settings.get('trigger.fabDock'))
    )
  }

  setFabPosition(left: number, top: number, commit: boolean): void {
    const size = this.fabSize()
    const viewport = this.fabViewport()

    if (!commit) {
      // Dragging has to reach the very edges, otherwise docking is unreachable.
      const point = clampToViewport(left, top, viewport, size)
      this.state.fab = { ...point, dock: null }
      return
    }

    const placement = resolveDrop(left, top, viewport, size)
    this.state.fab = placement
    this.settings.set('trigger.fabDock', placement.dock ?? '')
    this.settings.set('trigger.fabX', freeRatio(placement.left, viewport.width, size))
    this.settings.set('trigger.fabY', freeRatio(placement.top, viewport.height, size))
  }

  toast(key: string, tone: ToastTone = 'info', params?: Record<string, string | number>): void {
    const id = (this.toastId += 1)
    this.state.toasts.push({ id, message: this.i18n.t(key, params), tone })
    const timer = native.setTimeout(() => {
      const index = this.state.toasts.findIndex((item) => item.id === id)
      if (index >= 0) this.state.toasts.splice(index, 1)
    }, 3200)
    if (typeof timer === 'object' && 'unref' in timer) {
      ;(timer as { unref: () => void }).unref()
    }
  }

  private fabSize(): number {
    const value = this.settings.get('trigger.fabSize')
    return typeof value === 'number' && Number.isFinite(value) ? value : 48
  }

  private fabViewport(): FabViewport {
    return { width: window.innerWidth, height: window.innerHeight }
  }

  private readRatio(key: string, fallback: number): number {
    const value = this.settings.get(key)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private documentTarget(): PickTarget {
    const root = native.document.documentElement ?? document.documentElement
    return elementTarget(root)
  }

  /**
   * Every layer under the point, outermost first.
   *
   * When the innermost layer of this document is a frame, the frame is asked for
   * its own layers so the picker can walk into it. That question travels over the
   * bridge — the only channel into a cross-origin frame — and answers a moment
   * later, which is why the picker accepts a promise here.
   */
  private resolveTargets(x: number, y: number): PickTarget[] | Promise<PickTarget[]> {
    // getElementStack returns topmost first; the picker wants outermost first.
    const layers = getElementStack(x, y).map(elementTarget)
    const frame = layers[0]?.element
    if (!frame || frame.tagName !== 'IFRAME') return layers.reverse()
    return this.pierceFrame(frame as HTMLIFrameElement, x, y, layers)
  }

  private async pierceFrame(
    frame: HTMLIFrameElement,
    x: number,
    y: number,
    layers: readonly PickTarget[]
  ): Promise<PickTarget[]> {
    const outer = layers.slice().reverse()
    const items = await this.probeFramePick(frame, x, y)
    if (!items || items.length === 0) return outer
    return [...outer, ...frameTargets(frame, items).reverse()]
  }

  /**
   * How many frame levels this capture works with.
   *
   * One number drives both ends: the picker may pierce this deep, and a capture
   * paints the frames inside its root this deep. They have to agree — a layer the
   * picker reached in a third-level frame should not come out of the renderer as
   * an empty box. Every level costs one more full render, hence the low default.
   */
  private frameDepth(): number {
    return frameLevels(this.settings.get('picker.frameDepth'))
  }

  /**
   * Ask one frame what sits under the pointer.
   *
   * The point only counts inside the frame's viewport: on its border or padding
   * the frame's own coordinates would describe something else entirely. A frame
   * that does not answer (no helper, still starting up, busy) is skipped for a
   * while instead of making every mouse move wait for another timeout.
   */
  private async probeFramePick(
    frame: HTMLIFrameElement,
    x: number,
    y: number
  ): Promise<FramePickItem[] | null> {
    const retryAt = this.framePickRetry.get(frame)
    if (retryAt !== undefined && Date.now() < retryAt) return null

    const view = frameContentBox(frame)
    if (!view) return null
    if (
      x < view.left ||
      x >= view.left + view.width ||
      y < view.top ||
      y >= view.top + view.height
    ) {
      return null
    }

    const items = await requestFramePick(frame, {
      x: x - view.left,
      y: y - view.top,
      depth: this.frameDepth()
    })
    if (!items) {
      this.framePickRetry.set(frame, Date.now() + FRAME_PICK_RETRY)
      return null
    }
    this.framePickRetry.delete(frame)
    return items
  }

  private handleHover(target: PickTarget | null, index: number, total: number): void {
    if (!target) {
      this.state.hover = null
      this.state.box = null
      return
    }

    this.state.hover = {
      label: target.label,
      width: target.rect.width,
      height: target.rect.height,
      rect: target.rect,
      contentWidth: target.box.width,
      contentHeight: target.box.height,
      scrollAxis: target.scrollAxis,
      scrollable: target.scrollAxis !== null,
      depth: index + 1,
      total,
      fullPage: target.fullPage,
      inFrame: target.frame !== null,
      frameLevel: target.frameLevel
    }
    this.state.box = target.box
  }

  private handleSelect(target: PickTarget): void {
    // Measured on the live element: this is the frame the picker drew and the
    // frame the capture has to reproduce. A layer inside a frame is measured by
    // that frame instead, so its box only feeds the overlay.
    this.state.mode = 'selected'
    this.state.hover = null
    this.state.marquee = null
    this.state.box = target.box
    this.state.capturing = true
    this.state.ready = false
    this.state.error = null
    this.state.captureSize = null

    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()

    this.beginRender()
    const token = (this.captureToken += 1)

    if (target.element) {
      this.pending = this.renderCapture(target.element, getTargetBox(target.element), token)
      return
    }
    if (target.frame && target.frameElementId !== null) {
      this.pending = this.renderFrameCapture(
        target.frame,
        target.frameElementId,
        target.path,
        token
      )
      return
    }

    this.state.error = 'The picked element is no longer on the page'
    this.finishRender()
  }

  private handleRegionStart(): void {
    this.state.hover = null
    this.state.box = null
    this.state.marquee = null
  }

  private handleRegionChange(rect: TargetBox): void {
    this.state.marquee = rect
  }

  private handleRegion(rect: TargetBox): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const box = clampRegion(rect, viewport)

    this.state.mode = 'selected'
    this.state.hover = null
    this.state.marquee = null
    this.state.box = box
    this.state.capturing = true
    this.state.ready = false
    this.state.error = null
    this.state.captureSize = null

    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()

    this.beginRender()
    const token = (this.captureToken += 1)
    this.pending = this.renderRegionCapture(box, token)
  }

  private async renderRegionCapture(rect: TargetBox, token: number): Promise<void> {
    try {
      const transparent = Boolean(this.settings.get('capture.transparent'))
      const followPage = this.settings.get('capture.backgroundAuto') !== false
      const background = transparent
        ? undefined
        : followPage
          ? resolvePageBackground()
          : String(this.settings.get('capture.background') ?? '#ffffff')

      const result = await captureRegion(rect, {
        pixelRatio: this.pixelRatio(),
        maxDepth: this.frameDepth(),
        backgroundColor: background,
        filter: (node) => shouldCaptureNode(node) && !isMarkedUiNode(node)
      })

      if (token !== this.captureToken) return

      this.blob = result.blob
      this.state.captureSize = { width: result.width, height: result.height }
      this.setPreview(result.blob)
      this.state.ready = true
      if (result.limited) this.toast('app.toast.downscaled', 'info')
    } catch (error) {
      if (token !== this.captureToken) return
      const reason = describeCaptureError(error)
      console.error('[element-screenshot] region capture failed', reason, error)
      this.state.error = reason
      this.toast('app.toast.captureFailedDetail', 'error', { reason })
    } finally {
      if (token === this.captureToken) this.finishRender()
    }
  }

  private async renderCapture(element: Element, box: TargetBox, token: number): Promise<void> {
    try {
      const result = await captureElement(element, {
        expandNested: Boolean(this.settings.get('capture.expandNested')),
        background: this.captureBackground(),
        box,
        pixelRatio: this.pixelRatio(),
        maxDepth: this.frameDepth(),
        filter: (node) => shouldCaptureNode(node) && !isMarkedUiNode(node)
      })

      if (token !== this.captureToken) return

      this.blob = result.blob
      this.state.captureSize = { width: result.width, height: result.height }
      this.setPreview(result.blob)
      this.state.ready = true
      if (result.limited) this.toast('app.toast.downscaled', 'info')
    } catch (error) {
      if (token !== this.captureToken) return
      const reason = describeCaptureError(error)
      console.error('[element-screenshot] capture failed', reason, error)
      this.state.error = reason
      this.toast('app.toast.captureFailedDetail', 'error', { reason })
    } finally {
      if (token === this.captureToken) this.finishRender()
    }
  }

  /**
   * Capture one layer inside a frame.
   *
   * The frame renders in its own realm: its fonts and pixel ratio are its own,
   * and for a cross-origin frame it is the only realm that can read the document
   * at all. Cancelling stops the frame's render too, so a discarded capture does
   * not keep a foreign page busy.
   */
  private async renderFrameCapture(
    frame: HTMLIFrameElement,
    elementId: number,
    path: readonly number[],
    token: number
  ): Promise<void> {
    try {
      // A previous cancel leaves the flag set; this capture is a new request.
      native.capture.aborted = false
      const result = await requestFrameCapture(frame, {
        elementId,
        via: [...path],
        ratio: this.pixelRatio(),
        expandNested: Boolean(this.settings.get('capture.expandNested')),
        background: this.captureBackground(),
        maxDepth: this.frameDepth()
      })

      if (token !== this.captureToken) return
      if (!result) throw new Error('The frame returned no picture')

      this.blob = result.blob
      this.state.captureSize = { width: result.width, height: result.height }
      this.setPreview(result.blob)
      this.state.ready = true
      if (result.limited) this.toast('app.toast.downscaled', 'info')
    } catch (error) {
      if (token !== this.captureToken) return
      const reason = describeCaptureError(error)
      console.error('[element-screenshot] frame element capture failed', reason, error)
      this.state.error = reason
      this.toast('app.toast.captureFailedDetail', 'error', { reason })
    } finally {
      if (token === this.captureToken) this.finishRender()
    }
  }

  /** Effective export scale for this capture. */
  private pixelRatio(): number {
    const scaleSetting = String(this.settings.get('capture.scale') ?? 'auto')
    const requested =
      scaleSetting === 'auto' ? Math.min(native.devicePixelRatio || 1, 2) : Number(scaleSetting)
    return Number.isFinite(requested) && requested > 0 ? requested : 1
  }

  private captureBackground(): CaptureBackground {
    if (this.settings.get('capture.transparent')) return { mode: 'transparent' }
    if (this.settings.get('capture.backgroundAuto') === false) {
      return { mode: 'color', color: String(this.settings.get('capture.background') ?? '#ffffff') }
    }
    return { mode: 'page' }
  }

  /** The render runs on a snapshot, so the page stays usable until it ends. */
  private beginRender(): void {
    this.removeGuards()
    this.installCancelKey()
  }

  private finishRender(): void {
    this.state.capturing = false
    this.removeCancelKey()
    this.installGuards()
  }

  usePreviewFallback(): void {
    const blob = this.blob
    if (!blob || this.previewFallback) return
    this.previewFallback = true
    void readAsDataUrl(blob).then((url) => {
      // A later capture or a reset may have replaced the blob in the meantime.
      if (url && this.blob === blob) this.setPreviewUrl(url)
    })
  }

  private setPreview(blob: Blob | null): void {
    this.previewFallback = false
    const url = blob && native.createObjectURL ? native.createObjectURL(blob) : null
    this.setPreviewUrl(url)
  }

  private setPreviewUrl(url: string | null): void {
    const previous = this.state.previewUrl
    this.state.previewUrl = url
    if (previous && previous !== url && previous.startsWith('blob:')) {
      native.revokeObjectURL?.(previous)
    }
  }

  private async ensureBlob(): Promise<Blob | null> {
    if (this.pending) {
      try {
        await this.pending
      } catch {
        // renderCapture converts failures into state.
      }
    }
    if (this.blob) return this.blob
    if (this.state.error) {
      this.toast('app.toast.captureFailed', 'error')
    } else if (!this.state.capturing) {
      this.toast('app.toast.notReady', 'info')
    }
    return null
  }

  private download(blob: Blob, name: string): void {
    const url = native.createObjectURL?.(blob)
    if (!url) {
      throw new Error('Object URLs are not supported')
    }
    const anchor = native.document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    native.setAttribute(anchor, 'data-element-screenshot-ignore', '')
    const parent = native.document.body ?? native.document.documentElement
    if (parent) native.appendChild(parent, anchor)
    native.click(anchor)
    anchor.remove()
    native.setTimeout(() => native.revokeObjectURL?.(url), 10_000)
  }

  private clearSelection(): void {
    this.blob = null
    this.setPreviewUrl(null)
    this.pending = null
    this.state.hover = null
    this.state.box = null
    this.state.marquee = null
    this.state.capturing = false
    this.state.ready = false
    this.state.error = null
    this.state.captureSize = null
  }

  private installGuards(): void {
    if (this.guardsInstalled) return
    this.guardsInstalled = true
    native.addEventListener(window, 'pointerdown', this.handleGuardPointer, true)
    native.addEventListener(window, 'click', this.handleGuardPointer, true)
    native.addEventListener(window, 'wheel', this.handleGuardWheel, {
      capture: true,
      passive: false
    })
    native.addEventListener(window, 'contextmenu', this.handleGuardPointer, true)
    native.addEventListener(window, 'keydown', this.handleGuardKeyDown, true)
  }

  private removeGuards(): void {
    if (!this.guardsInstalled) return
    this.guardsInstalled = false
    native.removeEventListener(window, 'pointerdown', this.handleGuardPointer, true)
    native.removeEventListener(window, 'click', this.handleGuardPointer, true)
    native.removeEventListener(window, 'wheel', this.handleGuardWheel, true)
    native.removeEventListener(window, 'contextmenu', this.handleGuardPointer, true)
    native.removeEventListener(window, 'keydown', this.handleGuardKeyDown, true)
  }

  /**
   * While a capture renders the page is fully usable, so only Escape is
   * intercepted — and it is not swallowed, the page keeps receiving it.
   */
  private installCancelKey(): void {
    if (this.cancelKeyInstalled) return
    this.cancelKeyInstalled = true
    native.addEventListener(window, 'keydown', this.handleCancelKey, true)
  }

  private removeCancelKey(): void {
    if (!this.cancelKeyInstalled) return
    this.cancelKeyInstalled = false
    native.removeEventListener(window, 'keydown', this.handleCancelKey, true)
  }

  private readonly handleCancelKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.isUiEvent(event)) return
    this.reset()
  }

  private readonly handleGuardPointer = (event: Event): void => {
    if (this.isUiEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly handleGuardWheel = (event: WheelEvent): void => {
    if (this.isUiEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly handleGuardKeyDown = (event: KeyboardEvent): void => {
    if (this.isUiEvent(event)) return
    const command = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.reset()
      return
    }
    if (command && key === 'c') {
      event.preventDefault()
      event.stopImmediatePropagation()
      void this.copy()
      return
    }
    if (command && key === 's') {
      event.preventDefault()
      event.stopImmediatePropagation()
      void this.save()
      return
    }
    if (key === 'tab') {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  private updateViewport(): void {
    this.state.viewport = { width: window.innerWidth, height: window.innerHeight }
    this.repositionFab()
  }

  private readonly handleResize = (): void => {
    this.updateViewport()
  }
}

export function createShotApp(options: ShotAppOptions): ShotApp {
  return new ShotApp(options.settings, options.i18n, options.styles)
}
