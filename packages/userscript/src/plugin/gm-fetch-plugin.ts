import { parse } from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import type { Plugin } from 'vite'

export interface RewriteOptions {
  adapterModule?: string
  fetchReplacement?: string
  xhrReplacement?: string
  sourceFile?: string
}

export interface RewriteResult {
  code: string
  changed: boolean
  map?: ReturnType<MagicString['generateMap']>
}

const DEFAULT_ADAPTER = 'virtual:gm-fetch'
const NATIVE_VIRTUAL = 'virtual:element-screenshot-native'
const NATIVE_ADAPTER = 'virtual:element-screenshot-native-adapter'

const NATIVE_PRELUDE = `import { native as __elementScreenshotNative } from '${NATIVE_VIRTUAL}';
const window = __elementScreenshotNative.window;
const document = __elementScreenshotNative.document;
const getComputedStyle = __elementScreenshotNative.getComputedStyle;
const requestAnimationFrame = __elementScreenshotNative.requestAnimationFrame;
const setTimeout = __elementScreenshotNative.setTimeout;
const clearTimeout = __elementScreenshotNative.clearTimeout;
const Image = __elementScreenshotNative.Image;
const XMLSerializer = __elementScreenshotNative.XMLSerializer;
const Blob = __elementScreenshotNative.Blob;
const FileReader = __elementScreenshotNative.FileReader;
const URL = __elementScreenshotNative.URL;
const DOMParser = __elementScreenshotNative.DOMParser;
const Element = __elementScreenshotNative.Element;
const HTMLElement = __elementScreenshotNative.HTMLElement;
const HTMLCanvasElement = __elementScreenshotNative.HTMLCanvasElement;
const HTMLVideoElement = __elementScreenshotNative.HTMLVideoElement;
const HTMLIFrameElement = __elementScreenshotNative.HTMLIFrameElement;
const HTMLTextAreaElement = __elementScreenshotNative.HTMLTextAreaElement;
const HTMLInputElement = __elementScreenshotNative.HTMLInputElement;
const HTMLSelectElement = __elementScreenshotNative.HTMLSelectElement;
const HTMLImageElement = __elementScreenshotNative.HTMLImageElement;
const SVGImageElement = __elementScreenshotNative.SVGImageElement;
`

type Node = { type: string; [key: string]: unknown }

function collectPatternNames(node: unknown, names: Set<string>): void {
  if (!node || typeof node !== 'object') return
  const candidate = node as Node
  switch (candidate.type) {
    case 'Identifier':
      names.add(String(candidate.name))
      break
    case 'ObjectPattern': {
      const properties = candidate.properties as Node[] | undefined
      for (const property of properties ?? []) {
        collectPatternNames(
          property.type === 'RestElement' ? property.argument : property.value,
          names
        )
      }
      break
    }
    case 'ArrayPattern': {
      for (const element of (candidate.elements as unknown[] | undefined) ?? []) {
        collectPatternNames(element, names)
      }
      break
    }
    case 'AssignmentPattern':
      collectPatternNames(candidate.left, names)
      break
    case 'RestElement':
      collectPatternNames(candidate.argument, names)
      break
    default:
      break
  }
}

function collectTopLevelBindings(program: Node): Set<string> {
  const names = new Set<string>()
  const body = (program.body as Node[] | undefined) ?? []
  for (const statement of body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of (statement.declarations as Node[] | undefined) ?? []) {
        collectPatternNames(declaration.id, names)
      }
    } else if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
      const id = statement.id as Node | null
      if (id?.type === 'Identifier') names.add(String(id.name))
    } else if (statement.type === 'ImportDeclaration') {
      for (const specifier of (statement.specifiers as Node[] | undefined) ?? []) {
        const local = specifier.local as Node | undefined
        if (local?.type === 'Identifier') names.add(String(local.name))
      }
    }
  }
  return names
}

