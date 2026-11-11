import { describe, expect, it } from 'vitest'
import { SETTINGS_STEPS } from '../src/config/migrate'

const step = SETTINGS_STEPS[0]

function run(stored: string): Record<string, unknown> | string {
  const next = step.run(stored)
  return next === stored ? next : (JSON.parse(next) as Record<string, unknown>)
}

describe('pointer switch migration (generation 1)', () => {
  it('turns a stored "isolation off" into passthrough on', () => {
    expect(run(JSON.stringify({ 'capture.pointerIsolation': false, 'capture.scale': 2 }))).toEqual({
      'capture.scale': 2,
      'capture.pointerPassthrough': true
    })
  })

  it('turns a stored "isolation on" into passthrough off', () => {
    expect(run(JSON.stringify({ 'capture.pointerIsolation': true }))).toEqual({
      'capture.pointerPassthrough': false
    })
  })

  it('keeps a value the new switch already has and drops the old key', () => {
    expect(
      run(
        JSON.stringify({
          'capture.pointerIsolation': true,
          'capture.pointerPassthrough': true
        })
      )
    ).toEqual({ 'capture.pointerPassthrough': true })
  })

  it('drops a legacy value that is not a boolean', () => {
    expect(run(JSON.stringify({ 'capture.pointerIsolation': 'yes' }))).toEqual({})
  })

  it('returns the payload untouched when there is nothing to rewrite', () => {
    expect(run(JSON.stringify({ 'capture.scale': 2 }))).toBe(JSON.stringify({ 'capture.scale': 2 }))
    expect(run('not json')).toBe('not json')
    expect(run('')).toBe('')
    expect(run(JSON.stringify([1, 2]))).toBe(JSON.stringify([1, 2]))
  })
})
