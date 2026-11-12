<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import {
  CameraIcon,
  CloseIcon,
  MaximizeIcon,
  MinusIcon,
  PlusIcon
} from '@element-screenshot/settings'
import type { ShotAppApi } from './api'
import { computePickerLabelPosition } from './picker-label'

const props = defineProps<{
  app: ShotAppApi
}>()

const state = props.app.state
const t = (key: string, params?: Record<string, string | number>): string =>
  props.app.i18n.t(key, params)

const borderColor = computed(() =>
  String(props.app.settings.get('capture.borderColor') ?? '#2563eb')
)
const borderWidth = computed(() => {
  const value = props.app.settings.get('capture.borderWidth')
  return typeof value === 'number' && Number.isFinite(value) ? value : 2
})
const pointerPassthrough = computed(() => props.app.settings.get('capture.pointerPassthrough') === true)

/**
 * The capture box can be taller (or wider) than what is on screen: that is the
 * scroll content this element would add. Draw it dashed so the difference is
 * visible, and keep the visible box solid.
 */
const contentBoxStyle = computed<CSSProperties>(() => {
  const box = state.box
  if (!box) return {}
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderColor: borderColor.value,
    borderWidth: `${Math.max(1, borderWidth.value - 1)}px`,
    borderStyle: 'dashed',
    boxSizing: 'border-box',
    opacity: 0.75
  }
})

const visibleStyle = computed<CSSProperties>(() => {
  const rect = state.hover?.rect
  if (!rect) return {}
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderColor: borderColor.value,
    borderWidth: `${borderWidth.value}px`,
    borderStyle: 'solid',
    boxSizing: 'border-box'
  }
})

const showsContentBox = computed(() => {
  const box = state.box
  const rect = state.hover?.rect
  if (!box || !rect) return false
  return (
    box.width - rect.width > 0.5 ||
    box.height - rect.height > 0.5 ||
    Math.abs(box.left - rect.left) > 0.5 ||
    Math.abs(box.top - rect.top) > 0.5
  )
})

const marqueeStyle = computed<CSSProperties>(() => {
  const marquee = state.marquee
  if (!marquee) return {}
  return {
    left: `${marquee.left}px`,
    top: `${marquee.top}px`,
    width: `${marquee.width}px`,
    height: `${marquee.height}px`,
    borderColor: borderColor.value,
    borderWidth: `${borderWidth.value}px`,
    borderStyle: 'dashed',
    boxSizing: 'border-box',
    // Dim everything outside the rectangle without a second full-screen layer.
    boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.22)'
  }
})

const marqueeLabelStyle = computed(() => {
  const marquee = state.marquee
  if (!marquee) return {}
  const position = computePickerLabelPosition(
    marquee.left,
    marquee.top,
    state.viewport.width,
    state.viewport.height
  )
  return {
    left: `${position.left}px`,
    top: `${position.top}px`,
    maxWidth: `${position.maxWidth}px`
  }
})

const marqueeSize = computed(() =>
  state.marquee ? `${state.marquee.width} × ${state.marquee.height}` : ''
)

const labelStyle = computed(() => {
  const box = state.box
  if (!box) return {}
  const position = computePickerLabelPosition(
    box.left,
    box.top,
    state.viewport.width,
    state.viewport.height
  )
  return {
    left: `${position.left}px`,
    top: `${position.top}px`,
    maxWidth: `${position.maxWidth}px`
  }
})

const dimensions = computed(() => {
  if (state.hover) return `${state.hover.width} × ${state.hover.height}`
  if (state.box) return `${state.box.width} × ${state.box.height}`
  return ''
})

/** `可滚动 ↓2341px`: what this layer would add if it were captured. */
const scrollBadge = computed(() => {
  const hover = state.hover
  if (!hover || !hover.scrollAxis) return ''
  const label = t('app.hint.scrollable')
  if (hover.scrollAxis === 'y') return `${label} ↓${hover.contentHeight}px`
  if (hover.scrollAxis === 'x') return `${label} →${hover.contentWidth}px`
  return `${label} ↕${hover.contentWidth}×${hover.contentHeight}`
})

const canGoShallower = computed(() => (state.hover?.depth ?? 1) > 1)
const canGoDeeper = computed(() => (state.hover?.depth ?? 1) < (state.hover?.total ?? 1))
</script>