function isNonReference(node: Node, ancestors: Node[]): boolean {
  const parent = ancestors[ancestors.length - 2]
  if (!parent) return false

  switch (parent.type) {
    case 'MemberExpression':
      return parent.property === node && parent.computed !== true
    case 'Property':
      return (parent.key === node && parent.computed !== true) || parent.shorthand === true
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.key === node && parent.computed !== true
    case 'LabeledStatement':
      return parent.label === node
    case 'BreakStatement':
    case 'ContinueStatement':
      return parent.label === node
    case 'VariableDeclarator':
      return parent.id === node
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const params = (parent.params as unknown[] | undefined) ?? []
      return params.includes(node) || parent.id === node
    }
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
      return true
    case 'AssignmentPattern':
      return parent.left === node
    case 'RestElement':
      return parent.argument === node
    case 'ArrayPattern':
    case 'ObjectPattern':
      return true
    default:
      return false
  }
}

/**
 * Rewrite global `fetch(...)` and `new XMLHttpRequest()` references so that
 * html-to-image routes every network read through GM_xmlhttpRequest.
 */
export function rewriteFetchReferences(code: string, options: RewriteOptions = {}): RewriteResult {
  const adapterModule = options.adapterModule ?? DEFAULT_ADAPTER
  const fetchReplacement = options.fetchReplacement ?? '__gmFetch'
  const xhrReplacement = options.xhrReplacement ?? '__gmXMLHttpRequest'

  const program = parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true
  }) as unknown as Node

  const bindings = collectTopLevelBindings(program)
  const magic = new MagicString(code)
  let changed = false
  let hasFetch = false
  let hasXhr = false

  walk.ancestor(program as never, {
    Identifier(node, _state, ancestors) {
      const identifier = node as unknown as Node
      const name = String(identifier.name)

      if (name !== 'fetch' && name !== 'XMLHttpRequest') return
      if (bindings.has(name)) return
      if (isNonReference(identifier, ancestors as unknown as Node[])) return

      if (name === 'fetch') {
        magic.overwrite(identifier.start as number, identifier.end as number, fetchReplacement)
        hasFetch = true
      } else {
        magic.overwrite(identifier.start as number, identifier.end as number, xhrReplacement)
        hasXhr = true
      }
      changed = true
    }
  })

  if (!changed) return { code, changed: false }

  const imports: string[] = []
  if (hasFetch) imports.push(`gmFetch as ${fetchReplacement}`)
  if (hasXhr) imports.push(`GMXMLHttpRequest as ${xhrReplacement}`)
  magic.prepend(`import { ${imports.join(', ')} } from '${adapterModule}';\n`)

  return {
    code: magic.toString(),
    changed: true,
    map: magic.generateMap({
      source: options.sourceFile ?? 'html-to-image.js',
      hires: true,
      includeContent: true
    })
  }
}

/**
 * A page canvas that drew cross-origin content cannot be exported either.
 * Return an empty clone instead of letting `toDataURL()` abort the capture.
 */
export function patchCloneCanvas(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('async function cloneCanvasElement(')
  const end = code.indexOf('async function cloneVideoElement(', start)
  if (start < 0 || end <= start) return { code, changed: false }

  const replacement = `async function cloneCanvasElement(canvas) {
    let dataURL;
    try {
        dataURL = canvas.toDataURL();
    }
    catch (error) {
        return canvas.cloneNode(false);
    }
    if (dataURL === 'data:,') return canvas.cloneNode(false);
    return createImage(dataURL);
}
`
  return {
    code: `${code.slice(0, start)}${replacement}${code.slice(end)}`,
    changed: true
  }
}

/**
 * html-to-image draws a cross-origin video frame onto a canvas and exports it
 * with `toDataURL()`. The canvas is tainted, so the export throws a
 * SecurityError and the whole capture fails before the SVG is built. Keep the
 * frame when it is exportable; otherwise fall back to the poster (which is
 * fetched through GM_xmlhttpRequest and therefore not tainted).
 */
