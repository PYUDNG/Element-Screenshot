import { describe, expect, it } from 'vitest'
import {
  enableSiteForUrl,
  isSiteEnabled,
  isValidSiteRule,
  matchesRule
} from '../src/core/site-policy'

describe('site policy matching', () => {
  it('matches hosts and subdomains', () => {
    expect(matchesRule('https://example.com/a', 'example.com')).toBe(true)
    expect(matchesRule('https://www.example.com/a', 'example.com')).toBe(true)
    expect(matchesRule('https://notexample.com/a', 'example.com')).toBe(false)
    expect(matchesRule('http://localhost:3000/x', 'localhost:3000')).toBe(true)
    expect(matchesRule('https://example.com/a', '*.example.com')).toBe(false)
    expect(matchesRule('https://www.example.com/a', '*.example.com')).toBe(true)
  })

  it('matches URL globs, path globs and regular expressions', () => {
    expect(matchesRule('https://docs.example.com/guide/a', 'https://*.example.com/*')).toBe(true)
    expect(matchesRule('https://example.com/docs/a', '/docs/*')).toBe(true)
    expect(matchesRule('https://example.com/blog/a', '/docs/*')).toBe(false)
    expect(matchesRule('https://docs.example.com/a', '/^https:\\/\\/docs\\./')).toBe(true)
    expect(matchesRule('https://example.com/a', '/^https:\\/\\/docs\\./')).toBe(false)
    expect(matchesRule('https://example.com/a', '/[/')).toBe(false)
  })

  it('ignores comments and blank rules', () => {
    expect(matchesRule('https://example.com', '   ')).toBe(false)
    expect(matchesRule('https://example.com', '# comment')).toBe(false)
  })

  it('combines include and exclude lists', () => {
    expect(isSiteEnabled('https://example.com', [], [])).toBe(true)
    expect(isSiteEnabled('https://example.com', ['example.com'], [])).toBe(true)
    expect(isSiteEnabled('https://other.com', ['example.com'], [])).toBe(false)
    expect(isSiteEnabled('https://example.com', [], ['example.com'])).toBe(false)
    expect(isSiteEnabled('https://example.com', ['example.com'], ['example.com'])).toBe(false)
    expect(isSiteEnabled('https://example.com', ['example.com', 'other.com'], [])).toBe(true)
  })

  it('validates rules', () => {
    expect(isValidSiteRule('example.com')).toBe(true)
    expect(isValidSiteRule('https://*.example.com/*')).toBe(true)
    expect(isValidSiteRule('/docs/*')).toBe(true)
    expect(isValidSiteRule('/^docs/')).toBe(true)
    expect(isValidSiteRule('/[/')).toBe(false)
    expect(isValidSiteRule('   ')).toBe(false)
    expect(isValidSiteRule('# note')).toBe(true)
  })

  it('enables the current site by adding its host and removing matching exclusions', () => {
    const policy = enableSiteForUrl(
      'https://www.example.com/page',
      ['other.com'],
      ['example.com', 'keep.com']
    )
    expect(policy.include).toEqual(['other.com', 'www.example.com'])
    expect(policy.exclude).toEqual(['keep.com'])
  })

  it('does not duplicate the hostname', () => {
    const policy = enableSiteForUrl('https://example.com/', ['example.com'], [])
    expect(policy.include).toEqual(['example.com'])
  })
})
