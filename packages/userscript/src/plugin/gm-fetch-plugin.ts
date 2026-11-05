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
const NATIVE_VIRTUAL = 'virtual:element-shot-native'
const NATIVE_ADAPTER = 'virtual:element-shot-native-adapter'

const NATIVE_PRELUDE = `import { native as __elementShotNative } from '${NATIVE_VIRTUAL}';
const window = __elementShotNative.window;
const document = __elementShotNative.document;
const getComputedStyle = __elementShotNative.getComputedStyle;
const requestAnimationFrame = __elementShotNative.requestAnimationFrame;
const setTimeout = __elementShotNative.setTimeout;
const clearTimeout = __elementShotNative.clearTimeout;
const Image = __elementShotNative.Image;
const XMLSerializer = __elementShotNative.XMLSerializer;
const Blob = __elementShotNative.Blob;
const FileReader = __elementShotNative.FileReader;
const URL = __elementShotNative.URL;
const DOMParser = __elementShotNative.DOMParser;
const Element = __elementShotNative.Element;
const HTMLElement = __elementShotNative.HTMLElement;
const HTMLCanvasElement = __elementShotNative.HTMLCanvasElement;
const HTMLVideoElement = __elementShotNative.HTMLVideoElement;
const HTMLIFrameElement = __elementShotNative.HTMLIFrameElement;
const HTMLTextAreaElement = __elementShotNative.HTMLTextAreaElement;
const HTMLInputElement = __elementShotNative.HTMLInputElement;
const HTMLSelectElement = __elementShotNative.HTMLSelectElement;
const HTMLImageElement = __elementShotNative.HTMLImageElement;
const SVGImageElement = __elementShotNative.SVGImageElement;
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
    const uses = __elementShotNative.querySelectorAll(clone, 'use');
    if (uses.length === 0) {
        return clone;
    }
    const processedDefs = {};
    const cache = options.__elementShotSvgCache || (options.__elementShotSvgCache = new Map());
    const idFrom = (value) => {
        if (!value) return '';
        const index = value.lastIndexOf('#');
        return index >= 0 ? value.slice(index + 1) : '';
    };
    const findById = (root, id) => {
        if (!root || !id) return null;
        if (root === __elementShotNative.document) {
            return __elementShotNative.document.getElementById(id);
        }
        const nodes = __elementShotNative.querySelectorAll(root, '[id]');
        for (let index = 0; index < nodes.length; index += 1) {
            if (__elementShotNative.getAttribute(nodes[index], 'id') === id) return nodes[index];
        }
        return null;
    };
    for (let i = 0; i < uses.length; i++) {
        const use = uses[i];
        const href = __elementShotNative.getAttribute(use, 'href') || __elementShotNative.getAttribute(use, 'xlink:href');
        const id = idFrom(href);
        if (!id) continue;
        if (findById(clone, id)) {
            __elementShotNative.setAttribute(use, 'href', '#' + id);
            __elementShotNative.removeAttribute(use, 'xlink:href');
            continue;
        }
        let definition = findById(__elementShotNative.document, id);
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
        processedDefs[id] = __elementShotNative.cloneNode(definition, true);
        __elementShotNative.setAttribute(use, 'href', '#' + id);
        __elementShotNative.removeAttribute(use, 'xlink:href');
    }
    const nodes = Object.values(processedDefs);
    if (nodes.length) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = __elementShotNative.document.createElementNS(ns, 'svg');
        __elementShotNative.setAttribute(svg, 'xmlns', ns);
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.overflow = 'hidden';
        svg.style.display = 'none';
        const defs = __elementShotNative.document.createElementNS(ns, 'defs');
        __elementShotNative.appendChild(svg, defs);
        for (let i = 0; i < nodes.length; i++) {
            __elementShotNative.appendChild(defs, nodes[i]);
        }
        __elementShotNative.appendChild(clone, svg);
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
    '/* element-shot: canvas fill handles the backdrop */'
  )
  if (withoutRootBackground !== next) {
    next = withoutRootBackground
    changed = true
  }

  replace(`canvas.getContext('2d')`, '__elementShotNative.canvas.getContext(canvas)')
  replace('canvas.toBlob(', '__elementShotNative.canvas.toBlob(canvas, ')
  next = next.replace(/\bcanvas\.toDataURL\(([^()]*)\)/g, (_match, args: string) => {
    changed = true
    return args
      ? `__elementShotNative.canvas.toDataURL(canvas, ${args})`
      : '__elementShotNative.canvas.toDataURL(canvas)'
  })
  replace('context.fillRect(', '__elementShotNative.canvas.fillRect(context, ')
  replace('context.drawImage(', '__elementShotNative.canvas.drawImage(context, ')
  replace('ctx.getImageData(', '__elementShotNative.canvas.getImageData(ctx, ')
  replace('ctx?.drawImage(', 'ctx && __elementShotNative.canvas.drawImage(ctx, ')
  replace('canvas.cloneNode(false)', '__elementShotNative.cloneNode(canvas, false)')
  replace('iframe.cloneNode(false)', '__elementShotNative.cloneNode(iframe, false)')
  replace(
    'node.cloneNode(isSVGElement(node))',
    '__elementShotNative.cloneNode(node, isSVGElement(node))'
  )
  replace('new XMLSerializer().serializeToString(svg)', '__elementShotNative.serializeSvg(svg)')
  replace('win.getComputedStyle(node)', '__elementShotNative.getComputedStyle(node)')
  replace(
    'toArray(node.ownerDocument.styleSheets)',
    'toArray(__elementShotNative.document.styleSheets)'
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
    name: 'element-shot:gm-fetch',
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
      const fontPatch = patchFontEmbedding(code)
      const svgPatch = patchSvgSymbols(fontPatch.changed ? fontPatch.code : code)
      const nativePatch = patchNativeCalls(
        svgPatch.changed ? svgPatch.code : fontPatch.changed ? fontPatch.code : code
      )
      const source = nativePatch.changed
        ? nativePatch.code
        : svgPatch.changed
          ? svgPatch.code
          : fontPatch.changed
            ? fontPatch.code
            : code
      const result = rewriteFetchReferences(source, {
        adapterModule: virtualId,
        sourceFile: id
      })
      if (!result.changed && !fontPatch.changed && !svgPatch.changed && !nativePatch.changed) {
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
