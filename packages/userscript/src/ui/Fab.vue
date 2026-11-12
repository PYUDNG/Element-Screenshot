<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CameraIcon } from '@element-screenshot/settings'
import { native } from '../core/native'
import type { ShotAppApi } from './api'
import { peekStyle } from './fab-position'

const props = defineProps<{
  app: ShotAppApi
}>()

const state = props.app.state
const size = computed(() => {
  const value = props.app.settings.get('trigger.fabSize')
  return typeof value === 'number' && Number.isFinite(value) ? value : 48
})
const label = computed(() => props.app.i18n.t('app.fab.label'))

/**
 * A docked button is parked half outside the viewport. Hovering it — or dragging
 * it — slides it back in, so the hidden half is only reachable through the
 * pointer instead of being permanently on screen.
 */
const hovered = ref(false)
const dragging = ref(false)
const canHover = computed(() => {
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(hover: hover)').matches
})
const revealed = computed(() => hovered.value || dragging.value || !canHover.value)
const peek = computed(() =>
  canHover.value ? peekStyle(state.fab, revealed.value) : { transform: 'none', opacity: 1 }
)

const style = computed(() => ({
  left: `${state.fab.left}px`,
  top: `${state.fab.top}px`,
  width: `${size.value}px`,
  height: `${size.value}px`,
  transform: peek.value.transform,
  opacity: `${peek.value.opacity}`
}))

let pointerId: number | null = null
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0
let moved = false
let suppressClick = false

/**
 * Hover is derived from the pointer position rather than from `pointerenter` /
 * `pointerleave`: enter and leave are suppressed while a pointer capture is
 * active, so after dragging the button to an edge it could stay parked under the
 * cursor until the pointer left and came back. The hit test uses the resting
 * (revealed) box, which keeps the state stable while the button slides.
 */
function isOverFab(x: number, y: number): boolean {
  const box = state.fab
  return x >= box.left && x <= box.left + size.value && y >= box.top && y <= box.top + size.value
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerType === 'touch' || pointerId !== null) return
  hovered.value = isOverFab(event.clientX, event.clientY)
}

function handlePointerOut(event: PointerEvent): void {
  // The pointer left the window entirely: no further moves will arrive.
  if (event.relatedTarget === null) hovered.value = false
}

onMounted(() => {
  native.addEventListener(window, 'pointermove', handlePointerMove, { passive: true })
  native.addEventListener(window, 'pointerout', handlePointerOut, true)
})

onUnmounted(() => {
  native.removeEventListener(window, 'pointermove', handlePointerMove)
  native.removeEventListener(window, 'pointerout', handlePointerOut, true)
})

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || pointerId !== null) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  startLeft = state.fab.left
  startTop = state.fab.top
  moved = false
  dragging.value = true
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY
  if (!moved && Math.hypot(deltaX, deltaY) > 4) moved = true
  if (!moved) return
  props.app.setFabPosition(startLeft + deltaX, startTop + deltaY, false)
}

function onPointerUp(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return
  pointerId = null
  dragging.value = false
  if (moved) {
    props.app.setFabPosition(state.fab.left, state.fab.top, true)
    suppressClick = true
    moved = false
  }
  // A docked button that was dropped under the pointer has to stay revealed.
  hovered.value = isOverFab(event.clientX, event.clientY)
}

function onClick(): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  props.app.startPicker()
}

watch(size, () => props.app.repositionFab())
</script>

<template>
  <button
    type="button"
    class="pointer-events-auto fixed flex cursor-grab touch-none select-none items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 outline-none transition duration-150 ease-out hover:border-primary-400 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500/50 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-primary-500 dark:hover:text-primary-400"
    :style="style"
    :aria-label="label"
    :title="label"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click="onClick"
    @keydown.enter.prevent="app.startPicker()"
    @keydown.space.prevent="app.startPicker()"
  >
    <CameraIcon :size="Math.round(size * 0.44)" />
  </button>
</template>
