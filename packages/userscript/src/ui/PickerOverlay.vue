<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import {
  CameraIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  MaximizeIcon,
  MinusIcon,
  PlusIcon
} from '@element-shot/settings'
import type { ShotAppApi } from './api'

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

const boxStyle = computed<CSSProperties>(() => {
  const box = state.box
  if (!box) return {}
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderColor: borderColor.value,
    borderWidth: `${borderWidth.value}px`,
    borderStyle: 'solid',
    boxSizing: 'border-box'
  }
})

const labelStyle = computed(() => {
  const box = state.box
  if (!box) return {}
  const viewport = state.viewport
  const top =
    box.top >= 46 ? box.top - 38 : Math.min(box.top + 8, Math.max(8, viewport.height - 46))
  const left = Math.min(Math.max(box.left, 8), Math.max(8, viewport.width - 320))
  return { left: `${left}px`, top: `${top}px` }
})

const dimensions = computed(() => {
  if (state.hover) return `${state.hover.width} × ${state.hover.height}`
  if (state.box) return `${state.box.width} × ${state.box.height}`
  return ''
})

const canGoShallower = computed(() => (state.hover?.depth ?? 1) > 1)
const canGoDeeper = computed(() => (state.hover?.depth ?? 1) < (state.hover?.total ?? 1))
const selectedDimensions = computed(() => {
  const size = state.captureSize
  return size ? `${size.width} × ${size.height}` : ''
})
</script>

<template>
  <div class="pointer-events-none fixed inset-0">
    <template v-if="state.mode === 'picking'">
      <div class="fixed inset-y-0 w-px bg-blue-500/35" :style="{ left: `${state.cursor.x}px` }" />
      <div class="fixed inset-x-0 h-px bg-blue-500/35" :style="{ top: `${state.cursor.y}px` }" />
    </template>

    <div v-if="state.box" class="fixed" :style="boxStyle" aria-hidden="true" />

    <div
      v-if="state.hover && state.mode === 'picking'"
      class="pointer-events-none fixed z-10 flex max-w-[min(92vw,360px)] items-center gap-2 rounded-md border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
      :style="labelStyle"
    >
      <span class="truncate font-mono text-[11px] font-medium">{{ state.hover.label }}</span>
      <span class="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{{ dimensions }}</span>
      <span
        v-if="state.hover.fullPage"
        class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
      >
        {{ t('app.hint.fullPage') }}
      </span>
      <span
        v-else-if="state.hover.scrollable"
        class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      >
        {{ t('app.hint.scrollable') }}
      </span>
      <span class="shrink-0 font-mono text-[10px] text-zinc-400">
        {{ state.hover.depth }}/{{ state.hover.total }}
      </span>
    </div>

    <div
      class="pointer-events-auto fixed bottom-4 left-1/2 z-10 flex w-[min(94vw,860px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
      @click.stop
      @pointerdown.stop
      @wheel.stop
    >
      <template v-if="state.mode === 'picking'">
        <span class="flex items-center gap-1.5 font-medium">
          <CameraIcon :size="14" class="text-blue-600 dark:text-blue-400" />
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

        <span class="hidden text-[11px] text-zinc-500 dark:text-zinc-400 md:inline">
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

      <template v-else>
        <span class="flex items-center gap-1.5 font-medium">
          <ImageIcon :size="14" class="text-blue-600 dark:text-blue-400" />
          <span v-if="state.capturing">{{ t('app.hint.rendering') }}</span>
          <span v-else-if="state.error">{{ t('app.hint.failed') }}</span>
          <span v-else>{{ selectedDimensions }}</span>
        </span>

        <span class="mx-1 hidden h-4 w-px bg-zinc-200 dark:bg-zinc-700 sm:block" />

        <span
          v-if="state.capturing"
          class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
          aria-hidden="true"
        />

        <span
          v-else-if="state.ready"
          class="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
        >
          <CheckIcon :size="12" />
          {{ t('app.hint.ready') }}
        </span>

        <span class="hidden text-[11px] text-zinc-500 dark:text-zinc-400 md:inline">
          {{ t('app.hint.selected') }}
        </span>

        <div class="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :disabled="state.capturing"
            @click="app.copy()"
          >
            <CopyIcon :size="12" />
            {{ t('app.action.copy') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :disabled="state.capturing"
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
      </template>

      <span class="hidden items-center gap-1 text-[10px] text-zinc-400 lg:flex">
        <MaximizeIcon :size="10" />
        {{ t('app.hint.esc') }}
      </span>
    </div>
  </div>
</template>
