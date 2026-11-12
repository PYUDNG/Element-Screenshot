import { describe, expect, it } from 'vitest'
import type { SettingsGroup, SettingsTab, SettingsValues } from '@element-screenshot/settings'
import { createSettingsTabs } from '../src/config/schema'

const tabs: SettingsTab[] = createSettingsTabs()

function tab(id: string): SettingsTab {
  const found = tabs.find((item) => item.id === id)
  if (!found) throw new Error(`missing tab: ${id}`)
  return found
}

function group(tabId: string, groupId: string): SettingsGroup {
  const found = tab(tabId).groups.find((item) => item.id === groupId)
  if (!found) throw new Error(`missing group: ${tabId}/${groupId}`)
  return found
}

/** Keys the panel would actually render for these values. */
function shown(tabId: string, groupId: string, values: SettingsValues): string[] {
  return group(tabId, groupId)
    .fields.filter((field) => (field.visible ? field.visible(values) : true))
    .map((field) => field.key)
}

const basic: SettingsValues = { 'capture.backgroundAuto': true }
const withAdvanced: SettingsValues = { ...basic, 'ui.advanced': true }

describe('settings schema', () => {
  it('orders the app tabs and leaves the general tab to the library', () => {
    expect(tabs.map((item) => item.id)).toEqual(['capture', 'trigger', 'appearance', 'sites'])
  })

  it('keeps the picker and output groups in the capture tab', () => {
    expect(tab('capture').groups.map((item) => item.id)).toEqual(['picker', 'output'])
    expect(group('capture', 'picker').fields.map((field) => field.key)).toContain(
      'capture.pointerPassthrough'
    )
  })

  it('owns the theme and the selection frame in the appearance tab', () => {
    expect(tab('appearance').groups.map((item) => item.id)).toEqual(['theme', 'frame'])
    expect(group('appearance', 'theme').fields.map((field) => field.key)).toEqual([
      'theme',
      'ui.primary'
    ])
    expect(group('appearance', 'frame').fields.map((field) => field.key)).toEqual([
      'capture.borderColor',
      'capture.borderWidth'
    ])
  })

  it('hides the advanced fields while the switch is off', () => {
    expect(shown('capture', 'picker', basic)).toEqual(['capture.pointerPassthrough'])
    expect(shown('capture', 'output', basic)).toEqual([
      'capture.scale',
      'capture.backgroundAuto',
      'capture.transparent'
    ])
  })

  it('reveals them when the switch is on', () => {
    expect(shown('capture', 'picker', withAdvanced)).toEqual([
      'capture.pointerPassthrough',
      'picker.frameDepth'
    ])
    expect(shown('capture', 'output', withAdvanced)).toEqual([
      'capture.scale',
      'capture.backgroundAuto',
      'capture.transparent',
      'capture.expandNested'
    ])
  })

  it('declares every field key once', () => {
    const keys = tabs.flatMap((item) =>
      item.groups.flatMap((entry) => entry.fields.map((field) => field.key))
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})
