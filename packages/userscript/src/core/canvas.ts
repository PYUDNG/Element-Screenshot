import { native } from './native'

export interface Drawable {
  source: CanvasImageSource
  close: () => void
}

/**
 * Decode a blob into something `drawImage` accepts. `createImageBitmap` is the
 * fast path; the `<img>` fallback keeps older engines working.
 */
export async function blobToDrawable(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return { source: bitmap, close: () => bitmap.close() }
  }

  const url = native.createObjectURL?.(blob)
  if (!url) throw new Error('Object URLs are not supported')
  try {
    const image = native.document.createElement('img')
    await new Promise<void>((resolve, reject) => {
      const timer = native.setTimeout(() => reject(new Error('Image decode timed out')), 5_000)
      image.onload = () => {
        native.clearTimeout(timer)
        resolve()
      }
      image.onerror = () => {
        native.clearTimeout(timer)
        reject(new Error('Image decode failed'))
      }
      image.src = url
    })
    return { source: image, close: () => native.revokeObjectURL?.(url) }
  } catch (error) {
    native.revokeObjectURL?.(url)
    throw error
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    native.canvas.toBlob(
      canvas,
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas returned an empty image'))
      },
      type
    )
  })
}