export function patchCloneVideo(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('async function cloneVideoElement(')
  const end = code.indexOf('async function cloneIFrameElement(', start)
  if (start < 0 || end <= start) return { code, changed: false }

  const replacement = `async function cloneVideoElement(video, options) {
    if (video.currentSrc) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
        try {
            ctx === null || ctx === void 0 ? void 0 : ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = canvas.toDataURL();
            if (frame) return createImage(frame);
        }
        catch (error) {
            // A cross-origin video frame taints the canvas; use the poster.
        }
    }
    const poster = video.poster;
    const contentType = getMimeType(poster);
    const dataURL = await resourceToDataURL(poster, contentType, options);
    return createImage(dataURL);
}
`
  return {
    code: `${code.slice(0, start)}${replacement}${code.slice(end)}`,
    changed: true
  }
}

/**
 * html-to-image resolves the final SVG image only inside a
 * `requestAnimationFrame` callback. Background and occluded tabs pause those
 * callbacks, so the capture never reaches the canvas even though the SVG is
 * ready. Resolve after decode (or a short timer) instead.
 */
export function patchCreateImage(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('export function createImage(url)')
  if (start < 0) return { code, changed: false }
  const blockStart = code.indexOf('        img.onload = () => {', start)
  const blockEnd = code.indexOf('        };', blockStart)
  if (blockStart < 0 || blockEnd < 0) return { code, changed: false }

  const replacement = `        img.onload = () => {
            const finish = () => resolve(img);
            img.decode().then(finish, finish);
            setTimeout(finish, 100);
        };
`
  return {
    code: `${code.slice(0, blockStart)}${replacement}${code.slice(blockEnd + '        };'.length)}`,
    changed: true
  }
}

/**
 * html-to-image waits forever for an `<img>` that never fires `load` or
 * `error` (some ad/tracker images do). It also waits for the resource fetch
 * before that. Add bounded waits so one broken image cannot leave the capture
 * stuck on "rendering" indefinitely; the image is replaced by the transparent
 * placeholder and the rest of the page is still captured.
 */
export function patchImageEmbedding(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('async function embedImageNode(')
  if (start < 0) return { code, changed: false }
  const blockStart = code.indexOf('    const dataURL = await resourceToDataURL(', start)
  const promiseStart = code.indexOf('    await new Promise((resolve, reject) => {', blockStart)
  const promiseEnd = code.indexOf('    });', promiseStart)
  if (blockStart < 0 || promiseStart < 0 || promiseEnd < 0) return { code, changed: false }

  const replacement = `    const dataURL = await Promise.race([
        resourceToDataURL(url, getMimeType(url), options),
        new Promise((resolve) => setTimeout(() => resolve(options.imagePlaceholder || ''), 15000))
    ]);
    await new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        timer = setTimeout(() => finish(undefined), 8000);
        clonedNode.onload = finish;
        clonedNode.onerror = (...attributes) => {
            try {
                finish(options.onImageErrorHandler ? options.onImageErrorHandler(...attributes) : undefined);
            }
            catch (error) {
                finish(undefined);
            }
        };
        const image = clonedNode;
        if (image.decode) {
            image.decode = finish;
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
`
  return {
    code: `${code.slice(0, blockStart)}${replacement}${code.slice(promiseEnd + '    });'.length)}`,
    changed: true
  }
}

/**
 * html-to-image 1.11 tries to inline every stylesheet, including cross-origin
 * sheets whose `cssRules` getter throws. Its fallback then inserts the fetched
 * CSS into `document.styleSheets[0]`, which both pollutes the page and logs
 * noisy SecurityError/SyntaxError messages. Replace that routine with a
 * read-only walk that silently skips inaccessible sheets.
 */
