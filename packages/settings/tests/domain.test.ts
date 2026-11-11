import { describe, expect, it, vi } from 'vitest'
import { createDomain } from '../src/domain'
import type { DomainStep, DomainValueStorage } from '../src/domain'

/**
 * Mimics a userscript manager: both strings and objects survive a JSON
 * round-trip, which is the contract the envelope relies on. Storing references
 * here would hide bugs where the domain assumes the value it wrote is the value
 * it reads back.
 */
function createStorage(initial: Record<string, unknown> = {}): {
  api: DomainValueStorage
  writes: Array<{ key: string; value: unknown }>
  read: (key: string) => unknown
  has: (key: string) => boolean
} {
  const stored = new Map<string, string>()
  for (const [key, value] of Object.entries(initial)) stored.set(key, JSON.stringify(value))
  const writes: Array<{ key: string; value: unknown }> = []
  const api: DomainValueStorage = {
    getValue(key) {
      const raw = stored.get(key)
      return raw === undefined ? null : JSON.parse(raw)
    },
    setValue(key, value) {
      stored.set(key, JSON.stringify(value))
      writes.push({ key, value })
    },
    deleteValue(key) {
      stored.delete(key)
    }
  }
  return {
    api,
    writes,
    read: (key) => (stored.has(key) ? JSON.parse(stored.get(key) as string) : undefined),
    has: (key) => stored.has(key)
  }
}

const append: DomainStep[] = [
  { id: 1, run: (value) => `${value}a` },
  { id: 2, run: (value) => `${value}b` }
]

describe('versioned settings domain', () => {
  it('stores nothing and reports the newest generation for an empty domain', () => {
    const storage = createStorage()
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    expect(domain.version).toBe(2)
    expect(domain.value).toBeNull()
    expect(storage.writes).toHaveLength(0)
    expect(domain.storage.getItem('settings')).toBeNull()
  })

  it('wraps a legacy payload and records the newest generation', () => {
    const storage = createStorage({ settings: 'x' })
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    expect(domain.version).toBe(2)
    expect(domain.value).toBe('xab')
    expect(storage.read('settings')).toEqual({ version: 2, value: 'xab' })
    expect(storage.writes).toHaveLength(1)
  })

  it('leaves an envelope at the current generation alone', () => {
    const storage = createStorage({ settings: { version: 2, value: 'done' } })
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    expect(domain.version).toBe(2)
    expect(domain.value).toBe('done')
    expect(storage.writes).toHaveLength(0)
  })

  it('runs only the steps above the stored generation', () => {
    const storage = createStorage({ settings: { version: 1, value: 'x' } })
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    expect(domain.value).toBe('xb')
    expect(storage.read('settings')).toEqual({ version: 2, value: 'xb' })
  })

  it('ignores data written by a newer script and keeps its generation', () => {
    const storage = createStorage({ settings: { version: 9, value: 'future' } })
    const warn = vi.fn()
    const domain = createDomain({
      key: 'settings',
      steps: append,
      storage: storage.api,
      onWarn: warn
    })

    expect(domain.version).toBe(9)
    expect(domain.value).toBe('future')
    expect(storage.writes).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reports unrecognised values and never rewrites them', () => {
    const corrupt = [
      { version: '1', value: 'x' },
      { version: 1 },
      { version: 1.5, value: 'x' },
      { version: -1, value: 'x' },
      { value: 'x' },
      [1, 2],
      42,
      true
    ]
    for (const stored of corrupt) {
      const storage = createStorage({ settings: stored })
      const warn = vi.fn()
      const domain = createDomain({
        key: 'settings',
        steps: append,
        storage: storage.api,
        onWarn: warn
      })

      expect(domain.value).toBeNull()
      expect(storage.writes).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the stored payload when a step throws', () => {
    const storage = createStorage({ settings: '{"a":1}' })
    const warn = vi.fn()
    const domain = createDomain({
      key: 'settings',
      steps: [
        {
          id: 1,
          run: () => {
            throw new Error('boom')
          }
        }
      ],
      storage: storage.api,
      onWarn: warn
    })

    expect(domain.version).toBe(0)
    expect(domain.value).toBe('{"a":1}')
    expect(storage.writes).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('applies steps in ascending id order', () => {
    const storage = createStorage({ settings: 'x' })
    const second: DomainStep = { id: 2, run: (value) => `${value}b` }
    const first: DomainStep = { id: 1, run: (value) => `${value}a` }
    const domain = createDomain({
      key: 'settings',
      steps: [second, first],
      storage: storage.api
    })

    expect(domain.value).toBe('xab')
  })

  it('writes the envelope with the current generation on save', () => {
    const storage = createStorage()
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    domain.storage.setItem('settings', '{"theme":"dark"}')
    expect(storage.read('settings')).toEqual({ version: 2, value: '{"theme":"dark"}' })
  })

  it('round-trips saves through the view', () => {
    const storage = createStorage()
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    domain.storage.setItem('settings', 'one')
    expect(domain.storage.getItem('settings')).toBe('one')

    const reopened = createDomain({ key: 'settings', steps: append, storage: storage.api })
    expect(reopened.storage.getItem('settings')).toBe('one')
    expect(storage.writes).toHaveLength(1)
  })

  it('deletes the envelope on remove', () => {
    const storage = createStorage({ settings: { version: 2, value: 'x' } })
    const domain = createDomain({ key: 'settings', steps: append, storage: storage.api })

    domain.storage.removeItem('settings')
    expect(storage.has('settings')).toBe(false)
    expect(domain.storage.getItem('settings')).toBeNull()
  })

  it('reports a delete the manager refuses', () => {
    const warn = vi.fn()
    const domain = createDomain({
      key: 'settings',
      steps: append,
      storage: {
        getValue: () => null,
        setValue: () => undefined,
        deleteValue: () => {
          throw new Error('blocked')
        }
      },
      onWarn: warn
    })

    expect(() => domain.storage.removeItem('settings')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('falls back to a null value when the manager cannot delete', () => {    const values = new Map<string, string>()
    const api: DomainValueStorage = {
      getValue: (key) => {
        const raw = values.get(key)
        return raw === undefined ? null : JSON.parse(raw)
      },
      setValue: (key, value) => values.set(key, JSON.stringify(value))
    }
    const domain = createDomain({ key: 'settings', steps: append, storage: api })

    domain.storage.setItem('settings', 'x')
    domain.storage.removeItem('settings')
    expect(values.get('settings')).toBe('null')
    expect(domain.storage.getItem('settings')).toBeNull()
  })

  it('survives a storage that throws', () => {
    const warn = vi.fn()
    const domain = createDomain({
      key: 'settings',
      steps: append,
      storage: {
        getValue: () => {
          throw new Error('blocked')
        },
        setValue: () => {
          throw new Error('blocked')
        }
      },
      onWarn: warn
    })

    expect(domain.value).toBeNull()
    expect(domain.version).toBe(2)
    expect(() => domain.storage.setItem('settings', 'x')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('is idempotent across restarts', () => {
    const storage = createStorage({ settings: 'x' })
    createDomain({ key: 'settings', steps: append, storage: storage.api })
    const second = createDomain({ key: 'settings', steps: append, storage: storage.api })

    expect(second.value).toBe('xab')
    expect(storage.writes).toHaveLength(1)
  })
})
