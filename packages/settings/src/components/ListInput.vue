<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { PlusIcon, TrashIcon } from '../icons'
import type { I18n } from '../i18n'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    i18n: I18n
    placeholder?: string
    addLabel?: string
    maxItems?: number
    validate?: (value: string) => string | null
    disabled?: boolean
  }>(),
  {
    disabled: false
  }
)

const emit = defineEmits<{
  (event: 'update', value: string[]): void
}>()

const containerRef = ref<HTMLElement | null>(null)
const t = (key: string): string => props.i18n.t(key)
const maxReached = computed(
  () => props.maxItems !== undefined && props.modelValue.length >= props.maxItems
)

function emitNext(next: string[]): void {
  emit('update', next)
}

function updateAt(index: number, value: string): void {
  const next = [...props.modelValue]
  next[index] = value
  emitNext(next)
}

function removeAt(index: number): void {
  emitNext(props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}

function add(): void {
  if (maxReached.value) return
  emitNext([...props.modelValue, ''])
  nextTick(() => {
    const inputs = containerRef.value?.querySelectorAll<HTMLInputElement>('input')
    inputs?.[inputs.length - 1]?.focus()
  })
}

function errorFor(value: string): string | null {
  if (!value) return null
  const code = props.validate?.(value)
  return code ? t(code) : null
}
</script>

<template>
  <div ref="containerRef" class="space-y-1.5">
    <p v-if="modelValue.length === 0" class="text-xs text-zinc-400 dark:text-zinc-500">
      {{ t('settings.list.empty') }}
    </p>

    <div v-for="(item, index) in modelValue" :key="index" class="space-y-1">
      <div class="flex items-center gap-1.5">
        <input
          :value="item"
          type="text"
          spellcheck="false"
          autocomplete="off"
          class="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          :placeholder="placeholder"
          :disabled="disabled"
          @input="updateAt(index, ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          :aria-label="t('settings.list.remove')"
          :title="t('settings.list.remove')"
          :disabled="disabled"
          @click="removeAt(index)"
        >
          <TrashIcon :size="14" />
        </button>
      </div>
      <p v-if="errorFor(item)" class="text-xs text-red-600 dark:text-red-400">
        {{ errorFor(item) }}
      </p>
    </div>

    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-primary-400 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-primary-500 dark:hover:text-primary-400"
      :disabled="maxReached || disabled"
      @click="add"
    >
      <PlusIcon :size="13" />
      <span>{{ addLabel ? t(addLabel) : t('settings.list.add') }}</span>
    </button>
  </div>
</template>
