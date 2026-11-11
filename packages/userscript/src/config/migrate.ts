/**
 * Carry a user's choice across the inverted pointer switch.
 *
 * The setting used to be `capture.pointerIsolation` (default on). Asking for the
 * negative behaviour instead (`capture.pointerPassthrough`, default off) keeps the
 * two switches from growing into a double negative, but the rename must not
 * silently flip what a returning user chose: a stored `false` (pointer reaches the
 * page) has to become `passthrough: true`.
 *
 * Returns the rewritten settings blob, or null when there is nothing to migrate.
 */
const LEGACY_ISOLATION_KEY = 'capture.pointerIsolation'
const POINTER_PASSTHROUGH_KEY = 'capture.pointerPassthrough'

export function migratePointerSetting(raw: string | null): string | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const record = { ...(parsed as Record<string, unknown>) }
  if (!(LEGACY_ISOLATION_KEY in record)) return null

  const isolation = record[LEGACY_ISOLATION_KEY]
  delete record[LEGACY_ISOLATION_KEY]
  // A value the new switch already holds wins; the old key is dropped either way.
  if (typeof isolation === 'boolean' && !(POINTER_PASSTHROUGH_KEY in record)) {
    record[POINTER_PASSTHROUGH_KEY] = !isolation
  }
  return JSON.stringify(record)
}
