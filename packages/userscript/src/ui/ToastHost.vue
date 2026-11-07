<script setup lang="ts">
import { AlertIcon, CheckIcon, InfoIcon } from '@element-screenshot/settings'
import type { ToastItem } from './api'

defineProps<{
  toasts: ToastItem[]
}>()

const iconFor = (tone: ToastItem['tone']) => {
  if (tone === 'success') return CheckIcon
  if (tone === 'error') return AlertIcon
  return InfoIcon
}

const toneClass = (tone: ToastItem['tone']): string => {
  if (tone === 'success')
    return 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300'
  if (tone === 'error')
    return 'border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300'
  return 'border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200'
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-4 z-20 mx-auto flex max-w-[min(92vw,420px)] flex-col items-center gap-2"
    role="status"
    aria-live="polite"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-full items-center gap-2 rounded-md border bg-white/95 px-3 py-2 text-xs font-medium shadow-sm backdrop-blur dark:bg-zinc-900/95"
      :class="toneClass(toast.tone)"
    >
      <component :is="iconFor(toast.tone)" :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1">{{ toast.message }}</span>
    </div>
  </div>
</template>
