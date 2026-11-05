export interface SitePolicy {
  include: string[]
  exclude: string[]
}

function globToRegExp(pattern: string, flags = ''): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, flags)
}

function parseRegexRule(rule: string): RegExp | null {
  if (!rule.startsWith('/')) return null
  const lastSlash = rule.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const flags = rule.slice(lastSlash + 1)
  if (!/^[dgimsuvy]*$/.test(flags)) return null
  try {
    return new RegExp(rule.slice(1, lastSlash), flags)
  } catch {
    return null
  }
}

function looksLikeRegexRule(rule: string): boolean {
  if (!rule.startsWith('/')) return false
  const lastSlash = rule.lastIndexOf('/')
  if (lastSlash <= 0) return false
  return /^[dgimsuvy]*$/.test(rule.slice(lastSlash + 1))
}

function normalizeHostRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

/**
 * Rules:
 * - `example.com` / `*.example.com` — hostname (subdomains included)
 * - `https://*.example.com/docs/*` — URL glob
 * - `/^https:\/\/docs\./` — regex over the full URL
 * - `/docs/*` — path glob
 */
export function matchesRule(url: string, rule: string): boolean {
  const trimmed = rule.trim()
  if (!trimmed || trimmed.startsWith('#')) return false

  const regex = parseRegexRule(trimmed)
  if (regex) {
    regex.lastIndex = 0
    return regex.test(url)
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (trimmed.startsWith('/')) {
    try {
      return globToRegExp(trimmed).test(parsed.pathname + parsed.search)
    } catch {
      return false
    }
  }

  if (trimmed.includes('://') || trimmed.startsWith('*://')) {
    try {
      return globToRegExp(trimmed, 'i').test(url)
    } catch {
      return false
    }
  }

  const hostRule = normalizeHostRule(trimmed)
  if (!hostRule) return false

  const hostname = parsed.hostname.toLowerCase()
  const hostWithPort = parsed.host.toLowerCase()
  const candidate = hostRule.includes(':') ? hostWithPort : hostname
  const normalizedRule = hostRule

  if (normalizedRule.includes('*') || normalizedRule.includes('?')) {
    try {
      return globToRegExp(normalizedRule).test(candidate)
    } catch {
      return false
    }
  }

  return candidate === normalizedRule || candidate.endsWith(`.${normalizedRule}`)
}

export function isValidSiteRule(rule: string): boolean {
  const trimmed = rule.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('#')) return true

  if (trimmed.startsWith('/') && looksLikeRegexRule(trimmed)) {
    return parseRegexRule(trimmed) !== null
  }
  if (trimmed.startsWith('/')) {
    try {
      globToRegExp(trimmed)
      return true
    } catch {
      return false
    }
  }
  if (trimmed.includes('://') || trimmed.startsWith('*://')) {
    try {
      globToRegExp(trimmed, 'i')
      return true
    } catch {
      return false
    }
  }
  return normalizeHostRule(trimmed).length > 0
}

function cleanRules(rules: readonly string[]): string[] {
  return rules.map((rule) => rule.trim()).filter((rule) => rule && !rule.startsWith('#'))
}

export function isSiteEnabled(
  url: string,
  include: readonly string[],
  exclude: readonly string[]
): boolean {
  const excludes = cleanRules(exclude)
  if (excludes.some((rule) => matchesRule(url, rule))) return false

  const includes = cleanRules(include)
  if (includes.length === 0) return true
  return includes.some((rule) => matchesRule(url, rule))
}

/** Remove every exclusion matching the current page and add its hostname. */
export function enableSiteForUrl(
  url: string,
  include: readonly string[],
  exclude: readonly string[]
): SitePolicy {
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    hostname = ''
  }

  const nextInclude = [...include]
  if (hostname && !nextInclude.some((rule) => rule.trim() === hostname)) {
    nextInclude.push(hostname)
  }
  const nextExclude = exclude.filter((rule) => {
    const trimmed = rule.trim()
    return !trimmed || !matchesRule(url, trimmed)
  })

  return { include: nextInclude, exclude: nextExclude }
}
