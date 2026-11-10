<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  MaximizeIcon
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
const checkerStyle = {
  backgroundImage: 'repeating-conic-gradient(#3f3f46 0% 25%, #27272a 0% 50%)',
  backgroundSize: '16px 16px'
}
</script>

<template>
  <!--
    The page may have scrolled or changed since the element was picked, so the
    result is shown on its own instead of over the stale selection frame.
  -->
  <div
    class="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-zinc-950/75 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    :aria-label="t('app.hint.preview')"
    @click.self="app.cancel()"
  >
    <div
      class="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8"
      @click.self="app.cancel()"
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
        class="block max-h-full max-w-full rounded-md object-contain shadow-2xl ring-1 ring-white/15 select-none"
        :style="transparent ? checkerStyle : undefined"
        @error="app.usePreviewFallback()"
      />

      <div
        v-else
        class="flex flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 px-6 py-7 text-center shadow-2xl"
      >
        <ImageIcon :size="26" class="text-zinc-500" />
        <p class="text-xs text-zinc-400">{{ t('app.hint.previewUnavailable') }}</p>
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

        <span class="hidden items-center gap-1 text-[10px] text-zinc-400 lg:flex">
          <MaximizeIcon :size="10" />
          {{ t('app.hint.esc') }}
        </span>
      </div>
    </div>
  </div>
</template>
