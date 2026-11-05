import { describe, expect, it } from 'vitest'
import { computePickerLabelPosition } from '../src/ui/picker-label'

describe('picker label placement', () => {
  it('places the label above the element when there is room', () => {
    expect(computePickerLabelPosition(120, 200, 1280, 800)).toEqual({
      left: 120,
      top: 160,
      maxWidth: 360
    })
  })

  it('keeps the label visible when the element starts above the viewport', () => {
    expect(computePickerLabelPosition(120, -240, 1280, 800)).toEqual({
      left: 120,
      top: 8,
      maxWidth: 360
    })
  })

  it('clamps both axes near the bottom-right edge', () => {
    expect(computePickerLabelPosition(1270, 790, 1280, 800)).toEqual({
      left: 912,
      top: 750,
      maxWidth: 360
    })
  })

  it('shrinks the label on narrow viewports', () => {
    expect(computePickerLabelPosition(-20, 30, 320, 640)).toEqual({
      left: 8,
      top: 38,
      maxWidth: 304
    })
  })
})
