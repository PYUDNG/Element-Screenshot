import { computed, reactive, ref } from 'vue'
import type { ComputedRef } from 'vue'

export type MessageValue = string | MessageTree
export interface MessageTree {
  [key: string]: MessageValue
}

export interface LocaleDefinition {
  code: string
  label: string
  messages: MessageTree
}

export interface LocaleInfo {
  code: string
  label: string
}

export interface I18nOptions {
  defaultLocale?: string
  fallbackLocale?: string
  locales?: LocaleDefinition[]
  /** Injectable for tests / non-browser environments. */
  detectLanguages?: () => readonly string[]
}

export interface I18n {
  readonly locale: ComputedRef<string>
  readonly resolvedLocale: ComputedRef<string>
  readonly availableLocales: ComputedRef<LocaleInfo[]>
  readonly defaultLocale: string
  readonly fallbackLocale: string
  t(key: string, params?: Record<string, string | number>): string
  has(key: string): boolean
  registerLocale(locale: LocaleDefinition): void
  setLocale(code: string): void
  getLocale(): string
}

const AUTO_LOCALE = 'auto'

function isMessageTree(value: unknown): value is MessageTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeMessages(base: MessageTree, patch: MessageTree): MessageTree {
  const result: MessageTree = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key]
    if (isMessageTree(current) && isMessageTree(value)) {
      result[key] = mergeMessages(current, value)
    } else {
      result[key] = value
    }
  }
  return result
}

export function lookupMessage(messages: MessageTree, key: string): string | null {
  const segments = key.split('.')
  let current: MessageValue | undefined = messages
  for (const segment of segments) {
    if (!isMessageTree(current)) return null
    current = current[segment]
    if (current === undefined) return null
  }
  return typeof current === 'string' ? current : null
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** Matches a BCP-47 tag against registered locale codes. */
export function matchLocale(tag: string, codes: readonly string[]): string | null {
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-')
  if (!normalized) return null

  const exact = codes.find((code) => code.toLowerCase() === normalized)
  if (exact) return exact

  const language = normalized.split('-')[0] ?? ''
  if (language === 'zh') {
    if (/hant|tw|hk|mo/.test(normalized)) {
      return codes.find((code) => code.toLowerCase() === 'zh-tw') ?? null
    }
    if (/hans|cn|sg|my/.test(normalized)) {
      return codes.find((code) => code.toLowerCase() === 'zh-cn') ?? null
    }
  }

  const prefix = codes.find((code) => code.toLowerCase().startsWith(`${language}-`))
  if (prefix) return prefix

  return codes.find((code) => code.toLowerCase() === language) ?? null
}

export function resolveLocale(
  requested: string,
  codes: readonly string[],
  fallback: string,
  languages: readonly string[]
): string {
  if (requested !== AUTO_LOCALE) {
    const direct = codes.find((code) => code === requested)
    if (direct) return direct
  }

  for (const language of languages) {
    const matched = matchLocale(language, codes)
    if (matched) return matched
  }

  if (codes.includes(fallback)) return fallback
  return codes[0] ?? fallback
}

function defaultDetectLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return languages.filter((language): language is string => Boolean(language))
}

export function createI18n(options: I18nOptions = {}): I18n {
  const defaultLocale = options.defaultLocale ?? 'zh-CN'
  const fallbackLocale = options.fallbackLocale ?? 'en'
  const detectLanguages = options.detectLanguages ?? defaultDetectLanguages

  const registry = reactive(new Map<string, LocaleDefinition>())
  const requested = ref<string>(AUTO_LOCALE)

  const locale = computed(() => requested.value)
  const codes = computed(() => [...registry.keys()])
  const resolvedLocale = computed(() =>
    resolveLocale(requested.value, codes.value, fallbackLocale, detectLanguages())
  )
  const availableLocales = computed<LocaleInfo[]>(() =>
    [...registry.values()].map(({ code, label }) => ({ code, label }))
  )

  function registerLocale(definition: LocaleDefinition): void {
    if (!definition.code) return
    const current = registry.get(definition.code)
    registry.set(definition.code, {
      ...definition,
      messages: current ? mergeMessages(current.messages, definition.messages) : definition.messages
    })
  }

  function setLocale(code: string): void {
    if (code === AUTO_LOCALE) {
      requested.value = AUTO_LOCALE
      return
    }
    if (registry.has(code)) requested.value = code
  }

  function t(key: string, params?: Record<string, string | number>): string {
    const chain = [resolvedLocale.value, defaultLocale, fallbackLocale]
    for (const code of chain) {
      const definition = registry.get(code)
      if (!definition) continue
      const template = lookupMessage(definition.messages, key)
      if (template !== null) return interpolate(template, params)
    }
    return key
  }

  function has(key: string): boolean {
    for (const code of [resolvedLocale.value, defaultLocale, fallbackLocale]) {
      const definition = registry.get(code)
      if (definition && lookupMessage(definition.messages, key) !== null) return true
    }
    return false
  }

  for (const localeDefinition of options.locales ?? []) {
    registerLocale(localeDefinition)
  }

  return {
    locale,
    resolvedLocale,
    availableLocales,
    defaultLocale,
    fallbackLocale,
    t,
    has,
    registerLocale,
    setLocale,
    getLocale: () => requested.value
  }
}
