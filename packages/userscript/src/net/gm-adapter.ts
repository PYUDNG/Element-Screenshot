import { GM_xmlhttpRequest } from '$'
import { createGMFetch, createGMXHRClass } from './gm-fetch'
import type { GMRequest } from './gm-fetch'

const request = GM_xmlhttpRequest as unknown as GMRequest

export const gmFetch = createGMFetch({ request })
export const GMXMLHttpRequest = createGMXHRClass(request)
