<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDownIcon, getIcon } from '../icons'
import type { I18n } from '../i18n'
import type { SelectOption, SettingValue, SettingsField, SettingsValues } from '../types'
import ListInput from './ListInput.vue'
import ShortcutInput from './ShortcutInput.vue'

const props = defineProps<{
  field: SettingsField
  value: SettingValue | undefined
  values: SettingsValues
  i18n: I18n
}>()

const emit = defineEmits<{
  (event: 'update', value: SettingValue): void
}>()

const t = (key: string): string => props.i18n.t(key)
const inputId = computed(() => `es-field-${props.field.key}`)
const disabled = computed(() => {
  const field = props.field
  return typeof field.disabled === 'function'
    ? field.disabled(props.values)
    : field.disabled === true
})
const fullWidth = computed(
  () =>
    props.field.fullWidth === true ||
    props.field.type === 'textarea' ||
    props.field.type === 'list' ||
    props.field.type === 'custom'
)

function fallbackValue(): SettingValue {
  const field = props.field
  return field.type === 'action' ? '' : (field.default ?? '')
}

const currentValue = computed<SettingValue>(() => props.value ?? fallbackValue())
const switchOn = computed(() => currentValue.value === true)

const selectOptions = computed<SelectOption[]>(() => {
  const field = props.field
  if (field.type !== 'select') return []
  return typeof field.options === 'function' ? field.options() : field.options
})

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100'

const colorText = ref('')
const actionBusy = ref(false)
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | null = null

watch(
  currentValue,
  (value) => {
    colorText.value = typeof value === 'string' ? value : ''
  },
  { immediate: true }
)

function update(value: SettingValue): void {
  emit('update', value)
}

function onTextInput(event: Event): void {
  update((event.target as HTMLInputElement).value)
}

function onNumberInput(event: Event): void {
  const field = props.field
  if (field.type !== 'number') return
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') return
  const parsed = Number(raw)
  if (Number.isFinite(parsed)) update(parsed)
}

function onNumberCommit(event: Event): void {
  const field = props.field
  if (field.type !== 'number') return
  const input = event.target as HTMLInputElement
  const parsed = Number(input.value)
  if (!Number.isFinite(parsed)) {
    input.value = String(currentValue.value)
    return
  }
  const min = field.min ?? Number.NEGATIVE_INFINITY
  const max = field.max ?? Number.POSITIVE_INFINITY
  const clamped = Math.min(Math.max(parsed, min), max)
  input.value = String(clamped)
  update(clamped)
}

function onRangeInput(event: Event): void {
  update(Number((event.target as HTMLInputElement).value))
}

function onSelect(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  const match = selectOptions.value.find((option) => String(option.value) === raw)
  update(match ? match.value : raw)
}

function onSwitch(): void {
  update(currentValue.value !== true)
}

function onColorInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  colorText.value = value
  update(value)
}

function onColorText(event: Event): void {
  colorText.value = (event.target as HTMLInputElement).value
}

function toHex6(value: string): string {
  const trimmed = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    const expanded = trimmed
      .split('')
      .map((char) => char + char)
      .join('')
    return `#${expanded}`
  }
  return '#000000'
}

function commitColor(): void {
  const value = colorText.value.trim()
  if (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(value)) {
    const normalized = toHex6(value)
    colorText.value = normalized
    update(normalized)
  } else {
    colorText.value = String(currentValue.value)
  }
}

const colorInputValue = computed(() => toHex6(String(currentValue.value)))

function runAction(): void {
  const field = props.field
  if (field.type !== 'action') return

  if (field.confirm && !armed.value) {
    armed.value = true
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => {
      armed.value = false
    }, 3000)
    return
  }

  armed.value = false
  if (armTimer) {
    clearTimeout(armTimer)
    armTimer = null
  }

  try {
    const result = field.action()
    if (result instanceof Promise) {
      actionBusy.value = true
      result
        .catch((error: unknown) => {
          console.error('[element-screenshot/settings] action failed', error)
        })
        .finally(() => {
          actionBusy.value = false
        })
    }
  } catch (error) {
    console.error('[element-screenshot/settings] action failed', error)
  }
}

const customRenderer = computed(() => {
  const field = props.field
  if (field.type !== 'custom') return null
  return () =>
    field.render({
      field,
      value: props.value,
      values: props.values,
      setValue: (value: SettingValue) => update(value)
    })
})

const actionButtonClass = computed(() => {
  const field = props.field
  const danger = field.type === 'action' && field.variant === 'danger'
  return danger
    ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10'
    : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
})

onBeforeUnmount(() => {
  if (armTimer) clearTimeout(armTimer)
})
</script>

