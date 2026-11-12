import { describe, expect, it } from 'vitest'
import {
  FRAME_KEY_BYTES,
  ReplayGuard,
  createFrameKey,
  decodePayload,
  deriveFrameKey,
  encodePayload,
  isFrameKey,
  open,
  randomId,
  seal
} from '../src/core/frame-crypto'

function keyFrom(secret = createFrameKey()): Uint8Array {
  const key = deriveFrameKey(secret)
  if (!key) throw new Error('the test key should derive')
  return key
}

function bytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) out[index] = (index * seed + 13) % 256
  return out
}

describe('frame key', () => {
  it('mints a 32-byte key as hex, different every time', () => {
    const first = createFrameKey()
    const second = createFrameKey()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(isFrameKey(first)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('rejects anything that is not a stored key', () => {
    expect(isFrameKey('')).toBe(false)
    expect(isFrameKey('zz')).toBe(false)
    expect(isFrameKey('ab'.repeat(FRAME_KEY_BYTES))).toBe(true)
    expect(isFrameKey(42)).toBe(false)
  })

  it('derives the same key from the same secret, and nothing from a bad one', () => {
    const secret = createFrameKey()
    expect(deriveFrameKey(secret)).toEqual(deriveFrameKey(secret))
    expect(deriveFrameKey(secret)).toHaveLength(FRAME_KEY_BYTES)
    expect(deriveFrameKey('')).toBeNull()
    expect(deriveFrameKey('ab'.repeat(FRAME_KEY_BYTES + 1))).toBeNull()
    expect(deriveFrameKey('not-hex')).toBeNull()
  })
})

describe('sealing', () => {
  it('round-trips a header and a binary tail', () => {
    const key = keyFrom()
    const payload = encodePayload({ type: 'result', size: 3 }, bytes(3))
    const box = seal(key, 'protocol|result|down', payload)

    const opened = open(key, 'protocol|result|down', box)
    expect(opened).not.toBeNull()
    const decoded = decodePayload(opened as Uint8Array)
    expect(decoded?.meta).toEqual({ type: 'result', size: 3 })
    expect(Array.from(decoded?.binary ?? [])).toEqual(Array.from(bytes(3)))
  })

  it('uses a fresh nonce per box', () => {
    const key = keyFrom()
    const a = seal(key, 'aad', bytes(4))
    const b = seal(key, 'aad', bytes(4))
    expect(Array.from(a.subarray(0, 24))).not.toEqual(Array.from(b.subarray(0, 24)))
    expect(Array.from(a.subarray(24))).not.toEqual(Array.from(b.subarray(24)))
  })

  it('refuses a tampered box, a wrong key and a re-labelled message', () => {
    const key = keyFrom()
    const box = seal(key, 'protocol|hover|down', bytes(16))

    const tampered = box.slice()
    const last = tampered.length - 1
    tampered[last] = (tampered[last] ?? 0) ^ 0xff
    expect(open(key, 'protocol|hover|down', tampered)).toBeNull()

    expect(open(keyFrom(), 'protocol|hover|down', box)).toBeNull()
    // A box sealed for one message type must not open as another: this is what
    // keeps a page from feeding a request into the response handler.
    expect(open(key, 'protocol|result|down', box)).toBeNull()
    expect(open(key, 'protocol|hover|up', box)).toBeNull()
  })

  it('refuses a truncated or empty box', () => {
    const key = keyFrom()
    expect(open(key, 'aad', new Uint8Array(0))).toBeNull()
    expect(open(key, 'aad', bytes(10))).toBeNull()
  })

  it('carries a frame picture without base64', () => {
    const key = keyFrom()
    const png = bytes(512 * 1024, 11)
    const box = seal(key, 'protocol|captured|up', encodePayload({ type: 'captured' }, png))
    const decoded = decodePayload(open(key, 'protocol|captured|up', box) as Uint8Array)
    expect(decoded?.binary).toHaveLength(png.length)
    expect(decoded?.binary?.[12345]).toBe(png[12345])
  })
})

describe('payload layout', () => {
  it('round-trips a header with no tail', () => {
    const decoded = decodePayload(encodePayload({ type: 'ui', active: true }))
    expect(decoded?.meta).toEqual({ type: 'ui', active: true })
    expect(decoded?.binary).toBeNull()
  })

  it('rejects bytes that are not shaped like a payload', () => {
    expect(decodePayload(new Uint8Array(0))).toBeNull()
    expect(decodePayload(new Uint8Array(2))).toBeNull()
    // A header length past the end of the buffer.
    const lying = new Uint8Array(8)
    new DataView(lying.buffer).setUint32(0, 200)
    expect(decodePayload(lying)).toBeNull()
    // A header that is not JSON.
    const broken = new Uint8Array(4 + 3)
    new DataView(broken.buffer).setUint32(0, 3)
    broken.set([0x7b, 0x7b, 0x7b], 4)
    expect(decodePayload(broken)).toBeNull()
  })
})

describe('replay guard', () => {
  it('accepts a sequence once per sender and type', () => {
    const guard = new ReplayGuard()
    expect(guard.accept('frame-a', 'render', 1)).toBe(true)
    expect(guard.accept('frame-a', 'render', 1)).toBe(false)
    // Another type from the same sender is a different stream.
    expect(guard.accept('frame-a', 'hover', 1)).toBe(true)
    // Another sender starts its own numbering.
    expect(guard.accept('frame-b', 'render', 1)).toBe(true)
    // Out-of-order arrivals are fine.
    expect(guard.accept('frame-a', 'render', 3)).toBe(true)
    expect(guard.accept('frame-a', 'render', 2)).toBe(true)
  })

  it('rejects nonsense sequence numbers', () => {
    const guard = new ReplayGuard()
    expect(guard.accept('frame-a', 'render', 0)).toBe(false)
    expect(guard.accept('frame-a', 'render', -1)).toBe(false)
    expect(guard.accept('frame-a', 'render', 1.5)).toBe(false)
  })

  it('forgets the oldest entries instead of growing forever', () => {
    const guard = new ReplayGuard(4)
    for (let seq = 1; seq <= 10; seq += 1) expect(guard.accept('frame-a', 'render', seq)).toBe(true)
    // The first numbers fell out of the window, so they look new again; the point
    // is that the guard is bounded, not that it remembers everything.
    expect(guard.accept('frame-a', 'render', 10)).toBe(false)
  })

  it('forgets a sender on demand', () => {
    const guard = new ReplayGuard()
    guard.accept('frame-a', 'render', 1)
    guard.forget('frame-a')
    expect(guard.accept('frame-a', 'render', 1)).toBe(true)
  })
})

describe('random ids', () => {
  it('is hex of the requested length and not repeated', () => {
    const first = randomId()
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(first).not.toBe(randomId())
    expect(randomId(4)).toHaveLength(8)
  })
})
