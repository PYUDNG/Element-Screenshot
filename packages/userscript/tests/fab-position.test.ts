import { describe, expect, it } from 'vitest'
import {
  DOCK_DISTANCE,
  FAB_MARGIN,
  FAB_PEEK_OPACITY,
  clampToViewport,
  edgeMax,
  freeRange,
  freeRatio,
  nearestDock,
  peekStyle,
  placeFree,
  placeStored,
  readDock,
  resolveDrop
} from '../src/ui/fab-position'

const viewport = { width: 1200, height: 800 }
const size = 48

describe('floating button placement', () => {
  it('keeps a free placement inside the margin', () => {
    expect(placeFree(0, 0, viewport, size)).toEqual({ left: FAB_MARGIN, top: FAB_MARGIN })
    expect(placeFree(1, 1, viewport, size)).toEqual({
      left: edgeMax(viewport.width, size) - FAB_MARGIN,
      top: edgeMax(viewport.height, size) - FAB_MARGIN
    })
    expect(placeFree(0.5, 0.5, viewport, size)).toEqual({
      left: Math.round((viewport.width - size) / 2),
      top: Math.round((viewport.height - size) / 2)
    })
  })

  it('clamps ratios that were stored out of range', () => {
    expect(placeFree(-3, 9, viewport, size)).toEqual({ left: FAB_MARGIN, top: edgeMax(viewport.height, size) - FAB_MARGIN })
  })

  it('round-trips a free position through the stored ratio', () => {
    const left = 137
    const top = 402
    const restored = placeFree(
      freeRatio(left, viewport.width, size),
      freeRatio(top, viewport.height, size),
      viewport,
      size
    )
    expect(restored).toEqual({ left, top })
  })

  it('survives a viewport smaller than the button', () => {
    const tiny = { width: 40, height: 30 }
    expect(freeRange(tiny.width, size)).toEqual({ min: FAB_MARGIN, max: FAB_MARGIN })
    expect(placeFree(0.4, 0.6, tiny, size)).toEqual({ left: FAB_MARGIN, top: FAB_MARGIN })
    expect(edgeMax(tiny.width, size)).toBe(0)
    expect(freeRatio(FAB_MARGIN, tiny.width, size)).toBe(0)
  })

  it('restores a docked placement flush against its edge', () => {
    expect(placeStored(0.25, 0.5, viewport, size, 'left')).toEqual({
      left: 0,
      top: Math.round(0.5 * (viewport.height - size)),
      dock: 'left'
    })
    expect(placeStored(0.25, 0.5, viewport, size, 'right')).toEqual({
      left: edgeMax(viewport.width, size),
      top: Math.round(0.5 * (viewport.height - size)),
      dock: 'right'
    })
    expect(placeStored(0.25, 0.5, viewport, size, 'bottom')).toEqual({
      left: Math.round(0.25 * (viewport.width - size)),
      top: edgeMax(viewport.height, size),
      dock: 'bottom'
    })
  })

  it('docks only when the drop is within the snap distance', () => {
    expect(DOCK_DISTANCE).toBeLessThan(FAB_MARGIN + 20)
    expect(resolveDrop(4, 300, viewport, size)).toEqual({ left: 0, top: 300, dock: 'left' })
    // Just outside the snap distance the button simply stays where it was
    // dropped instead of jumping to the margin.
    expect(resolveDrop(4 + DOCK_DISTANCE + 1, 300, viewport, size)).toEqual({
      left: 15,
      top: 300,
      dock: null
    })
    // A drop inside the margin but outside the snap distance cannot rest flush.
    expect(resolveDrop(4 + DOCK_DISTANCE, 300, viewport, size)).toEqual({
      left: 14,
      top: 300,
      dock: null
    })
    expect(resolveDrop(600, 300, viewport, size)).toEqual({ left: 600, top: 300, dock: null })
  })

  it('docks the nearest edge and keeps the other axis inside its margin', () => {
    const right = edgeMax(viewport.width, size)
    const bottom = edgeMax(viewport.height, size)
    // Dropped in the bottom-right corner: bottom is 2px away, right is 5px.
    expect(resolveDrop(right - 5, bottom - 2, viewport, size)).toEqual({
      left: right - FAB_MARGIN,
      top: bottom,
      dock: 'bottom'
    })
    // Flush in the top-left corner: `left` wins the tie, so the button parks on
    // the left edge instead of hiding in two directions at once.
    expect(resolveDrop(0, 0, viewport, size)).toEqual({ left: 0, top: FAB_MARGIN, dock: 'left' })
  })

  it('clamps a drag to the viewport, edges included', () => {
    expect(clampToViewport(-40, -10, viewport, size)).toEqual({ left: 0, top: 0 })
    expect(clampToViewport(9999, 9999, viewport, size)).toEqual({
      left: edgeMax(viewport.width, size),
      top: edgeMax(viewport.height, size)
    })
    expect(clampToViewport(10.6, 20.2, viewport, size)).toEqual({ left: 11, top: 20 })
  })

  it('measures the distance to the closest edge', () => {
    expect(nearestDock(30, 400, viewport, size)).toEqual({ dock: 'left', distance: 30 })
    expect(nearestDock(600, 10, viewport, size)).toEqual({ dock: 'top', distance: 10 })
  })

  it('hides half of a docked button until it is revealed', () => {
    expect(peekStyle({ left: 0, top: 200, dock: 'left' }, false)).toEqual({
      transform: 'translateX(-50%)',
      opacity: FAB_PEEK_OPACITY
    })
    expect(peekStyle({ left: 0, top: 200, dock: 'right' }, false).transform).toBe('translateX(50%)')
    expect(peekStyle({ left: 0, top: 200, dock: 'top' }, false).transform).toBe('translateY(-50%)')
    expect(peekStyle({ left: 0, top: 200, dock: 'bottom' }, false).transform).toBe('translateY(50%)')
    expect(peekStyle({ left: 0, top: 200, dock: 'left' }, true)).toEqual({
      transform: 'none',
      opacity: 1
    })
    expect(peekStyle({ left: 40, top: 200, dock: null }, false)).toEqual({
      transform: 'none',
      opacity: 1
    })
  })

  it('ignores an unrecognised stored dock edge', () => {
    expect(readDock('left')).toBe('left')
    expect(readDock('')).toBeNull()
    expect(readDock('diagonal')).toBeNull()
    expect(readDock(undefined)).toBeNull()
  })
})
