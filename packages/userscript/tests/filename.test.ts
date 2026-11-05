import { describe, expect, it } from 'vitest'
import { buildScreenshotName } from '../src/core/filename'

describe('screenshot file names', () => {
  it('builds a deterministic PNG name', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5)
    expect(buildScreenshotName('https://www.example.com/path?x=1', date)).toBe(
      'element-shot-www.example.com-20260102-030405.png'
    )
  })

  it('sanitizes unusual hosts and falls back for invalid URLs', () => {
    const date = new Date(2026, 10, 5, 16, 7, 8)
    expect(buildScreenshotName('https://例子.test/a', date)).toMatch(
      /^element-shot-.*-20261105-160708\.png$/
    )
    expect(buildScreenshotName('not a url', date)).toBe('element-shot-page-20261105-160708.png')
  })
})
