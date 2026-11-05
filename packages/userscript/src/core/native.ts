import { isValidXmlName, sanitizeXmlText } from './xml'

type AnyMethod = (...args: never[]) => unknown
type BrowserWindow = Window & typeof globalThis

export interface NativeDocument {
  readonly documentElement: HTMLElement | null
  readonly body: HTMLElement | null
  readonly baseURI: string
  readonly styleSheets: StyleSheetList
  readonly implementation: {
    createHTMLDocument(title?: string): Document
  }
  createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions
  ): HTMLElementTagNameMap[K]
  createElementNS(namespaceURI: string | null, qualifiedName: string): Element
  createTextNode(data: string): Text
  querySelector<E extends Element = Element>(selectors: string): E | null
  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E>
  getElementById(elementId: string): HTMLElement | null
}

export interface NativeWindow {
  readonly getComputedStyle: (
    element: Element,
    pseudoElement?: string | null
  ) => CSSStyleDeclaration
  readonly location: Location
  readonly devicePixelRatio: number
  readonly atob: (data: string) => string
}

export interface NativeCanvas {
  getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null
  toBlob(canvas: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number): void
  toDataURL(canvas: HTMLCanvasElement, type?: string, quality?: number): string
  fillRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): void
  drawImage(context: CanvasRenderingContext2D, image: CanvasImageSource, ...args: number[]): void
  getImageData(
    context: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    sw: number,
    sh: number
  ): ImageData
}

export interface NativeSnapshot {
  readonly window: NativeWindow
  readonly document: NativeDocument
  readonly getComputedStyle: NativeWindow['getComputedStyle']
  readonly getBoundingClientRect: (element: Element) => DOMRect
  readonly elementsFromPoint: (root: Document | ShadowRoot, x: number, y: number) => Element[]
  readonly cloneNode: <T extends Node>(node: T, deep?: boolean) => T
  readonly querySelector: <E extends Element = Element>(
    root: ParentNode,
    selectors: string
  ) => E | null
  readonly querySelectorAll: <E extends Element = Element>(
    root: ParentNode,
    selectors: string
  ) => NodeListOf<E>
  readonly getAttribute: (element: Element, name: string) => string | null
  readonly setAttribute: (element: Element, name: string, value: string) => void
  readonly removeAttribute: (element: Element, name: string) => void
  readonly appendChild: <T extends Node>(parent: Node, child: T) => T
  readonly addEventListener: (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | ((...args: never[]) => void) | null,
    options?: boolean | AddEventListenerOptions
  ) => void
  readonly removeEventListener: (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | ((...args: never[]) => void) | null,
    options?: boolean | EventListenerOptions
  ) => void
  readonly click: (element: HTMLElement) => void
  readonly createImage: () => HTMLImageElement
  readonly serializeSvg: (node: Node) => string
  readonly sanitizeXmlText: (value: string) => string
  readonly sanitizeSvgAttributes: (root: Element) => number
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number
  readonly cancelAnimationFrame: (handle: number) => void
  readonly setTimeout: (handler: TimerHandler, timeout?: number) => number
  readonly clearTimeout: (handle: number) => void
  readonly Image: typeof Image
  readonly XMLSerializer: typeof XMLSerializer
  readonly Blob: typeof Blob
  readonly FileReader: typeof FileReader
  readonly URL: typeof URL
  readonly DOMParser: typeof DOMParser
  readonly Element: typeof Element
  readonly HTMLElement: typeof HTMLElement
  readonly HTMLCanvasElement: typeof HTMLCanvasElement
  readonly HTMLVideoElement: typeof HTMLVideoElement
  readonly HTMLIFrameElement: typeof HTMLIFrameElement
  readonly HTMLTextAreaElement: typeof HTMLTextAreaElement
  readonly HTMLInputElement: typeof HTMLInputElement
  readonly HTMLSelectElement: typeof HTMLSelectElement
  readonly HTMLImageElement: typeof HTMLImageElement
  readonly SVGImageElement: typeof SVGImageElement | undefined
  readonly canvas: NativeCanvas
  readonly isSecureContext: boolean
  readonly devicePixelRatio: number
  readonly createObjectURL: ((blob: Blob) => string) | null
  readonly revokeObjectURL: ((url: string) => void) | null
}

function call<T>(method: AnyMethod | undefined, receiver: unknown, args: unknown[]): T {
  if (typeof method !== 'function') {
    throw new TypeError('[element-shot] native API is unavailable')
  }
  return Reflect.apply(method, receiver, args) as T
}

function getter(
  prototype: object | undefined,
  property: string
): ((this: unknown) => unknown) | undefined {
  if (!prototype) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property)
  return descriptor?.get
}

/**
 * Capture the browser capabilities used by the capture path before page
 * scripts can replace them. This is not a clean realm: page CSS, DOM
 * mutations and rendering still belong to the page. It does keep the common
 * monkey-patching targets (computed styles, cloning, selectors, canvas
 * serialization) on their original implementations.
 */
