import { describe, expect, it } from 'vitest'
import {
  gmFetchPlugin,
  patchFontEmbedding,
  rewriteFetchReferences
} from '../src/plugin/gm-fetch-plugin'

describe('gm-fetch Vite plugin', () => {
  it('rewrites global fetch and XMLHttpRequest references', () => {
    const source = `
      export async function load(url) {
        const res = await fetch(url, { cache: 'force-cache' })
        const xhr = new XMLHttpRequest()
        obj.fetch(url)
        window.XMLHttpRequest
        return res
      }
    `
    const result = rewriteFetchReferences(source, { sourceFile: 'dataurl.js' })
    expect(result.changed).toBe(true)
    expect(result.code).toContain('__gmFetch(url, { cache:')
    expect(result.code).toContain('new __gmXMLHttpRequest()')
    expect(result.code).toContain('obj.fetch(url)')
    expect(result.code).toContain('window.XMLHttpRequest')
    expect(result.code).toContain("from 'virtual:gm-fetch'")
    expect(result.map).toBeDefined()
  })

  it('leaves shadowed bindings alone', () => {
    const source = `const fetch = () => 1; export const value = fetch()`
    const result = rewriteFetchReferences(source)
    expect(result.changed).toBe(false)
    expect(result.code).toBe(source)
  })

  it('handles destructured names and properties', () => {
    const source = `
      const { fetch: localFetch } = window
      const value = { fetch }
      const result = fetch('/x')
    `
    const result = rewriteFetchReferences(source)
    expect(result.code).toContain('localFetch')
    expect(result.code).toContain('{ fetch }')
    expect(result.code).toContain("__gmFetch('/x')")
  })

  it('exposes the virtual adapter module', () => {
    const plugin = gmFetchPlugin()
    const resolveId = plugin.resolveId as unknown as (id: string) => string | null
    const load = plugin.load as unknown as (id: string) => string | null

    expect(resolveId('virtual:gm-fetch')).toBe('\0virtual:gm-fetch')
    expect(load('\0virtual:gm-fetch')).toContain('GMXMLHttpRequest')
    expect(resolveId('other')).toBeNull()
  })

  it('replaces html-to-image stylesheet inlining with a read-only walk', () => {
    const source = `
async function getCSSRules(styleSheets, options) {
  const ret = [];
  styleSheets.forEach((sheet) => {
    try { sheet.cssRules.forEach((rule) => ret.push(rule)); }
    catch (e) { console.error('Error inlining remote css file', e); }
  });
  return ret;
}
function getWebFontRules(cssRules) {
  return cssRules;
}
`
    const result = patchFontEmbedding(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('Cross-origin stylesheets cannot be inspected')
    expect(result.code).toContain('visited.has(sheet)')
    expect(result.code).not.toContain('console.error')
    expect(result.code).not.toContain('insertRule')
    expect(result.code).toContain('function getWebFontRules')
  })

  it('transforms html-to-image modules only', () => {
    const plugin = gmFetchPlugin()
    const transform = plugin.transform as unknown as (
      code: string,
      id: string
    ) => { code: string } | null

    const source = `export const load = (url) => fetch(url)`
    const transformed = transform(source, '/repo/node_modules/html-to-image/es/dataurl.js')
    expect(transformed?.code).toContain('__gmFetch(url)')
    expect(transform(source, '/repo/src/app.ts')).toBeNull()
  })
})
