import type { DomainStep } from '@element-screenshot/versioned-storage'

/** Storage key of the settings blob, without the `element-screenshot:` prefix. */
export const SETTINGS_DOMAIN_KEY = 'settings'

/**
 * Retired setting keys. They must never be reused: generation-0 blobs are
 * rewritten by the steps below, so a new setting that happens to take an old
 * name would silently inherit the old meaning.
 *
 * The domain envelope is what makes the reuse risk small in the first place —
 * steps only ever see a blob that the domain already classified as generation 0 —
 * but the names still stay reserved.
 */
const LEGACY_ISOLATION_KEY = 'capture.pointerIsolation'
const POINTER_PASSTHROUGH_KEY = 'capture.pointerPassthrough'

function parseRecord(value: string): Record<string, unknown> | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return { ...(parsed as Record<string, unknown>) }
}

/**
 * Generation 1: the pointer switch was inverted.
 *
 * `capture.pointerIsolation` (default on, "keep the page from seeing the pointer")
 * became `capture.pointerPassthrough` (default off, "let the pointer reach the
 * page"), so a stored `false` has to turn into passthrough `true` — otherwise the
 * rename would quietly flip what a returning user chose.
 *
 * A value the new switch already holds wins and the old key is dropped either
 * way. A legacy value that is not a boolean is dropped without guessing, which
 * falls back to the default. Anything unreadable is returned unchanged so the
 * domain keeps the user's storage intact.
 */
const invertPointerSwitch: DomainStep = {
  id: 1,
  run(value) {
    const record = parseRecord(value)
    if (!record || !(LEGACY_ISOLATION_KEY in record)) return value

    const isolation = record[LEGACY_ISOLATION_KEY]
    delete record[LEGACY_ISOLATION_KEY]
    if (typeof isolation === 'boolean' && !(POINTER_PASSTHROUGH_KEY in record)) {
      record[POINTER_PASSTHROUGH_KEY] = !isolation
    }
    return JSON.stringify(record)
  }
}

export const SETTINGS_STEPS = [invertPointerSwitch] as const
