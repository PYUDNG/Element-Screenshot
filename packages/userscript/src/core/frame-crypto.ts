import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { expand, extract } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Sealing for everything the frame bridge sends.
 *
 * The bridge has one secret: a 32-byte key both realms read from the userscript
 * manager's storage. Page scripts cannot read that storage, so the key never
 * crosses into a page — only sealed boxes do. A message that opens therefore
 * proves it came from this install, and a page can neither read what it seals nor
 * forge one.
 *
 * XChaCha20-Poly1305 rather than WebCrypto: `crypto.subtle` is missing outside a
 * secure context, and a bridge that quietly falls back to plaintext on `http://`
 * pages is a bridge with a downgrade path. This runs everywhere, synchronously,
 * with a 24-byte random nonce (safe to generate at random) and a Poly1305 tag.
 *
 * `aad` binds a box to the message it belongs to — the protocol string, the
 * message type and its direction — so a box cannot be re-labelled: a `hover`
 * sealed for one type will not open as a `result`.
 */

/** Bytes of the shared key. */
export const FRAME_KEY_BYTES = 32
/** Nonce length XChaCha20-Poly1305 expects; stored in front of the ciphertext. */
const NONCE_BYTES = 24
/** Two random secrets must never derive the same key, so the derivation is fixed. */
const KEY_SALT = 'element-screenshot:frame-key/1'
const KEY_INFO = 'aead'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    if (!Number.isInteger(value) || value < 0 || value > 255) return null
    bytes[index] = value
  }
  return bytes
}

/** A fresh key for one install, hex encoded so the manager stores plain text. */
export function createFrameKey(): string {
  return toHex(randomBytes(FRAME_KEY_BYTES))
}

/**
 * Turn the stored key into the AEAD key.
 *
 * HKDF keeps the storage value and the used key separate: if a stored value ever
 * leaks (a manager that copies its database somewhere), knowing it is one thing,
 * but every message derived from it would still not be forgeable without the
 * derivation. The salt also means a key from another script of ours cannot be
 * reused here.
 */
export function deriveFrameKey(secret: string): Uint8Array | null {
  const ikm = fromHex(secret)
  if (!ikm || ikm.length !== FRAME_KEY_BYTES) return null
  const prk = extract(sha256, ikm, encoder.encode(KEY_SALT))
  return expand(sha256, prk, encoder.encode(KEY_INFO), FRAME_KEY_BYTES)
}

/** Whether a stored value looks like a key this module can use. */
export function isFrameKey(value: unknown): value is string {
  return typeof value === 'string' && value.length === FRAME_KEY_BYTES * 2 && fromHex(value) !== null
}

/**
 * Seal one message.
 *
 * The box is `nonce ‖ ciphertext ‖ tag`; the nonce is fresh every time, which is
 * what lets both small control messages and the occasional multi-megabyte frame
 * picture use the same key without bookkeeping.
 */
export function seal(key: Uint8Array, aad: string, plain: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = xchacha20poly1305(key, nonce, encoder.encode(aad))
  const sealed = cipher.encrypt(plain)
  const box = new Uint8Array(nonce.length + sealed.length)
  box.set(nonce)
  box.set(sealed, nonce.length)
  return box
}

/**
 * Open one message, or return null.
 *
 * Every failure — wrong key, tampered ciphertext, a box re-labelled with another
 * message type — is the same answer, so a page learns nothing from probing.
 */
export function open(key: Uint8Array, aad: string, box: Uint8Array): Uint8Array | null {
  if (box.length <= NONCE_BYTES) return null
  const nonce = box.subarray(0, NONCE_BYTES)
  const sealed = box.subarray(NONCE_BYTES)
  try {
    const cipher = xchacha20poly1305(key, nonce, encoder.encode(aad))
    return cipher.decrypt(sealed)
  } catch (_error) {
    return null
  }
}

/**
 * Pack a JSON header and an optional binary tail into the bytes that get sealed.
 *
 * Frame pictures travel as bytes instead of base64: a 5 MB PNG would grow by a
 * third and be copied again, and the sealed box already carries raw bytes just as
 * well.
 */
export function encodePayload(meta: unknown, binary?: Uint8Array | null): Uint8Array {
  const head = encoder.encode(JSON.stringify(meta))
  const tail = binary ?? new Uint8Array(0)
  const payload = new Uint8Array(4 + head.length + tail.length)
  new DataView(payload.buffer).setUint32(0, head.length)
  payload.set(head, 4)
  payload.set(tail, 4 + head.length)
  return payload
}

export interface DecodedPayload {
  meta: unknown
  binary: Uint8Array | null
}

/** Read back what `encodePayload` wrote; null when the bytes are not shaped that way. */
export function decodePayload(payload: Uint8Array): DecodedPayload | null {
  if (payload.length < 4) return null
  const headLength = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0)
  if (headLength > payload.length - 4) return null
  let meta: unknown
  try {
    meta = JSON.parse(decoder.decode(payload.subarray(4, 4 + headLength)))
  } catch (_error) {
    return null
  }
  const tail = payload.subarray(4 + headLength)
  return { meta, binary: tail.length > 0 ? tail : null }
}

/** A random identifier (session, frame hop) as hex. */
export function randomId(bytes = 8): string {
  return toHex(randomBytes(bytes))
}

/**
 * What one receiver has seen, so a sealed message cannot be replayed.
 *
 * A page cannot read a response to a replayed request, but replaying a `render`
 * still costs a full render, and replaying a `trigger` still opens the picker.
 * Sequence numbers are minted by the sender and travel inside the sealed header:
 * a page can copy a message but cannot advance its number.
 *
 * Out-of-order arrivals are normal (parallel frame renders), so this remembers a
 * set per sender instead of one high-water mark; the set is capped and simply
 * forgets the oldest entries.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, Set<number>>()
  private readonly limit: number

  constructor(limit = 512) {
    this.limit = limit
  }

  /** True the first time this `seq` arrives from `from` for this `type`. */
  accept(from: string, type: string, seq: number): boolean {
    if (!Number.isInteger(seq) || seq < 1) return false
    const key = `${from}|${type}`
    let set = this.seen.get(key)
    if (!set) {
      set = new Set()
      this.seen.set(key, set)
    }
    if (set.has(seq)) return false
    set.add(seq)
    if (set.size > this.limit) {
      const oldest = set.values().next()
      if (!oldest.done) set.delete(oldest.value)
    }
    return true
  }

  /** Forget one sender (a frame that went away). */
  forget(from: string): void {
    for (const key of this.seen.keys()) {
      if (key.startsWith(`${from}|`)) this.seen.delete(key)
    }
  }
}
