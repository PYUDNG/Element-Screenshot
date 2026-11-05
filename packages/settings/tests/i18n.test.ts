import { describe, expect, it } from 'vitest'
import {
  createI18n,
  interpolate,
  lookupMessage,
  matchLocale,
  mergeMessages,
  resolveLocale
} from '../src/i18n'
import type { LocaleDefinition } from '../src/i18n'

const locales: LocaleDefinition[] = [
  { code: 'zh-CN', label: '简体中文', messages: { common: { hello: '你好 {name}' } } },
  { code: 'zh-TW', label: '繁體中文', messages: { common: { hello: '你好 {name}' } } },
  { code: 'en', label: 'English', messages: { common: { hello: 'Hello {name}' } } }
]

describe('i18n helpers', () => {
  it('matches exact, script and prefix tags', () => {
    expect(matchLocale('zh-CN', ['zh-CN', 'en'])).toBe('zh-CN')
    expect(matchLocale('zh-Hant-HK', ['zh-CN', 'zh-TW', 'en'])).toBe('zh-TW')
    expect(matchLocale('zh-HK', ['zh-CN', 'zh-TW', 'en'])).toBe('zh-TW')
    expect(matchLocale('en-US', ['zh-CN', 'en'])).toBe('en')
    expect(matchLocale('fr-FR', ['zh-CN', 'en'])).toBeNull()
  })

  it('resolves auto against browser languages and fallback', () => {
    const codes = ['zh-CN', 'zh-TW', 'en']
    expect(resolveLocale('auto', codes, 'en', ['de', 'zh-TW'])).toBe('zh-TW')
    expect(resolveLocale('auto', codes, 'en', ['de'])).toBe('en')
    expect(resolveLocale('zh-TW', codes, 'en', ['en'])).toBe('zh-TW')
    expect(resolveLocale('missing', codes, 'en', ['zh-CN'])).toBe('zh-CN')
  })

  it('merges nested messages and interpolates values', () => {
    const merged = mergeMessages(
      { a: { b: 'one', c: 'two' }, keep: 'yes' },
      { a: { b: 'changed' } }
    )
    expect(merged).toEqual({ a: { b: 'changed', c: 'two' }, keep: 'yes' })
    expect(lookupMessage(merged, 'a.b')).toBe('changed')
    expect(lookupMessage(merged, 'missing.key')).toBeNull()
    expect(interpolate('Hello {name}!', { name: 'Ada' })).toBe('Hello Ada!')
    expect(interpolate('Hello {name}!')).toBe('Hello {name}!')
  })

  it('switches locales, falls back and supports extension', () => {
    const i18n = createI18n({
      defaultLocale: 'zh-CN',
      fallbackLocale: 'en',
      locales,
      detectLanguages: () => ['zh-CN']
    })
    expect(i18n.t('common.hello', { name: 'Ada' })).toBe('你好 Ada')

    i18n.setLocale('en')
    expect(i18n.resolvedLocale.value).toBe('en')
    expect(i18n.t('common.hello', { name: 'Ada' })).toBe('Hello Ada')

    i18n.registerLocale({
      code: 'en',
      label: 'English',
      messages: { extra: { value: 'Extended' } }
    })
    expect(i18n.t('extra.value')).toBe('Extended')
    expect(i18n.t('common.hello', { name: 'Ada' })).toBe('Hello Ada')
    expect(i18n.availableLocales.value.map((locale) => locale.code)).toEqual([
      'zh-CN',
      'zh-TW',
      'en'
    ])
    expect(i18n.t('unknown.key')).toBe('unknown.key')
    expect(i18n.has('extra.value')).toBe(true)
    expect(i18n.getLocale()).toBe('en')
  })

  it('follows browser languages in auto mode', () => {
    const i18n = createI18n({
      defaultLocale: 'en',
      fallbackLocale: 'en',
      locales,
      detectLanguages: () => ['zh-Hant-TW']
    })
    expect(i18n.resolvedLocale.value).toBe('zh-TW')
    expect(i18n.locale.value).toBe('auto')
  })

  it('ignores unknown locales', () => {
    const i18n = createI18n({ locales })
    i18n.setLocale('nope')
    expect(i18n.getLocale()).toBe('auto')
  })
})
