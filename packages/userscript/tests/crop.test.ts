import { afterEach, describe, expect, it, vi } from 'vitest'
import { cropBlob, planCrop } from '../src/core/crop'
import { native } from '../src/core/native'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('crop planning', () => {
  it('maps CSS pixels onto device pixels of the rendered surface', () => {
    expect(planCrop({ left: 100, top: 60, width: 200, height: 120 }, 2, 1000, 800)).toEqual({
      sx: 200,
      sy: 120,
      sw: 400,
      sh: 240,
      width: 400,
      height: 240
    })
  })

  it('rounds once and keeps the source inside the bitmap', () => {
    const plan = planCrop({ left: 999.6, top: 799.6, width: 50, height: 50 }, 1, 1000, 800)
    expect(plan).toEqual({ sx: 999, sy: 799, sw: 1, sh: 1, width: 1, height: 1 })

    const scaled = planCrop({ left: 1.4, top: 2.6, width: 10.2, height: 10.2 }, 1.5, 1000, 800)
    expect(scaled).toEqual({ sx: 2, sy: 4, sw: 15, sh: 15, width: 15, height: 15 })
  })

  it('never plans an empty crop', () => {
    const plan = planCrop({ left: 0, top: 0, width: 0, height: 0 }, 1, 100, 100)
    expect(plan.width).toBe(1)
    expect(plan.height).toBe(1)
  })
})

describe('crop rendering', () => {
  it('draws only the planned source rectangle and encodes the result', async () => {
    const context = {} as CanvasRenderingContext2D
    vi.spyOn(native.canvas, 'getContext').mockReturnValue(context)
    const drawImage = vi.spyOn(native.canvas, 'drawImage').mockImplementation(() => {})
    const blob = new Blob(['png'], { type: 'image/png' })
    vi.spyOn(native.canvas, 'toBlob').mockImplementation((_canvas, callback) => {
      callback(blob)
    })
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap)
    )

    const result = await cropBlob(new Blob(['source']), {
      sx: 10,
      sy: 20,
      sw: 30,
      sh: 40,
      width: 30,
      height: 40
    })

    expect(result).toBe(blob)
    expect(drawImage).toHaveBeenCalledWith(context, expect.anything(), 10, 20, 30, 40, 0, 0, 30, 40)
    vi.unstubAllGlobals()
  })

  it('reports a missing canvas context', async () => {
    vi.spyOn(native.canvas, 'getContext').mockReturnValue(null)
    await expect(
      cropBlob(new Blob(['source']), { sx: 0, sy: 0, sw: 1, sh: 1, width: 1, height: 1 })
    ).rejects.toThrow('Canvas 2D context is unavailable')
  })
})
