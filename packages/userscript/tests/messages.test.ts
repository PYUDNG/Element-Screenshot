import { describe, expect, it } from 'vitest'
import { appMessages } from '../src/messages'

/** 把嵌套的 locale 消息拍平成 `app.hint.inFrame` → 文案，方便逐条检查。 */
function flatten(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key)
  )
}

const locales = new Map(appMessages.map((locale) => [locale.code, flatten(locale.messages)]))

/** 英文里有几处 “frame” 指的是选择框，不是 iframe，可以保留。 */
const SELECTION_BOX_KEYS = new Set([
  'app.group.frame',
  'app.field.borderColorDesc',
  'app.field.borderWidthDesc'
])

describe('user-facing wording', () => {
  it('badges elements picked inside an iframe as 框架 / iframe', () => {
    const badge = (code: string): string | undefined =>
      locales.get(code)?.find(([key]) => key === 'app.hint.inFrame')?.[1]
    expect(badge('zh-CN')).toBe('框架')
    expect(badge('zh-TW')).toBe('框架')
    expect(badge('en')).toBe('iframe')
  })

  it('calls an iframe 框架, never 帧, in Chinese copy', () => {
    for (const code of ['zh-CN', 'zh-TW']) {
      const offending = (locales.get(code) ?? []).filter(([, text]) => /[帧幀]/.test(text))
      expect(offending, `${code} still says 帧: ${JSON.stringify(offending)}`).toEqual([])
    }
  })

  it('calls an iframe an iframe, not a frame, in English copy', () => {
    const offending = (locales.get('en') ?? []).filter(
      ([key, text]) => /\bframes?\b/i.test(text) && !SELECTION_BOX_KEYS.has(key)
    )
    expect(offending, `en still says frame: ${JSON.stringify(offending)}`).toEqual([])
  })
})