export function patchFontEmbedding(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('async function getCSSRules(')
  const end = code.indexOf('function getWebFontRules', start)
  if (start < 0 || end < 0 || end <= start) return { code, changed: false }

  const replacement = `async function getCSSRules(styleSheets, options) {
    void options;
    const ret = [];
    const visited = new Set();
    const visit = (sheet) => {
        if (!sheet || visited.has(sheet)) return;
        visited.add(sheet);
        let rules;
        try {
            rules = toArray(sheet.cssRules || []);
        }
        catch (error) {
            // Cross-origin stylesheets cannot be inspected. Skip them instead
            // of fetching and injecting their text into the live document.
            return;
        }
        rules.forEach((rule) => {
            try {
                if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
                    visit(rule.styleSheet);
                    return;
                }
            }
            catch (error) {
                // An inaccessible import target is not a readable font source.
            }
            ret.push(rule);
        });
    };
    styleSheets.forEach(visit);
    return ret;
}
`
  return {
    code: `${code.slice(0, start)}${replacement}${code.slice(end)}`,
    changed: true
  }
}

/**
 * html-to-image 1.11 treats an SVG `<use xlink:href>` value as a CSS selector:
 * `clone.querySelector('/sprite.svg#icon')` throws a SyntaxError. Resolve the
 * fragment id safely, reuse an in-document symbol when one exists, and fetch an
 * external sprite through the GM adapter when needed.
 */
export function patchSvgSymbols(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('async function ensureSVGSymbols(')
  const end = code.indexOf('export async function cloneNode(', start)
  if (start < 0 || end < 0 || end <= start) return { code, changed: false }

  const replacement = `async function ensureSVGSymbols(clone, options) {
    if (clone.nodeType !== 1 && clone.nodeType !== 9 && clone.nodeType !== 11) {
        return clone;
    }
    const uses = __elementScreenshotNative.querySelectorAll(clone, 'use');
    if (uses.length === 0) {
        return clone;
    }
    const processedDefs = {};
    const cache = options.__elementScreenshotSvgCache || (options.__elementScreenshotSvgCache = new Map());
    const idFrom = (value) => {
        if (!value) return '';
        const index = value.lastIndexOf('#');
        return index >= 0 ? value.slice(index + 1) : '';
    };
    const findById = (root, id) => {
        if (!root || !id) return null;
        if (root === __elementScreenshotNative.document) {
            return __elementScreenshotNative.document.getElementById(id);
        }
        const nodes = __elementScreenshotNative.querySelectorAll(root, '[id]');
        for (let index = 0; index < nodes.length; index += 1) {
            if (__elementScreenshotNative.getAttribute(nodes[index], 'id') === id) return nodes[index];
        }
        return null;
    };
    for (let i = 0; i < uses.length; i++) {
        const use = uses[i];
        const href = __elementScreenshotNative.getAttribute(use, 'href') || __elementScreenshotNative.getAttribute(use, 'xlink:href');
        const id = idFrom(href);
        if (!id) continue;
        if (findById(clone, id)) {
            __elementScreenshotNative.setAttribute(use, 'href', '#' + id);
            __elementScreenshotNative.removeAttribute(use, 'xlink:href');
            continue;
        }
        let definition = findById(__elementScreenshotNative.document, id);
        if (!definition && href && !href.startsWith('#')) {
            const base = (clone.ownerDocument && clone.ownerDocument.baseURI) || document.baseURI;
            try {
                const url = new URL(href.split('#')[0], base).href;
                let text = cache.get(url);
                if (!text) {
                    const response = await fetch(url, options.fetchRequestInit);
                    text = await response.text();
                    cache.set(url, text);
                }
                const sprite = new DOMParser().parseFromString(text, 'image/svg+xml');
                definition = findById(sprite, id);
            }
            catch (error) {
                // The icon stays unresolved; the rest of the capture continues.
            }
        }
        if (!definition || processedDefs[id]) continue;
        processedDefs[id] = __elementScreenshotNative.cloneNode(definition, true);
        __elementScreenshotNative.setAttribute(use, 'href', '#' + id);
        __elementScreenshotNative.removeAttribute(use, 'xlink:href');
    }
    const nodes = Object.values(processedDefs);
    if (nodes.length) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = __elementScreenshotNative.document.createElementNS(ns, 'svg');
        __elementScreenshotNative.setAttribute(svg, 'xmlns', ns);
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.overflow = 'hidden';
        svg.style.display = 'none';
        const defs = __elementScreenshotNative.document.createElementNS(ns, 'defs');
        __elementScreenshotNative.appendChild(svg, defs);
        for (let i = 0; i < nodes.length; i++) {
            __elementScreenshotNative.appendChild(defs, nodes[i]);
        }
        __elementScreenshotNative.appendChild(clone, svg);
    }
    return clone;
}
`
  return {
    code: `${code.slice(0, start)}${replacement}${code.slice(end)}`,
    changed: true
  }
}

