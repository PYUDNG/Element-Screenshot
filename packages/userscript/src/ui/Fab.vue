<script setup lang="ts">
import { computed, watch } from 'vue'
import { CameraIcon } from '@element-screenshot/settings'
import type { ShotAppApi } from './api'

const props = defineProps<{
  app: ShotAppApi
}>()

const state = props.app.state
const size = computed(() => {
  const value = props.app.settings.get('trigger.fabSize')
  return typeof value === 'number' && Number.isFinite(value) ? value : 48
})
const label = computed(() => props.app.i18n.t('app.fab.label'))

const style = computed(() => ({
  left: `${state.fab.left}px`,
  top: `${state.fab.top}px`,
  width: `${size.value}px`,
  height: `${size.value}px`
}))

let pointerId: number | null = null
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0
let moved = false
let suppressClick = false

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
  if (moved) {
    props.app.setFabPosition(state.fab.left, state.fab.top, true)
    suppressClick = true
    moved = false
  }
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
    class="pointer-events-auto fixed flex cursor-grab touch-none select-none items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 outline-none transition-colors hover:border-blue-400 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500/50 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-500 dark:hover:text-blue-400"
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
