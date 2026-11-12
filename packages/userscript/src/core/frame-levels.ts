/**
 * How deep the script follows iframes, for picking and for painting.
 *
 * One cap for both ends: a layer the picker can reach must also be renderable,
 * and a message from another realm must not be able to ask for an unbounded
 * chain of renders — every level is one more full html-to-image render.
 */
export const MAX_FRAME_LEVELS = 6

/** Level count used when nothing is configured or a request leaves it out. */
export const DEFAULT_FRAME_LEVELS = 2

function clampLevels(value: number): number {
  return Math.min(Math.max(Math.floor(value), 1), MAX_FRAME_LEVELS)
}

/**
 * Clamp a configured or received depth to a usable level count.
 *
 * The value is read from the settings on one side and arrives over the bridge on
 * the other, so it is treated as untrusted input: a missing, empty, fractional or
 * non-numeric depth falls back instead of becoming a `NaN` comparison that would
 * silently stop every frame from rendering.
 */
export function frameLevels(value: unknown, fallback: number = DEFAULT_FRAME_LEVELS): number {
  const raw = value === '' || value === null || value === undefined ? Number.NaN : Number(value)
  return Number.isFinite(raw) ? clampLevels(raw) : clampLevels(fallback)
}