/**
 * `XMLSerializer` copies HTML-only attribute names (such as `$bgcolor`) and
 * control characters into the SVG wrapper verbatim, but both are illegal in
 * XML. Serialize through the native snapshot, strip invalid attribute names and
 * sanitize the text before building the data URL.
 */
export function patchSvgSerialization(code: string): { code: string; changed: boolean } {
  const start = code.indexOf('export async function svgToDataURL(')
  const end = code.indexOf('export async function nodeToDataURL(', start)
  if (start < 0 || end < 0 || end <= start) return { code, changed: false }

  const replacement = `export async function svgToDataURL(svg) {
    return Promise.resolve()
        .then(() => __elementScreenshotNative.sanitizeSvgAttributes(svg))
        .then(() => __elementScreenshotNative.sanitizeSvgNamespaces(svg))
        .then(() => __elementScreenshotNative.serializeSvg(svg))
        .then(__elementScreenshotNative.sanitizeXmlText)
        .then(encodeURIComponent)
        .then((html) => 'data:image/svg+xml;charset=utf-8,' + html);
}
`
  return {
    code: `${code.slice(0, start)}${replacement}${code.slice(end)}`,
    changed: true
  }
}

/**
 * html-to-image reads and calls browser prototypes directly. Route its canvas
 * serialization, cloning and computed-style reads through the native snapshot
 * so a page-level prototype hook cannot intercept the capture pipeline.
 *
 * These are deliberately exact, version-pinned source substitutions. The
 * plugin only runs on the html-to-image package and the package version is
 * locked by pnpm; unrecognised output is left untouched rather than guessed.
 */
export function patchNativeCalls(code: string): { code: string; changed: boolean } {
  let next = code
  let changed = false
  const replace = (from: string, to: string): void => {
    if (!next.includes(from)) return
    next = next.split(from).join(to)
    changed = true
  }

  /*
   * html-to-image applies `backgroundColor` to the cloned root as well as to
   * the canvas. That paints over an opaque element background (a white card
   * becomes the page backdrop color). The canvas fill already handles
   * transparent regions, so keep the root's own background.
   */
  const withoutRootBackground = next.replace(
    /if \(options\.backgroundColor\) \{\s*style\.backgroundColor = options\.backgroundColor;\s*\}/g,
    '/* element-screenshot: canvas fill handles the backdrop */'
  )
  if (withoutRootBackground !== next) {
    next = withoutRootBackground
    changed = true
  }

  replace(`canvas.getContext('2d')`, '__elementScreenshotNative.canvas.getContext(canvas)')
  replace('canvas.toBlob(', '__elementScreenshotNative.canvas.toBlob(canvas, ')
  next = next.replace(/\bcanvas\.toDataURL\(([^()]*)\)/g, (_match, args: string) => {
    changed = true
    return args
      ? `__elementScreenshotNative.canvas.toDataURL(canvas, ${args})`
      : '__elementScreenshotNative.canvas.toDataURL(canvas)'
  })
  replace('context.fillRect(', '__elementScreenshotNative.canvas.fillRect(context, ')
  replace('context.drawImage(', '__elementScreenshotNative.canvas.drawImage(context, ')
  replace('ctx.getImageData(', '__elementScreenshotNative.canvas.getImageData(ctx, ')
  replace('ctx?.drawImage(', 'ctx && __elementScreenshotNative.canvas.drawImage(ctx, ')
  replace('canvas.cloneNode(false)', '__elementScreenshotNative.cloneNode(canvas, false)')
  replace('iframe.cloneNode(false)', '__elementScreenshotNative.cloneNode(iframe, false)')
  replace(
    'node.cloneNode(isSVGElement(node))',
    '__elementScreenshotNative.cloneNode(node, isSVGElement(node))'
  )
  replace(
    'new XMLSerializer().serializeToString(svg)',
    '__elementScreenshotNative.serializeSvg(svg)'
  )
  replace('win.getComputedStyle(node)', '__elementScreenshotNative.getComputedStyle(node)')
  replace(
    'toArray(node.ownerDocument.styleSheets)',
    'toArray(__elementScreenshotNative.document.styleSheets)'
  )

  return { code: next, changed }
}

