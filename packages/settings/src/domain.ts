import type { SettingsStorage } from './storage'

/**
 * A versioned storage domain: one userscript-manager value that carries both the
 * schema generation and the payload, so the two can never drift apart.
 *
 * The envelope is `{ version, value }`: `version` is a non-negative integer and
 * `value` is an opaque string. Restricting the envelope to a number and a string
 * is what makes it portable — every manager round-trips those two types the same
 * way — while the payload's own format stays the domain's business. It does not
 * even have to be JSON, as long as the reader and the steps agree on it.
 *
 * A bare string is the only other accepted shape and means "written before the
 * envelope existed", i.e. generation 0. Everything else (an object without a
 * usable `version`, an array, a number, `null` payload) is not guessed at: it is
 * reported through `onWarn` and left exactly as it is, so a broken or foreign
 * value is never overwritten by a migration.
 *
 * Generation only moves forward. A value stored by a newer script than this one
 * runs (a downgrade) is left untouched and keeps its version, so upgrading again
 * does not re-run steps against data that already went through them.
 */

export interface DomainValueStorage {
  getValue(key: string): unknown
  setValue(key: string, value: unknown): void
  deleteValue?(key: string): void
}

export interface DomainStep {
  /** Generation this step produces. Must be a positive integer; steps run in
   * ascending order. */
  id: number
  /** Receives the payload of the previous generation and returns the next one. */
  run(value: string): string
}

export interface DomainOptions {
  /** Storage key, without any manager prefix. */
  key: string
  /** Generations to apply on top of whatever is stored. Empty when the payload
   * has no history yet. */
  steps?: readonly DomainStep[]
  storage: DomainValueStorage
  onWarn?: (message: string, error?: unknown) => void
}

export interface Domain {
  readonly key: string
  /** Generation that is stored now (or the newest one this script knows). */
  readonly version: number
  /** Payload after migration; `null` when the domain holds nothing. */
  readonly value: string | null
  /** View over the payload for consumers that speak `SettingsStorage`. */
  readonly storage: SettingsStorage
}

type Stored =
  | { status: 'empty' }
  | { status: 'legacy'; value: string }
  | { status: 'envelope'; version: number; value: string }
  | { status: 'corrupt' }

function isEnvelope(value: unknown): value is { version: number; value: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const generation = record.version
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0) {
    return false
  }
  return typeof record.value === 'string'
}

function readStored(stored: unknown): Stored {
  if (stored === null || stored === undefined) return { status: 'empty' }
  if (typeof stored === 'string') return { status: 'legacy', value: stored }
  if (isEnvelope(stored)) {
    return { status: 'envelope', version: stored.version, value: stored.value }
  }
  return { status: 'corrupt' }
}

export function createDomain(options: DomainOptions): Domain {
  const { key } = options
  const raw = options.storage
  const warn =
    options.onWarn ?? ((message: string, error?: unknown) => console.warn(message, error))
  const steps = [...(options.steps ?? [])].sort((a, b) => a.id - b.id)
  const newest = steps.reduce((max, step) => Math.max(max, step.id), 0)

  let version = newest
  let payload: string | null = null

  const write = (): void => {
    if (payload === null) return
    try {
      raw.setValue(key, { version, value: payload })
    } catch (error) {
      warn(`[domain:${key}] storage write failed`, error)
    }
  }

  const view: SettingsStorage = {
    // The view is bound to this domain's key; the parameter only exists because
    // `SettingsStorage` is shared with the plain adapters.
    getItem: () => payload,
    setItem: (_key, value) => {
      payload = value
      write()
    },
    removeItem: () => {
      payload = null
      try {
        if (raw.deleteValue) raw.deleteValue(key)
        else raw.setValue(key, null)
      } catch (error) {
        warn(`[domain:${key}] storage delete failed`, error)
      }
    }
  }

  const result = (): Domain => ({ key, version, value: payload, storage: view })

  let stored: Stored
  try {
    stored = readStored(raw.getValue(key))
  } catch (error) {
    warn(`[domain:${key}] storage read failed; using defaults`, error)
    return result()
  }

  if (stored.status === 'empty') return result()

  if (stored.status === 'corrupt') {
    warn(`[domain:${key}] unrecognised stored value; left untouched`)
    return result()
  }

  const from = stored.status === 'envelope' ? stored.version : 0
  if (from > newest) {
    warn(`[domain:${key}] stored generation ${from} is newer than ${newest}; left untouched`)
    version = from
    payload = stored.value
    return result()
  }

  payload = stored.value
  try {
    for (const step of steps) {
      if (from >= step.id) continue
      payload = step.run(payload)
      version = step.id
    }
  } catch (error) {
    // A step that throws leaves the stored blob alone: a half-rewritten payload
    // is worse than a stale generation, and the next startup retries.
    warn(`[domain:${key}] migration failed; storage left untouched`, error)
    version = from
    payload = stored.value
    return result()
  }

  if (from < version) write()
  return result()
}
