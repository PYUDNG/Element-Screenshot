<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { CloseIcon } from '../icons'
import type { I18n } from '../i18n'
import { formatShortcut, isShortcutValid, serializeShortcut, shortcutFromEvent } from '../shortcut'

const props = withDefaults(
  defineProps<{
    modelValue: string
    i18n: I18n
    allowClear?: boolean
    disabled?: boolean
  }>(),
  {
    allowClear: true,
    disabled: false
  }
)

const emit = defineEmits<{
  (event: 'update', value: string): void
}>()

const recording = ref(false)
const error = ref('')

const t = (key: string): string => props.i18n.t(key)
const display = computed(() => formatShortcut(props.modelValue))
const isModifierOnly = (key: string): boolean =>
  ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'].includes(key)

function stop(): void {
  recording.value = false
  window.removeEventListener('keydown', onKeydown, true)
}

function start(): void {
  if (props.disabled) return
  recording.value = true
  error.value = ''
  window.removeEventListener('keydown', onKeydown, true)
  window.addEventListener('keydown', onKeydown, true)
}

function toggle(): void {
  if (recording.value) stop()
  else start()
}

function clear(): void {
  emit('update', '')
  error.value = ''
  stop()
}

function onKeydown(event: KeyboardEvent): void {
  if (!recording.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.repeat) return

  const noModifier = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey

  if (event.key === 'Escape' && noModifier) {
    stop()
    return
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && noModifier) {
    if (props.allowClear) clear()
    else stop()
    return
  }

  if (isModifierOnly(event.key)) return

  const shortcut = shortcutFromEvent(event)
  if (!shortcut) return

  if (!isShortcutValid(shortcut)) {
    error.value = t('settings.shortcut.invalid')
    return
  }

  error.value = ''
  emit('update', serializeShortcut(shortcut))
  stop()
}

onBeforeUnmount(stop)
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="flex min-h-9 flex-1 items-center rounded-md border px-2.5 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        :class="
          recording
            ? 'border-primary-500 bg-primary-50/60 text-primary-700 dark:border-primary-400 dark:bg-primary-500/10 dark:text-primary-300'
            : 'border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-600'
        "
        :aria-pressed="recording"
        :aria-label="t('settings.shortcut.empty')"
        :disabled="disabled"
        @click="toggle"
        @blur="stop"
      >
        <span v-if="recording" class="text-primary-600 dark:text-primary-300">
          {{ t('settings.shortcut.recording') }}
        </span>
        <span v-else-if="display" class="font-mono text-[13px] tracking-tight">{{ display }}</span>
        <span v-else class="text-zinc-400">{{ t('settings.shortcut.empty') }}</span>
      </button>

      <button
        v-if="allowClear && modelValue && !disabled"
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        :aria-label="t('settings.shortcut.clear')"
        :title="t('settings.shortcut.clear')"
        @click="clear"
      >
        <CloseIcon :size="14" />
      </button>
    </div>

    <p v-if="error" class="text-xs text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    <p v-else class="text-xs text-zinc-500 dark:text-zinc-400">{{ t('settings.shortcut.hint') }}</p>
  </div>
</template>