export interface GmFetchPluginOptions {
  /** Module that exports `gmFetch` and `GMXMLHttpRequest`. */
  adapterModule?: string
  /** Module that exports the native snapshot used by html-to-image. */
  nativeAdapter?: string | false
  include?: (id: string) => boolean
  exclude?: (id: string) => boolean
}

const DEFAULT_INCLUDE = (id: string): boolean =>
  /[/\\]html-to-image[/\\]/.test(id) && !id.endsWith('.map') && !id.endsWith('.d.ts')

/**
 * Injects the GM-backed fetch/XHR adapter into html-to-image at build time.
 * The virtual module is resolved through the adapter alias configured in the
 * userscript's Vite config.
 */
export function gmFetchPlugin(options: GmFetchPluginOptions = {}): Plugin {
  const adapterModule = options.adapterModule ?? 'virtual:gm-fetch-adapter'
  const nativeAdapter =
    options.nativeAdapter === false ? null : (options.nativeAdapter ?? NATIVE_ADAPTER)
  const virtualId = 'virtual:gm-fetch'
  const resolvedId = `\0${virtualId}`
  const resolvedNativeId = `\0${NATIVE_VIRTUAL}`
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? (() => false)

  return {
    name: 'element-screenshot:gm-fetch',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualId) return resolvedId
      if (id === NATIVE_VIRTUAL && nativeAdapter) return resolvedNativeId
      return null
    },
    load(id) {
      if (id === resolvedId) {
        return `export { gmFetch, GMXMLHttpRequest } from '${adapterModule}';\n`
      }
      if (id === resolvedNativeId && nativeAdapter) {
        return `export { native } from '${nativeAdapter}';\n`
      }
      return null
    },
    transform(code, id) {
      if (!include(id) || exclude(id)) return null

      const patches = [
        patchFontEmbedding,
        patchSvgSymbols,
        patchImageEmbedding,
        patchCloneCanvas,
        patchCloneVideo,
        patchCreateImage,
        ...(nativeAdapter ? [patchSvgSerialization] : []),
        patchNativeCalls
      ]
      let source = code
      let changed = false
      for (const patch of patches) {
        const result = patch(source)
        if (!result.changed) continue
        source = result.code
        changed = true
      }

      const result = rewriteFetchReferences(source, {
        adapterModule: virtualId,
        sourceFile: id
      })
      if (!result.changed && !changed) {
        return nativeAdapter ? { code: `${NATIVE_PRELUDE}${code}` } : null
      }
      const transformed = result.changed ? result.code : source
      return {
        code: nativeAdapter ? `${NATIVE_PRELUDE}${transformed}` : transformed,
        map: undefined
      }
    }
  }
}
