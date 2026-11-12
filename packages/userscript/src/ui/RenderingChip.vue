<script setup lang="ts">
import type { ShotAppApi } from './api'

const props = defineProps<{
  app: ShotAppApi
}>()

const t = (key: string): string => props.app.i18n.t(key)
</script>

<template>
  <!--
    The render runs on a snapshot, so the page stays usable. This is the only
    chrome shown while it does: a small chip with a cancel button.
  -->
  <div class="pointer-events-none fixed inset-x-0 top-4 flex justify-center">
    <div
      class="pointer-events-auto flex items-center gap-2.5 rounded-full border border-zinc-200 bg-white/95 px-3.5 py-2 text-xs font-medium text-zinc-700 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
    >
      <span
        class="h-3 w-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"
        aria-hidden="true"
      />
      <span>{{ t('app.hint.rendering') }}</span>
      <span class="hidden text-[11px] font-normal text-zinc-500 sm:inline dark:text-zinc-400">
        {{ t('app.hint.renderingNote') }}
      </span>
      <button
        type="button"
        class="rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        @click="app.cancel()"
      >
        {{ t('app.action.cancel') }}
      </button>
    </div>
  </div>
</template>
