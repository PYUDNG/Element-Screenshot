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
import { native } from '../core/native'
import { ElementPicker } from '../core/picker'
import { clampRegion } from '../core/region'
import { describeTarget, getTargetBox } from '../core/target'
import type { TargetBox } from '../core/target'
import InPageApp from './InPageApp.vue'
import type { PickerHover, ShotAppApi, ShotState, ToastTone } from './api'
import {
  freeRatio,
  placeStored,
  readDock,
  resolveDrop,
  clampToViewport
} from './fab-position'
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
  private guardsInstalled = false
  private cancelKeyInstalled = false
  private stopSettingsWatch: (() => void) | null = null

  constructor(
    readonly settings: SettingsController,
    readonly i18n: I18n,
    private readonly styles: string
  ) {
    this.picker = new ElementPicker({
      onHover: (element, index, total) => this.handleHover(element, index, total),
      onSelect: (element) => this.handleSelect(element),
      onCancel: () => this.reset(),
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
    this.state.mode = 'picking'
    this.picker.start()
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
  }

  cycle(delta: number): void {
    this.picker.cycle(delta)
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

  private handleHover(element: Element | null, index: number, total: number): void {
    if (!element) {
      this.state.hover = null
      this.state.box = null
      return
    }

    const info = describeTarget(element)
    const hover: PickerHover = {
      label: info.label,
      width: info.box.width,
      height: info.box.height,
      scrollable: info.scrollable,
      depth: index + 1,
      total,
      fullPage: element === document.documentElement
    }
    this.state.hover = hover
    this.state.box = info.box
  }

  private handleSelect(element: Element): void {
    this.state.mode = 'selected'
    this.state.hover = null
    this.state.marquee = null
    this.state.box = getTargetBox(element)
    this.state.capturing = true
    this.state.ready = false
    this.state.error = null
    this.state.captureSize = null

    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()

    this.beginRender()
    const token = (this.captureToken += 1)
    this.pending = this.renderCapture(element, token)
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
        backgroundColor: background,
        filter: (node) => shouldCaptureNode(node) && !isMarkedUiNode(node)
      })

      if (token !== this.captureToken) return

      this.blob = result.blob
      this.state.captureSize = { width: result.width, height: result.height }
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

  private async renderCapture(element: Element, token: number): Promise<void> {
    try {
      const result = await captureElement(element, {
        expandNested: Boolean(this.settings.get('capture.expandNested')),
        background: this.captureBackground(),
        pixelRatio: this.pixelRatio(),
        filter: (node) => shouldCaptureNode(node) && !isMarkedUiNode(node)
      })

      if (token !== this.captureToken) return

      this.blob = result.blob
      this.state.captureSize = { width: result.width, height: result.height }
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
    native.addEventListener(window, 'dblclick', this.handleGuardDoubleClick, true)
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
    native.removeEventListener(window, 'dblclick', this.handleGuardDoubleClick, true)
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

  private readonly handleGuardDoubleClick = (event: MouseEvent): void => {
    if (this.isUiEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void this.save()
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
