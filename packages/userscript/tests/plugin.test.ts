import { describe, expect, it } from 'vitest'
import {
  gmFetchPlugin,
  patchCloneCanvas,
  patchCloneVideo,
  patchCreateImage,
  patchFontEmbedding,
  patchImageEmbedding,
  patchNativeCalls,
  patchSvgSerialization,
  patchSvgSymbols,
  rewriteFetchReferences
} from '../src/plugin/gm-fetch-plugin'

describe('gm-fetch Vite plugin', () => {
  it('rewrites global fetch and XMLHttpRequest references', () => {
    const source = `
      export async function load(url) {
        const res = await fetch(url, { cache: 'force-cache' })
        const xhr = new XMLHttpRequest()
        obj.fetch(url)
        window.XMLHttpRequest
        return res
      }
    `
    const result = rewriteFetchReferences(source, { sourceFile: 'dataurl.js' })
    expect(result.changed).toBe(true)
    expect(result.code).toContain('__gmFetch(url, { cache:')
    expect(result.code).toContain('new __gmXMLHttpRequest()')
    expect(result.code).toContain('obj.fetch(url)')
    expect(result.code).toContain('window.XMLHttpRequest')
    expect(result.code).toContain("from 'virtual:gm-fetch'")
    expect(result.map).toBeDefined()
  })

  it('leaves shadowed bindings alone', () => {
    const source = `const fetch = () => 1; export const value = fetch()`
    const result = rewriteFetchReferences(source)
    expect(result.changed).toBe(false)
    expect(result.code).toBe(source)
  })

  it('handles destructured names and properties', () => {
    const source = `
      const { fetch: localFetch } = window
      const value = { fetch }
      const result = fetch('/x')
    `
    const result = rewriteFetchReferences(source)
    expect(result.code).toContain('localFetch')
    expect(result.code).toContain('{ fetch }')
    expect(result.code).toContain("__gmFetch('/x')")
  })

  it('exposes the virtual adapter module', () => {
    const plugin = gmFetchPlugin()
    const resolveId = plugin.resolveId as unknown as (id: string) => string | null
    const load = plugin.load as unknown as (id: string) => string | null

    expect(resolveId('virtual:gm-fetch')).toBe('\0virtual:gm-fetch')
    expect(load('\0virtual:gm-fetch')).toContain('GMXMLHttpRequest')
    expect(resolveId('other')).toBeNull()
  })

  it('replaces html-to-image stylesheet inlining with a read-only walk', () => {
    const source = `
async function getCSSRules(styleSheets, options) {
  const ret = [];
  styleSheets.forEach((sheet) => {
    try { sheet.cssRules.forEach((rule) => ret.push(rule)); }
    catch (e) { console.error('Error inlining remote css file', e); }
  });
  return ret;
}
function getWebFontRules(cssRules) {
  return cssRules;
}
`
    const result = patchFontEmbedding(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('Cross-origin stylesheets cannot be inspected')
    expect(result.code).toContain('visited.has(sheet)')
    expect(result.code).not.toContain('console.error')
    expect(result.code).not.toContain('insertRule')
    expect(result.code).toContain('function getWebFontRules')
  })

  it('resolves SVG use hrefs without treating them as CSS selectors', () => {
    const source = `
async function ensureSVGSymbols(clone, options) {
  const id = use.getAttribute('xlink:href');
  const exist = clone.querySelector(id);
  const definition = document.querySelector(id);
  return clone;
}
export async function cloneNode(node, options, isRoot) {
  return node;
}
`
    const result = patchSvgSymbols(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('lastIndexOf')
    expect(result.code).toContain('DOMParser')
    expect(result.code).toContain('__elementShotSvgCache')
    expect(result.code).toContain('__elementShotNative.document.getElementById')
    expect(result.code).not.toContain('clone.querySelector(id)')
    expect(result.code).toContain('export async function cloneNode')
  })

  it('transforms html-to-image modules only', () => {
    const plugin = gmFetchPlugin()
    const transform = plugin.transform as unknown as (
      code: string,
      id: string
    ) => { code: string } | null

    const source = `export const load = (url) => fetch(url)`
    const transformed = transform(source, '/repo/node_modules/html-to-image/es/dataurl.js')
    expect(transformed?.code).toContain('__gmFetch(url)')
    expect(transform(source, '/repo/src/app.ts')).toBeNull()
  })

  it('routes canvas and clone calls through the native snapshot', () => {
    const source = `
      const data = canvas.toDataURL();
      const jpeg = canvas.toDataURL('image/jpeg', 0.8);
      canvas.toBlob(done, 'image/png');
      const context = canvas.getContext('2d');
      context.fillRect(0, 0, 10, 10);
      context.drawImage(image, 0, 0);
      const copy = node.cloneNode(isSVGElement(node));
      if (options.backgroundColor) {
        style.backgroundColor = options.backgroundColor;
      }
    `
    const result = patchNativeCalls(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('__elementShotNative.canvas.toDataURL(canvas)')
    expect(result.code).toContain('__elementShotNative.canvas.toDataURL(canvas, ')
    expect(result.code).toContain('__elementShotNative.canvas.toBlob(canvas, done')
    expect(result.code).toContain('__elementShotNative.canvas.getContext(canvas)')
    expect(result.code).toContain('__elementShotNative.canvas.fillRect(context, ')
    expect(result.code).toContain('__elementShotNative.canvas.drawImage(context, ')
    expect(result.code).toContain('__elementShotNative.cloneNode(node, isSVGElement(node))')
    expect(result.code).toContain('canvas fill handles the backdrop')
  })

  it('sanitizes the serialized SVG before creating its data URL', () => {
    const source = `
export async function svgToDataURL(svg) {
  return Promise.resolve()
    .then(() => new XMLSerializer().serializeToString(svg))
    .then(encodeURIComponent)
    .then((html) => \`data:image/svg+xml;charset=utf-8,\${html}\`);
}
export async function nodeToDataURL(node, width, height) {
  return svgToDataURL(node);
}
`
    const result = patchSvgSerialization(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('__elementShotNative.sanitizeSvgAttributes(svg)')
    expect(result.code).toContain('__elementShotNative.sanitizeSvgNamespaces(svg)')
    expect(result.code).toContain('__elementShotNative.serializeSvg(svg)')
    expect(result.code).toContain('.then(__elementShotNative.sanitizeXmlText)')
    expect(result.code).not.toContain('new XMLSerializer')
    expect(result.code).toContain('export async function nodeToDataURL')
  })

  it('applies SVG serialization sanitization in the Vite transform', () => {
    const plugin = gmFetchPlugin()
    const transform = plugin.transform as unknown as (
      code: string,
      id: string
    ) => { code: string } | null
    const source = `
export async function svgToDataURL(svg) {
  return Promise.resolve().then(() => new XMLSerializer().serializeToString(svg)).then(encodeURIComponent);
}
export async function nodeToDataURL(node, width, height) {
  return svgToDataURL(node);
}
`
    const transformed = transform(source, '/repo/node_modules/html-to-image/es/util.js')
    expect(transformed?.code).toContain('sanitizeSvgAttributes')
    expect(transformed?.code).toContain('sanitizeSvgNamespaces')
    expect(transformed?.code).toContain('sanitizeXmlText')
    expect(transformed?.code).toContain('__elementShotNative.serializeSvg(svg)')
  })

  it('injects the native prelude only when configured', () => {
    const plugin = gmFetchPlugin({ nativeAdapter: 'virtual:test-native' })
    const transform = plugin.transform as unknown as (
      code: string,
      id: string
    ) => { code: string } | null
    const source = `export const value = 1`
    const transformed = transform(source, '/repo/node_modules/html-to-image/es/mimes.js')
    expect(transformed?.code).toContain('import { native as __elementShotNative }')
    expect(transformed?.code).toContain('const document = __elementShotNative.document')
    expect(transformed?.code).toContain(
      'const HTMLCanvasElement = __elementShotNative.HTMLCanvasElement'
    )
  })

  it('bounds both fetching and loading an image', () => {
    const source = `
async function embedImageNode(clonedNode, options) {
    const isImageElement = isInstanceOfElement(clonedNode, HTMLImageElement);
    const url = isImageElement ? clonedNode.src : clonedNode.href.baseVal;
    const dataURL = await resourceToDataURL(url, getMimeType(url), options);
    await new Promise((resolve, reject) => {
        clonedNode.onload = resolve;
        clonedNode.onerror = options.onImageErrorHandler
            ? (...attributes) => {
                try {
                    resolve(options.onImageErrorHandler(...attributes));
                }
                catch (error) {
                    reject(error);
                }
            }
            : reject;
        const image = clonedNode;
        if (image.decode) {
            image.decode = resolve;
        }
        if (image.loading === 'lazy') {
            image.loading = 'eager';
        }
        if (isImageElement) {
            clonedNode.srcset = '';
            clonedNode.src = dataURL;
        }
        else {
            clonedNode.href.baseVal = dataURL;
        }
    });
}
async function embedChildren(clonedNode, options) {
    return clonedNode;
}
`
    const result = patchImageEmbedding(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('Promise.race')
    expect(result.code).toContain('15000')
    expect(result.code).toContain('setTimeout(() => finish(undefined), 8000)')
    expect(result.code).toContain('async function embedChildren')
    expect(result.code).not.toContain('reject(error)')
  })

  it('leaves source without embedImageNode alone', () => {
    const source = 'export const value = 1'
    expect(patchImageEmbedding(source)).toEqual({ code: source, changed: false })
  })

  it('resolves the final SVG image without waiting for an animation frame', () => {
    const source = `
export function createImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            img.decode().then(() => {
                requestAnimationFrame(() => resolve(img));
            });
        };
        img.onerror = reject;
        img.crossOrigin = 'anonymous';
        img.src = url;
    });
}
`
    const result = patchCreateImage(source)
    expect(result.changed).toBe(true)
    expect(result.code).not.toContain('requestAnimationFrame')
    expect(result.code).toContain('img.decode().then(finish, finish)')
    expect(result.code).toContain('setTimeout(finish, 100)')
    expect(result.code).toContain('img.onerror = reject')
  })

  it('leaves source without createImage alone', () => {
    const source = 'export const value = 1'
    expect(patchCreateImage(source)).toEqual({ code: source, changed: false })
  })

  it('returns an empty canvas clone when the page canvas is tainted', () => {
    const source = `
async function cloneCanvasElement(canvas) {
    const dataURL = canvas.toDataURL();
    if (dataURL === 'data:,') return canvas.cloneNode(false);
    return createImage(dataURL);
}
async function cloneVideoElement(video, options) {
    return video;
}
`
    const result = patchCloneCanvas(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('catch (error)')
    expect(result.code).toContain('return canvas.cloneNode(false)')
    expect(result.code).toContain('async function cloneVideoElement')
  })

  it('leaves source without cloneCanvasElement alone', () => {
    const source = 'export const value = 1'
    expect(patchCloneCanvas(source)).toEqual({ code: source, changed: false })
  })

  it('falls back to the poster when a cross-origin video taints the canvas', () => {
    const source = `
async function cloneVideoElement(video, options) {
    if (video.currentSrc) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
        ctx === null || ctx === void 0 ? void 0 : ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL();
        return createImage(dataURL);
    }
    const poster = video.poster;
    const contentType = getMimeType(poster);
    const dataURL = await resourceToDataURL(poster, contentType, options);
    return createImage(dataURL);
}
async function cloneIFrameElement(iframe, options) {
    return iframe;
}
`
    const result = patchCloneVideo(source)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('const frame = canvas.toDataURL()')
    expect(result.code).toContain('catch (error)')
    expect(result.code).toContain('const dataURL = await resourceToDataURL(poster')
    expect(result.code).toContain('async function cloneIFrameElement')
  })

  it('leaves source without cloneVideoElement alone', () => {
    const source = 'export const value = 1'
    expect(patchCloneVideo(source)).toEqual({ code: source, changed: false })
  })
})
