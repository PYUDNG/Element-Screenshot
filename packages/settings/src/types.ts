import type { VNodeChild } from 'vue'
import type { IconName } from './icons'

export type ThemeSetting = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
/** `auto` or a registered locale code. */
export type LocaleSetting = string

export type SettingValue = string | number | boolean | string[]
export type SettingsValues = Record<string, SettingValue>

export interface SelectOption {
  value: string | number
  label: string
}

export interface BaseField {
  /** Unique value key. Also used by `controller.get()` / `controller.set()`. */
  key: string
  /** i18n key, or literal text when no translation exists. */
  label: string
  description?: string
  visible?: (values: SettingsValues) => boolean
  disabled?: boolean | ((values: SettingsValues) => boolean)
  fullWidth?: boolean
}

export interface SwitchField extends BaseField {
  type: 'switch'
  default: boolean
}

export interface SelectField extends BaseField {
  type: 'select'
  default: string | number
  options: SelectOption[] | (() => SelectOption[])
}

export interface TextField extends BaseField {
  type: 'text'
  default: string
  placeholder?: string
  maxLength?: number
}

export interface TextareaField extends BaseField {
  type: 'textarea'
  default: string
  placeholder?: string
  rows?: number
}

export interface NumberField extends BaseField {
  type: 'number'
  default: number
  min?: number
  max?: number
  step?: number
  unit?: string
}

export interface RangeField extends BaseField {
  type: 'range'
  default: number
  min: number
  max: number
  step?: number
  unit?: string
}

export interface ColorField extends BaseField {
  type: 'color'
  default: string
  swatches?: string[]
}

export interface ShortcutField extends BaseField {
  type: 'shortcut'
  default: string
  allowClear?: boolean
}

export interface ListField extends BaseField {
  type: 'list'
  default: string[]
  placeholder?: string
  addLabel?: string
  maxItems?: number
  /** Returns a translated-later message key, or `null` when valid. */
  validate?: (value: string) => string | null
}

export interface ActionField extends BaseField {
  type: 'action'
  action: () => void | Promise<void>
  icon?: IconName
  variant?: 'default' | 'danger'
  confirm?: boolean
  confirmLabel?: string
}

export interface CustomFieldContext {
  field: CustomField
  value: SettingValue | undefined
  values: SettingsValues
  setValue: (value: SettingValue) => void
}

export interface CustomField extends BaseField {
  type: 'custom'
  default?: SettingValue
  render: (context: CustomFieldContext) => VNodeChild
}

export type SettingsField =
  | SwitchField
  | SelectField
  | TextField
  | TextareaField
  | NumberField
  | RangeField
  | ColorField
  | ShortcutField
  | ListField
  | ActionField
  | CustomField

export type ValueField = Exclude<SettingsField, ActionField>

export interface SettingsGroup {
  id: string
  title: string
  description?: string
  fields: SettingsField[]
  /** Expanded by default (accordion). */
  defaultOpen?: boolean
}

export interface SettingsTab {
  id: string
  title: string
  description?: string
  icon?: IconName
  groups: SettingsGroup[]
}

export interface SettingsFieldPatch {
  label?: string
  description?: string
  visible?: (values: SettingsValues) => boolean
  disabled?: boolean | ((values: SettingsValues) => boolean)
  options?: SelectOption[] | (() => SelectOption[])
  default?: SettingValue
  [key: string]: unknown
}
