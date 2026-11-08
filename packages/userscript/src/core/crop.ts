import { native } from './native'
import { blobToDrawable, canvasToBlob } from './canvas'
import type { TargetBox } from './target'

export interface CropPlan {
  /** Source rectangle on the rendered surface, in device pixels. */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Output size in device pixels. */
  width: number
  height: number
}

/**
 * Map a region in CSS pixels onto the pixels of a rendered viewport-sized
 * surface. Rounding happens once, and the source rectangle is clamped to the
 * bitmap so a region touching the viewport edge cannot sample outside it.
 */
export function planCrop(
  rect: TargetBox,
  ratio: number,
  surfaceWidth: number,
  surfaceHeight: number
): CropPlan {
  const canvasWidth = Math.max(1, Math.round(surfaceWidth * ratio))
  const canvasHeight = Math.max(1, Math.round(surfaceHeight * ratio))
  const sx = Math.min(Math.max(Math.round(rect.left * ratio), 0), canvasWidth - 1)
  const sy = Math.min(Math.max(Math.round(rect.top * ratio), 0), canvasHeight - 1)
  const width = Math.min(Math.max(Math.round(rect.width * ratio), 1), canvasWidth - sx)
  const height = Math.min(Math.max(Math.round(rect.height * ratio), 1), canvasHeight - sy)
  return { sx, sy, sw: width, sh: height, width, height }
}

export async function cropBlob(source: Blob, plan: CropPlan): Promise<Blob> {
  const canvas = native.document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const context = native.canvas.getContext(canvas)
  if (!context) throw new Error('Canvas 2D context is unavailable')

  const drawable = await blobToDrawable(source)
  try {
    native.canvas.drawImage(
      context,
      drawable.source,
      plan.sx,
      plan.sy,
      plan.sw,
      plan.sh,
      0,
      0,
      plan.width,
      plan.height
    )
  } finally {
    drawable.close()
  }

  return canvasToBlob(canvas)
}
