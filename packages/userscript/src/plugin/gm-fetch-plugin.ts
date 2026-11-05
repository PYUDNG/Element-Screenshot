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

export interface GmFetchPluginOptions {
  /** Module that exports `gmFetch` and `GMXMLHttpRequest`. */
  adapterModule?: string
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
  const virtualId = 'virtual:gm-fetch'
  const resolvedId = `\0${virtualId}`
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? (() => false)

  return {
    name: 'element-shot:gm-fetch',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualId) return resolvedId
      return null
    },
    load(id) {
      if (id === resolvedId) {
        return `export { gmFetch, GMXMLHttpRequest } from '${adapterModule}';\n`
      }
      return null
    },
    transform(code, id) {
      if (!include(id) || exclude(id)) return null
      const result = rewriteFetchReferences(code, {
        adapterModule: virtualId,
        sourceFile: id
      })
      if (!result.changed) return null
      return { code: result.code, map: result.map }
    }
  }
}