<template>
  <div
    v-if="field.type === 'action'"
    class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="min-w-0">
      <p class="text-sm font-medium text-zinc-800 dark:text-zinc-100">{{ t(field.label) }}</p>
      <p v-if="field.description" class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        {{ t(field.description) }}
      </p>
    </div>
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      :class="actionButtonClass"
      :disabled="disabled || actionBusy"
      @click="runAction"
    >
      <component :is="getIcon(field.icon)" v-if="field.icon" :size="15" />
      <span>
        {{ armed && field.confirm ? t(field.confirmLabel ?? 'settings.confirm') : t(field.label) }}
      </span>
    </button>
  </div>

  <div
    v-else
    class="py-3"
    :class="
      fullWidth
        ? 'space-y-2'
        : 'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6'
    "
  >
    <div :class="fullWidth ? '' : 'min-w-0 sm:max-w-[55%]'">
      <label :for="inputId" class="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {{ t(field.label) }}
      </label>
      <p
        v-if="field.description"
        class="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400"
      >
        {{ t(field.description) }}
      </p>
    </div>

    <div :class="fullWidth ? 'w-full' : 'w-full sm:w-auto sm:min-w-[220px] sm:max-w-[320px]'">
      <template v-if="field.type === 'switch'">
        <button
          :id="inputId"
          type="button"
          role="switch"
          :aria-checked="switchOn"
          :disabled="disabled"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            switchOn
              ? 'border-blue-600 bg-blue-600'
              : 'border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-700'
          "
          @click="onSwitch"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform"
            :class="switchOn ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </template>

      <template v-else-if="field.type === 'select'">
        <div class="relative">
          <select
            :id="inputId"
            :value="String(currentValue)"
            :disabled="disabled"
            class="w-full appearance-none rounded-md border border-zinc-300 bg-white py-1.5 pl-3 pr-8 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            @change="onSelect"
          >
            <option
              v-for="option in selectOptions"
              :key="String(option.value)"
              :value="String(option.value)"
            >
              {{ t(option.label) }}
            </option>
          </select>
          <ChevronDownIcon
            :size="15"
            class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
        </div>
      </template>

      <template v-else-if="field.type === 'text'">
        <input
          :id="inputId"
          :value="String(currentValue)"
          type="text"
          :placeholder="field.placeholder"
          :maxlength="field.maxLength"
          :disabled="disabled"
          :class="inputClass"
          @input="onTextInput"
        />
      </template>

      <template v-else-if="field.type === 'number'">
        <div class="relative">
          <input
            :id="inputId"
            :value="Number(currentValue)"
            type="number"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :disabled="disabled"
            :class="[inputClass, field.unit ? 'pr-10' : '']"
            @input="onNumberInput"
            @change="onNumberCommit"
          />
          <span
            v-if="field.unit"
            class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400"
          >
            {{ field.unit }}
          </span>
        </div>
      </template>

      <template v-else-if="field.type === 'range'">
        <div class="flex items-center gap-3">
          <input
            :id="inputId"
            :value="Number(currentValue)"
            type="range"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :disabled="disabled"
            class="h-1.5 flex-1 cursor-pointer accent-blue-600 disabled:opacity-50"
            @input="onRangeInput"
          />
          <output
            class="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
          >
            {{ currentValue }}{{ field.unit ?? '' }}
          </output>
        </div>
      </template>

      <template v-else-if="field.type === 'color'">
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <input
              :id="inputId"
              :value="colorInputValue"
              type="color"
              :disabled="disabled"
              class="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent p-0.5 disabled:opacity-50 dark:border-zinc-700"
              @input="onColorInput"
            />
            <input
              :value="colorText"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :disabled="disabled"
              class="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              @input="onColorText"
              @blur="commitColor"
              @keydown.enter.prevent="commitColor"
            />
          </div>
          <div v-if="field.swatches?.length" class="flex flex-wrap gap-1.5">
            <button
              v-for="swatch in field.swatches"
              :key="swatch"
              type="button"
              class="h-5 w-5 rounded border border-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-zinc-600"
              :style="{ backgroundColor: swatch }"
              :aria-label="swatch"
              :title="swatch"
              @click="update(swatch)"
            />
          </div>
        </div>
      </template>

      <template v-else-if="field.type === 'shortcut'">
        <ShortcutInput
          :model-value="String(currentValue)"
          :i18n="i18n"
          :allow-clear="field.allowClear !== false"
          :disabled="disabled"
          @update="update"
        />
      </template>

      <template v-else-if="field.type === 'textarea'">
        <textarea
          :id="inputId"
          :value="String(currentValue)"
          :rows="field.rows ?? 4"
          :placeholder="field.placeholder"
          :disabled="disabled"
          :class="[inputClass, 'resize-y']"
          @input="onTextInput"
        />
      </template>

      <template v-else-if="field.type === 'list'">
        <ListInput
          :model-value="Array.isArray(currentValue) ? currentValue : []"
          :i18n="i18n"
          :placeholder="field.placeholder"
          :add-label="field.addLabel"
          :max-items="field.maxItems"
          :validate="field.validate"
          :disabled="disabled"
          @update="update"
        />
      </template>

      <template v-else-if="field.type === 'custom'">
        <component :is="customRenderer" v-if="customRenderer" />
      </template>
    </div>
  </div>
</template>