export function createNativeSnapshot(win: BrowserWindow = window): NativeSnapshot {
  const doc = win.document
  const documentProto = win.Document.prototype
  const elementProto = win.Element.prototype
  const nodeProto = win.Node.prototype
  const fragmentProto = win.DocumentFragment.prototype
  const canvasProto = win.HTMLCanvasElement.prototype
  const contextProto = win.CanvasRenderingContext2D?.prototype
  const serializerProto = win.XMLSerializer?.prototype

  const getComputedStyle = win.getComputedStyle.bind(win)
  const getBoundingClientRect = elementProto.getBoundingClientRect
  const cloneNodeMethod = nodeProto.cloneNode
  const appendChildMethod = nodeProto.appendChild
  const getAttributeMethod = elementProto.getAttribute
  const getAttributeNamesMethod = elementProto.getAttributeNames
  const setAttributeMethod = elementProto.setAttribute
  const removeAttributeMethod = elementProto.removeAttribute
  const elementQuerySelector = elementProto.querySelector
  const elementQuerySelectorAll = elementProto.querySelectorAll
  const documentQuerySelector = documentProto.querySelector
  const documentQuerySelectorAll = documentProto.querySelectorAll
  const fragmentQuerySelector = fragmentProto.querySelector
  const fragmentQuerySelectorAll = fragmentProto.querySelectorAll
  const documentGetElementById = documentProto.getElementById
  const documentCreateElement = documentProto.createElement
  const documentCreateElementNS = documentProto.createElementNS
  const documentCreateTextNode = documentProto.createTextNode
  const documentElementsFromPoint = documentProto.elementsFromPoint
  const shadowElementsFromPoint = getter(win.ShadowRoot?.prototype, 'elementsFromPoint')
  const documentStyleSheets = getter(documentProto, 'styleSheets')
  const documentElement = getter(documentProto, 'documentElement')
  const documentBody = getter(documentProto, 'body')
  const documentBaseURI = getter(documentProto, 'baseURI')
  const addEventListenerMethod = win.EventTarget.prototype.addEventListener
  const removeEventListenerMethod = win.EventTarget.prototype.removeEventListener
  const clickMethod = win.HTMLElement.prototype.click
  const canvasGetContext = canvasProto.getContext
  const canvasToBlob = canvasProto.toBlob as
    | ((this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) => void)
    | undefined
  const canvasToDataURL = canvasProto.toDataURL
  const contextFillRect = contextProto?.fillRect
  const contextDrawImage = contextProto?.drawImage
  const contextGetImageData = contextProto?.getImageData
  const serializeToString = serializerProto?.serializeToString

  const implementation = doc.implementation
  const createHTMLDocument = win.DOMImplementation.prototype.createHTMLDocument
  const ImageCtor = win.Image
  const XMLSerializerCtor = win.XMLSerializer
  const BlobCtor = win.Blob
  const FileReaderCtor = win.FileReader
  const URLCtor = win.URL
  const DOMParserCtor = win.DOMParser
  const SVGImageElementCtor = win.SVGImageElement

  const querySelector = <E extends Element = Element>(
    root: ParentNode,
    selectors: string
  ): E | null => {
    const method =
      root.nodeType === 9
        ? documentQuerySelector
        : root.nodeType === 11
          ? fragmentQuerySelector
          : elementQuerySelector
    return call<E | null>(method as unknown as AnyMethod, root, [selectors])
  }

  const querySelectorAll = <E extends Element = Element>(
    root: ParentNode,
    selectors: string
  ): NodeListOf<E> => {
    const method =
      root.nodeType === 9
        ? documentQuerySelectorAll
        : root.nodeType === 11
          ? fragmentQuerySelectorAll
          : elementQuerySelectorAll
    return call<NodeListOf<E>>(method as unknown as AnyMethod, root, [selectors])
  }

  const nativeDocument: NativeDocument = {
    get documentElement() {
      return documentElement
        ? (documentElement.call(doc) as HTMLElement | null)
        : doc.documentElement
    },
    get body() {
      return documentBody ? (documentBody.call(doc) as HTMLElement | null) : doc.body
    },
    get baseURI() {
      return documentBaseURI ? (documentBaseURI.call(doc) as string) : doc.baseURI
    },
    get styleSheets() {
      return documentStyleSheets
        ? (documentStyleSheets.call(doc) as StyleSheetList)
        : doc.styleSheets
    },
    get implementation() {
      return {
        createHTMLDocument: (title?: string) =>
          call<Document>(createHTMLDocument as unknown as AnyMethod, implementation, [title])
      }
    },
    createElement: <K extends keyof HTMLElementTagNameMap>(
      tagName: K,
      options?: ElementCreationOptions
    ) =>
      call<HTMLElementTagNameMap[K]>(documentCreateElement as unknown as AnyMethod, doc, [
        tagName,
        options
      ]),
    createElementNS: (namespaceURI, qualifiedName) =>
      call<Element>(documentCreateElementNS as unknown as AnyMethod, doc, [
        namespaceURI,
        qualifiedName
      ]),
    createTextNode: (data) =>
      call<Text>(documentCreateTextNode as unknown as AnyMethod, doc, [data]),
    querySelector: <E extends Element = Element>(selectors: string) =>
      querySelector<E>(doc, selectors),
    querySelectorAll: <E extends Element = Element>(selectors: string) =>
      querySelectorAll<E>(doc, selectors),
    getElementById: (elementId) =>
      call<HTMLElement | null>(documentGetElementById as unknown as AnyMethod, doc, [elementId])
  }

  const nativeWindow: NativeWindow = {
    getComputedStyle,
    location: win.location,
    devicePixelRatio: win.devicePixelRatio,
    atob: win.atob.bind(win)
  }

  const nativeCanvas: NativeCanvas = {
    getContext: (canvas) => {
      if (!canvasGetContext) return null
      return canvasGetContext.call(canvas, '2d') as CanvasRenderingContext2D | null
    },
    toBlob: (canvas, callback, type, quality) => {
      if (!canvasToBlob) {
        throw new TypeError('[element-shot] canvas.toBlob is unavailable')
      }
      canvasToBlob.call(canvas, callback, type, quality)
    },
    toDataURL: (canvas, type, quality) => {
      return canvasToDataURL.call(canvas, type, quality)
    },
    fillRect: (context, x, y, width, height) => {
      call<void>(contextFillRect as unknown as AnyMethod, context, [x, y, width, height])
    },
    drawImage: (context, image, ...args) => {
      call<void>(contextDrawImage as unknown as AnyMethod, context, [image, ...args])
    },
    getImageData: (context, sx, sy, sw, sh) =>
      call<ImageData>(contextGetImageData as unknown as AnyMethod, context, [sx, sy, sw, sh])
  }

  return {
    window: nativeWindow,
    document: nativeDocument,
    getComputedStyle,
    getBoundingClientRect: (element) => getBoundingClientRect.call(element),
    elementsFromPoint: (root, x, y) => {
      const method =
        root.nodeType === 11 && shadowElementsFromPoint
          ? shadowElementsFromPoint
          : documentElementsFromPoint
      const result = call<Element[]>(
        (method ?? root.elementsFromPoint) as unknown as AnyMethod,
        root,
        [x, y]
      )
      return Array.from(result)
    },
    cloneNode: <T extends Node>(node: T, deep = false): T =>
      call<T>(cloneNodeMethod as unknown as AnyMethod, node, [deep]),
    querySelector,
    querySelectorAll,
    getAttribute: (element, name) =>
      call<string | null>(getAttributeMethod as unknown as AnyMethod, element, [name]),
    setAttribute: (element, name, value) => {
      call<void>(setAttributeMethod as unknown as AnyMethod, element, [name, value])
    },
    removeAttribute: (element, name) => {
      call<void>(removeAttributeMethod as unknown as AnyMethod, element, [name])
    },
    appendChild: <T extends Node>(parent: Node, child: T): T =>
      call<T>(appendChildMethod as unknown as AnyMethod, parent, [child]),
    addEventListener: (target, type, listener, options) => {
      try {
        call<void>(addEventListenerMethod as unknown as AnyMethod, target, [
          type,
          listener,
          options
        ])
      } catch {
        target.addEventListener(type, listener as EventListener, options)
      }
    },
    removeEventListener: (target, type, listener, options) => {
      try {
        call<void>(removeEventListenerMethod as unknown as AnyMethod, target, [
          type,
          listener,
          options
        ])
      } catch {
        target.removeEventListener(type, listener as EventListener, options)
      }
    },
    click: (element) => {
      call<void>(clickMethod as unknown as AnyMethod, element, [])
    },
    createImage: () => new ImageCtor(),
    serializeSvg: (node) =>
      call<string>(serializeToString as unknown as AnyMethod, new XMLSerializerCtor(), [node]),
    sanitizeXmlText,
    sanitizeSvgAttributes: (root) => {
      let removed = 0
      const elements = [root, ...Array.from(querySelectorAll(root, '*'))]
      for (const element of elements) {
        const names = call<string[]>(getAttributeNamesMethod as unknown as AnyMethod, element, [])
        for (const name of names) {
          if (isValidXmlName(name)) continue
          call<void>(removeAttributeMethod as unknown as AnyMethod, element, [name])
          removed += 1
        }
      }
      return removed
    },
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    setTimeout: win.setTimeout.bind(win),
    clearTimeout: win.clearTimeout.bind(win),
    Image: ImageCtor,
    XMLSerializer: XMLSerializerCtor,
    Blob: BlobCtor,
    FileReader: FileReaderCtor,
    URL: URLCtor,
    DOMParser: DOMParserCtor,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    HTMLCanvasElement: win.HTMLCanvasElement,
    HTMLVideoElement: win.HTMLVideoElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLSelectElement: win.HTMLSelectElement,
    HTMLImageElement: win.HTMLImageElement,
    SVGImageElement: SVGImageElementCtor,
    canvas: nativeCanvas,
    isSecureContext: win.isSecureContext,
    devicePixelRatio: win.devicePixelRatio,
    createObjectURL: URLCtor.createObjectURL?.bind(URLCtor) ?? null,
    revokeObjectURL: URLCtor.revokeObjectURL?.bind(URLCtor) ?? null
  }
}

export const native = createNativeSnapshot()
