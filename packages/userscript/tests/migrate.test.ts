import { describe, expect, it } from 'vitest'
import { migratePointerSetting } from '../src/config/migrate'

describe('pointer setting migration', () => {
  it('turns a stored "isolation off" into passthrough on', () => {
    const stored = JSON.stringify({ 'capture.pointerIsolation': false, 'capture.scale': 2 })
    expect(JSON.parse(migratePointerSetting(stored) ?? '{}')).toEqual({
      'capture.scale': 2,
      'capture.pointerPassthrough': true
    })
  })

  it('turns a stored "isolation on" into passthrough off', () => {
    const stored = JSON.stringify({ 'capture.pointerIsolation': true })
    expect(JSON.parse(migratePointerSetting(stored) ?? '{}')).toEqual({
      'capture.pointerPassthrough': false
    })
  })

  it('keeps a value the new switch already has and drops the old key', () => {
    const stored = JSON.stringify({
      'capture.pointerIsolation': true,
      'capture.pointerPassthrough': true
    })
    expect(JSON.parse(migratePointerSetting(stored) ?? '{}')).toEqual({
      'capture.pointerPassthrough': true
    })
  })

  it('drops a legacy value that is not a boolean', () => {
    const stored = JSON.stringify({ 'capture.pointerIsolation': 'yes' })
    expect(JSON.parse(migratePointerSetting(stored) ?? '{}')).toEqual({})
  })

  it('does nothing without a legacy key or without stored settings', () => {
    expect(migratePointerSetting(null)).toBeNull()
    expect(migratePointerSetting(JSON.stringify({ 'capture.scale': 2 }))).toBeNull()
    expect(migratePointerSetting('not json')).toBeNull()
    expect(migratePointerSetting(JSON.stringify([1, 2]))).toBeNull()
  })
})
