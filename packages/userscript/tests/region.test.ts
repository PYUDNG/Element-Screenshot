import { describe, expect, it } from 'vitest'
import {
  clampPoint,
  clampRegion,
  dragDistance,
  exceedsDragThreshold,
  isCaptureRegion,
  REGION_DRAG_THRESHOLD,
  REGION_MIN_SIZE,
  regionFromPoints,
  regionSamplePoints
} from '../src/core/region'

const viewport = { width: 1000, height: 800 }

describe('region geometry', () => {
  it('normalizes a drag regardless of its direction', () => {
    expect(regionFromPoints({ x: 100, y: 80 }, { x: 400, y: 300 }, viewport)).toEqual({
      left: 100,
      top: 80,
      width: 300,
      height: 220
    })
    expect(regionFromPoints({ x: 400, y: 300 }, { x: 100, y: 80 }, viewport)).toEqual({
      left: 100,
      top: 80,
      width: 300,
      height: 220
    })
  })

  it('clamps both corners to the viewport', () => {
    expect(regionFromPoints({ x: -20, y: -40 }, { x: 5000, y: 900 }, viewport)).toEqual({
      left: 0,
      top: 0,
      width: 1000,
      height: 800
    })
    expect(clampPoint({ x: 1200, y: -5 }, viewport)).toEqual({ x: 1000, y: 0 })
  })

  it('measures pointer travel', () => {
    expect(dragDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true)
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false)
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 0 }, REGION_DRAG_THRESHOLD)).toBe(false)
  })

  it('rejects regions below the minimum size', () => {
    expect(isCaptureRegion({ left: 0, top: 0, width: REGION_MIN_SIZE, height: 4 })).toBe(false)
    expect(isCaptureRegion({ left: 0, top: 0, width: 200, height: 3 })).toBe(false)
    expect(isCaptureRegion({ left: 0, top: 0, width: 200, height: 120 })).toBe(true)
  })

  it('keeps a region inside the viewport', () => {
    expect(clampRegion({ left: 900, top: 700, width: 400, height: 400 }, viewport)).toEqual({
      left: 900,
      top: 700,
      width: 100,
      height: 100
    })
    expect(clampRegion({ left: -50, top: -50, width: 120, height: 60 }, viewport)).toEqual({
      left: 0,
      top: 0,
      width: 70,
      height: 10
    })
  })

  it('samples the centre and the four inset corners', () => {
    const points = regionSamplePoints({ left: 100, top: 50, width: 200, height: 100 })
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual({ x: 200, y: 100 })
    expect(points[1]).toEqual({ x: 108, y: 58 })
    expect(points[4]).toEqual({ x: 292, y: 142 })
  })
})
