import type { I18n, SettingsController } from '@element-screenshot/settings'
import type { FabPlacement } from './fab-position'
import type { RelayedKey } from '../core/relay-key'

export type PickerMode = 'idle' | 'picking' | 'selected'
export type ToastTone = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

export interface PickerBox {
  left: number
  top: number
  width: number
  height: number
}

export interface PickerHover {
  label: string
  /** Visible size: what the user sees on screen right now. */
  width: number
  height: number
  /** Visible box, drawn as a solid frame. */
  rect: PickerBox
  /** Size the capture will have: the visible box grown to the scroll content. */
  contentWidth: number
  contentHeight: number
  /** Set when the element scrolls by itself, so the capture gets longer. */
  scrollAxis: 'y' | 'x' | 'both' | null
  scrollable: boolean
  depth: number
  total: number
  fullPage: boolean
}

export interface CaptureSize {
  width: number
  height: number
}

export interface ShotState {
  mode: PickerMode
  hover: PickerHover | null
  box: PickerBox | null
  /** Rectangle being dragged out; only set while the pointer button is down. */
  marquee: PickerBox | null
  cursor: { x: number; y: number }
  capturing: boolean
  ready: boolean
  error: string | null
  captureSize: CaptureSize | null
  /** Object (or data) URL of the finished capture, shown in the result viewer. */
  previewUrl: string | null
  toasts: ToastItem[]
  /** Resting placement; a docked button is parked half outside the viewport. */
  fab: FabPlacement
  viewport: { width: number; height: number }
}

export interface ShotAppApi {
  readonly state: ShotState
  readonly settings: SettingsController
  readonly i18n: I18n
  startPicker(): void
  cancel(): void
  /** Act on a key a frame reported while our UI is open. */
  handleRelayedKey(stroke: RelayedKey): boolean
  cycle(delta: number): void
  /** Jump to the next/previous layer that scrolls by itself. */
  cycleScroll(delta: number): void
  copy(): Promise<void>
  save(): Promise<void>
  /**
   * Re-decode the preview as a data URL. Blob URLs are blocked by some pages'
   * `img-src` policy, which would leave the viewer blank.
   */
  usePreviewFallback(): void
  repositionFab(): void
  setFabPosition(left: number, top: number, commit: boolean): void
  toast(key: string, tone?: ToastTone, params?: Record<string, string | number>): void
  isUiEvent(event: Event): boolean
}
