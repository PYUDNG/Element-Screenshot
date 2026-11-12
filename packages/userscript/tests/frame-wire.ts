import { FRAME_PROTOCOL, frameAad } from '../src/core/frame-bridge'
import type { FrameEnvelope, FrameMessageType } from '../src/core/frame-bridge'
import { deriveFrameKey, encodePayload, seal } from '../src/core/frame-crypto'

/**
 * Build bridge messages the way another endpoint of the same install would.
 *
 * Tests seal with the key they gave `setFrameKey`, but with their own sender id:
 * that keeps "addressed to me" a real check instead of comparing a session id
 * with itself, and it lets one test speak as a frame while another speaks as the
 * parent. The layout here is deliberately written out rather than taken from the
 * module under test, so a change to the wire format breaks these tests loudly.
 */

/** The secret every bridge test installs into the module under test. */
export const TEST_KEY = '11'.repeat(32)
/** A second install, for the "wrong key" cases. */
export const OTHER_KEY = '22'.repeat(32)

let counter = 0

export interface WireOptions {
  /** Sender's session id. */
  sid?: string
  /** Receiver's session id; empty means a handshake. */
  to?: string
  seq?: number
  nonce?: string
  binary?: Uint8Array
}

/** Seal one message with the given install secret. */
export function wireWith(
  secret: string,
  type: FrameMessageType,
  data: Record<string, unknown> = {},
  options: WireOptions = {}
): FrameEnvelope {
  counter += 1
  const key = deriveFrameKey(secret)
  if (!key) throw new Error('the test key is invalid')
  const header = {
    sid: options.sid ?? 'frame-test',
    to: options.to ?? '',
    seq: options.seq ?? counter,
    nonce: options.nonce ?? `wire-${counter}`
  }
  return {
    protocol: FRAME_PROTOCOL,
    type,
    box: seal(key, frameAad(type), encodePayload({ ...data, ...header }, options.binary ?? null))
  }
}

/** Seal one message as this install. */
export function wire(
  type: FrameMessageType,
  data: Record<string, unknown> = {},
  options: WireOptions = {}
): FrameEnvelope {
  return wireWith(TEST_KEY, type, data, options)
}

/** Dispatch one message event into this window. */
export function deliver(data: unknown, source: unknown = window): MessageEvent {
  const event = new MessageEvent('message', {
    data,
    source: source as never,
    origin: 'http://localhost:4176'
  })
  window.dispatchEvent(event)
  return event
}

/** Bytes a test can compare without decoding a picture. */
export function pngBytes(text = 'png'): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Read what a test replied, as text. */
export async function blobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
}
