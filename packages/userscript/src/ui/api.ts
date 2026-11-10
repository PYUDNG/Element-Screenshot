import type { I18n, SettingsController } from '@element-screenshot/settings'
import type { FabPlacement } from './fab-position'

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
  width: number
  height: number
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
  cycle(delta: number): void
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
