import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAME_LEVELS,
  MAX_FRAME_LEVELS,
  frameLevels
} from '../src/core/frame-levels'

describe('frame levels', () => {
  it('clamps a configured depth into the supported range', () => {
    expect(frameLevels(1)).toBe(1)
    expect(frameLevels(4)).toBe(4)
    expect(frameLevels(MAX_FRAME_LEVELS)).toBe(MAX_FRAME_LEVELS)
    expect(frameLevels(0)).toBe(1)
    expect(frameLevels(-3)).toBe(1)
    expect(frameLevels(99)).toBe(MAX_FRAME_LEVELS)
    // The setting is stored as text; a fractional value is a level, not a NaN.
    expect(frameLevels('3')).toBe(3)
    expect(frameLevels(2.9)).toBe(2)
  })

  it('falls back for a missing or unusable value', () => {
    expect(frameLevels(undefined)).toBe(DEFAULT_FRAME_LEVELS)
    expect(frameLevels(null)).toBe(DEFAULT_FRAME_LEVELS)
    // An empty string would otherwise clamp to 1: `Number('')` is 0.
    expect(frameLevels('')).toBe(DEFAULT_FRAME_LEVELS)
    expect(frameLevels('abc')).toBe(DEFAULT_FRAME_LEVELS)
    expect(frameLevels(Number.NaN)).toBe(DEFAULT_FRAME_LEVELS)
    expect(frameLevels(undefined, 1)).toBe(1)
  })
})