<template>
  <div class="pointer-events-none fixed inset-0">
    <div
      v-if="!pointerPassthrough"
      data-element-screenshot-pick-surface
      class="pointer-events-auto fixed inset-0 z-0 cursor-crosshair"
      aria-hidden="true"
    />

    <template v-if="state.mode === 'picking' && !state.marquee">
      <div class="fixed inset-y-0 w-px bg-primary-500/35" :style="{ left: `${state.cursor.x}px` }" />
      <div class="fixed inset-x-0 h-px bg-primary-500/35" :style="{ top: `${state.cursor.y}px` }" />
    </template>

    <div
      v-if="state.marquee"
      class="pointer-events-none fixed z-[5]"
      :style="marqueeStyle"
      aria-hidden="true"
    />

    <div
      v-if="state.marquee"
      class="pointer-events-none fixed z-10 flex items-center gap-2 rounded-md border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 shadow-sm tabular-nums backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
      :style="marqueeLabelStyle"
    >
      {{ marqueeSize }}
    </div>

    <div
      v-if="state.box && showsContentBox"
      data-frame="content"
      class="fixed"
      :style="contentBoxStyle"
      aria-hidden="true"
    />

    <div v-if="state.hover" data-frame="visible" class="fixed" :style="visibleStyle" aria-hidden="true" />

    <div
      v-if="state.hover && state.mode === 'picking'"
      class="pointer-events-none fixed z-10 flex max-w-[min(92vw,360px)] items-center gap-2 rounded-md border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
      :style="labelStyle"
    >
      <span class="truncate font-mono text-[11px] font-medium">{{ state.hover.label }}</span>
      <span
        v-if="state.hover.inFrame"
        class="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
      >
        {{ state.hover.frameLevel > 1 ? `${t('app.hint.inFrame')}×${state.hover.frameLevel}` : t('app.hint.inFrame') }}
      </span>
      <span class="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{{ dimensions }}</span>
      <span
        v-if="state.hover.fullPage"
        class="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-700 dark:bg-primary-500/15 dark:text-primary-300"
      >
        {{ t('app.hint.fullPage') }}
      </span>
      <span
        v-else-if="scrollBadge"
        class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      >
        {{ scrollBadge }}
      </span>
      <span class="shrink-0 font-mono text-[10px] text-zinc-400">
        {{ state.hover.depth }}/{{ state.hover.total }}
      </span>
    </div>

    <div
      class="pointer-events-auto fixed bottom-4 left-3 right-3 z-10 mx-auto flex max-w-[860px] flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
      @click.stop
      @pointerdown.stop
      @wheel.stop
    >
      <template v-if="state.mode === 'picking'">
        <span class="flex items-center gap-1.5 font-medium">
          <CameraIcon :size="14" class="text-primary-600 dark:text-primary-400" />
          {{ t('app.hint.pickTitle') }}
        </span>

        <span class="mx-1 hidden h-4 w-px bg-zinc-200 dark:bg-zinc-700 sm:block" />

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            :disabled="!canGoShallower"
            :aria-label="t('app.hint.shallower')"
            :title="t('app.hint.shallower')"
            @click="app.cycle(-1)"
          >
            <MinusIcon :size="12" />
          </button>
          <span class="w-10 text-center font-mono text-[11px] tabular-nums">
            {{ state.hover?.depth ?? 0 }}/{{ state.hover?.total ?? 0 }}
          </span>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            :disabled="!canGoDeeper"
            :aria-label="t('app.hint.deeper')"
            :title="t('app.hint.deeper')"
            @click="app.cycle(1)"
          >
            <PlusIcon :size="12" />
          </button>
        </div>

        <span
          v-if="state.marquee"
          class="hidden text-[11px] text-zinc-500 dark:text-zinc-400 md:inline"
        >
          {{ t('app.hint.region') }}
        </span>
        <span v-else class="hidden text-[11px] text-zinc-500 dark:text-zinc-400 md:inline">
          {{ t('app.hint.pick') }}
        </span>

        <button
          type="button"
          class="ml-auto inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          title="Esc"
          @click="app.cancel()"
        >
          <CloseIcon :size="12" />
          {{ t('app.action.close') }}
        </button>
      </template>

      <span class="hidden items-center gap-1 text-[10px] text-zinc-400 lg:flex">
        <MaximizeIcon :size="10" />
        {{ t('app.hint.esc') }}
      </span>
    </div>
  </div>
</template>
