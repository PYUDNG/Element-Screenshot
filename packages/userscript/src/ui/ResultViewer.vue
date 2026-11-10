<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { CSSProperties } from 'vue'
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon
} from '@element-screenshot/settings'
import type { ShotAppApi } from './api'

const props = defineProps<{
  app: ShotAppApi
}>()

const state = props.app.state
const t = (key: string, params?: Record<string, string | number>): string =>
  props.app.i18n.t(key, params)

const transparent = computed(() => Boolean(props.app.settings.get('capture.transparent')))

const dimensions = computed(() => {
  const size = state.captureSize
  return size ? `${size.width} × ${size.height}` : ''
})

/** Transparent captures need something behind them to be visible at all. */
const checkerStyle: CSSProperties = {
  backgroundImage: 'repeating-conic-gradient(#3f3f46 0% 25%, #27272a 0% 50%)',
  backgroundSize: '16px 16px'
}

const MIN_ZOOM = 1
const MAX_ZOOM = 10
/** A click is a two-state toggle, so it jumps instead of stepping. */
const CLICK_ZOOM = 3
const WHEEL_STEP = 0.0012
/** Ignore sub-pixel jitter so a click is not mistaken for a drag. */
const DRAG_THRESHOLD = 3

const stageRef = ref<HTMLElement | null>(null)
const stage = reactive({ width: 0, height: 0 })
const zoom = ref(MIN_ZOOM)
const pan = reactive({ x: 0, y: 0 })
const dragging = ref(false)

const natural = computed(() => {
  const size = state.captureSize
  return size ? { width: size.width, height: size.height } : null
})

/**
 * CSS pixels per image pixel at rest. Never above 1: a small capture is shown
 * at its own size rather than blown up and blurred.
 */
const fitScale = computed(() => {
  const size = natural.value
  if (!size || !stage.width || !stage.height) return 1
  return Math.min(1, stage.width / size.width, stage.height / size.height)
})

const displaySize = computed(() => {
  const size = natural.value
  if (!size) return null
  const scale = fitScale.value * zoom.value
  return { width: size.width * scale, height: size.height * scale }
})

/** Zoom relative to the image itself, which is what the badge reports. */
const zoomPercent = computed(() => `${Math.round(fitScale.value * zoom.value * 100)}%`)
const zoomed = computed(() => zoom.value > MIN_ZOOM + 0.01)

const cursor = computed(() => {
  if (dragging.value) return 'grabbing'
  return zoomed.value ? 'zoom-out' : 'zoom-in'
})

const imageStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    cursor: cursor.value,
    // Pointer events drive panning, so touch scrolling must stay out of the way.
    touchAction: 'none'
  }
  const size = displaySize.value
  if (size) {
    style.width = `${size.width}px`
    style.height = `${size.height}px`
    style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0)`
  }
  if (transparent.value) Object.assign(style, checkerStyle)
  return style
})

/** Keep the image from being dragged off its own viewport. */
function clampPan(): void {
  const size = displaySize.value
  if (!size) return
  const limitX = Math.max(0, (size.width - stage.width) / 2)
  const limitY = Math.max(0, (size.height - stage.height) / 2)
  pan.x = Math.min(limitX, Math.max(-limitX, pan.x))
  pan.y = Math.min(limitY, Math.max(-limitY, pan.y))
}

/**
 * `anchor` is the zoom origin in stage-centred pixels, so the point under the
 * cursor stays put while the wheel steps.
 */
function setZoom(next: number, anchor?: { x: number; y: number }): void {
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
  if (target === zoom.value) {
    clampPan()
    return
  }

  if (anchor && natural.value) {
    const unit = fitScale.value * zoom.value
    const nextUnit = fitScale.value * target
    const originX = (anchor.x - pan.x) / unit
    const originY = (anchor.y - pan.y) / unit
    zoom.value = target
    pan.x = anchor.x - originX * nextUnit
    pan.y = anchor.y - originY * nextUnit
  } else {
    zoom.value = target
  }

  if (zoom.value === MIN_ZOOM) {
    pan.x = 0
    pan.y = 0
  }
  clampPan()
}

function toggleZoom(): void {
  setZoom(zoomed.value ? MIN_ZOOM : CLICK_ZOOM)
}

function anchorFrom(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return null
  return {
    x: event.clientX - rect.left - rect.width / 2,
    y: event.clientY - rect.top - rect.height / 2
  }
}

function wheelFactor(event: WheelEvent): number {
  const mode = event.deltaMode
  const delta = mode === 1 ? event.deltaY * 16 : mode === 2 ? event.deltaY * 100 : event.deltaY
  if (!delta) return 1
  // Clamp per event so one runaway device cannot jump the whole range.
  return Math.min(1.25, Math.max(0.8, Math.exp(-delta * WHEEL_STEP)))
}

function onWheel(event: WheelEvent): void {
  const anchor = anchorFrom(event) ?? undefined
  setZoom(zoom.value * wheelFactor(event), anchor)
}

const drag = { id: -1, x: 0, y: 0, panX: 0, panY: 0, moved: false }

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const target = event.currentTarget as HTMLElement | null
  try {
    target?.setPointerCapture?.(event.pointerId)
  } catch {
    // Capture is a nicety; dragging still works without it.
  }
  drag.id = event.pointerId
  drag.x = event.clientX
  drag.y = event.clientY
  drag.panX = pan.x
  drag.panY = pan.y
  drag.moved = false
  dragging.value = true
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value || drag.id !== event.pointerId) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return
  drag.moved = true
  pan.x = drag.panX + dx
  pan.y = drag.panY + dy
  clampPan()
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value || drag.id !== event.pointerId) return
  const target = event.currentTarget as HTMLElement | null
  try {
    target?.releasePointerCapture?.(event.pointerId)
  } catch {
    // Nothing to release.
  }
  const moved = drag.moved
  dragging.value = false
  drag.id = -1
  // A drag must not also toggle the zoom: the two live on the same button.
  if (!moved) toggleZoom()
}

function measure(): void {
  const element = stageRef.value
  if (!element) return
  stage.width = element.clientWidth
  stage.height = element.clientHeight
  clampPan()
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && stageRef.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(stageRef.value)
  }
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <!--
    The page may have scrolled or changed since the element was picked, so the
    result is shown on its own instead of over the stale selection frame.
    The backdrop does not close: a long render must not be lost by a stray click.
  -->
  <div
    class="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-zinc-950/75 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    :aria-label="t('app.hint.preview')"
    @wheel.prevent
  >
    <button
      type="button"
      class="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-zinc-900/80 text-zinc-200 shadow-lg transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 sm:right-5 sm:top-5 sm:h-11 sm:w-11"
      :aria-label="t('app.action.close')"
      :title="t('app.action.close')"
      @click="app.cancel()"
    >
      <CloseIcon :size="20" />
    </button>

    <div class="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
      <div
        ref="stageRef"
        class="relative flex h-full w-full items-center justify-center overflow-hidden"
      >
        <div
          v-if="state.error"
          class="flex max-w-[min(92vw,420px)] flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 px-6 py-7 text-center shadow-2xl"
        >
          <AlertIcon :size="26" class="text-red-400" />
          <p class="text-sm font-medium text-zinc-100">{{ t('app.hint.failed') }}</p>
          <p class="max-w-full break-words text-xs leading-relaxed text-zinc-400">
            {{ state.error }}
          </p>
          <button
            type="button"
            class="mt-1 rounded border border-zinc-600 px-3 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            @click="app.cancel()"
          >
            {{ t('app.action.close') }}
          </button>
        </div>

        <img
          v-else-if="state.previewUrl"
          :src="state.previewUrl"
          :alt="t('app.hint.preview')"
          draggable="false"
          class="block max-w-none shrink-0 select-none rounded-md shadow-2xl ring-1 ring-white/15"
          :style="imageStyle"
          @error="app.usePreviewFallback()"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
        />

        <div
          v-else
          class="flex flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 px-6 py-7 text-center shadow-2xl"
        >
          <ImageIcon :size="26" class="text-zinc-500" />
          <p class="text-xs text-zinc-400">{{ t('app.hint.previewUnavailable') }}</p>
        </div>
      </div>
    </div>

    <div class="shrink-0 px-3 pb-3">
      <div
        class="mx-auto flex max-w-[860px] flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
      >
        <span class="flex items-center gap-1.5 font-medium">
          <ImageIcon :size="14" class="text-blue-600 dark:text-blue-400" />
          <span class="tabular-nums">{{ dimensions }}</span>
        </span>

        <span
          v-if="zoomed"
          class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
        >
          {{ zoomPercent }}
        </span>

        <span class="mx-1 hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-700" />

        <span
          v-if="state.ready"
          class="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
        >
          <CheckIcon :size="12" />
          {{ t('app.hint.ready') }}
        </span>

        <span class="hidden text-[11px] text-zinc-500 md:inline dark:text-zinc-400">
          {{ t('app.hint.selected') }}
        </span>

        <div class="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :disabled="!state.ready"
            @click="app.copy()"
          >
            <CopyIcon :size="12" />
            {{ t('app.action.copy') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :disabled="!state.ready"
            @click="app.save()"
          >
            <DownloadIcon :size="12" />
            {{ t('app.action.save') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            @click="app.cancel()"
          >
            <CloseIcon :size="12" />
            {{ t('app.action.close') }}
          </button>
        </div>

        <span class="hidden text-[10px] text-zinc-400 lg:flex">
          {{ t('app.hint.zoom') }} · {{ t('app.hint.esc') }}
        </span>
      </div>
    </div>
  </div>
</template>
