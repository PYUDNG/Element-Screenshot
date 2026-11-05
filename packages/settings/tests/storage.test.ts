import { describe, expect, it } from 'vitest'
import { createGMStorage, createLocalStorageStorage, createMemoryStorage } from '../src/storage'
import type { SettingsStorage } from '../src/storage'

class FakeStorage implements Storage {
  private data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

describe('settings storage adapters', () => {
  it('stores values in memory', () => {
    const storage = createMemoryStorage({ a: '1' })
    expect(storage.getItem('a')).toBe('1')
    expect(storage.getItem('missing')).toBeNull()
    storage.setItem('b', '2')
    expect(storage.getItem('b')).toBe('2')
    storage.removeItem('a')
    expect(storage.getItem('a')).toBeNull()
  })

  it('prefixes localStorage keys', () => {
    const fake = new FakeStorage()
    const storage = createLocalStorageStorage('app:', fake)
    storage.setItem('x', '1')
    expect(fake.getItem('app:x')).toBe('1')
    expect(storage.getItem('x')).toBe('1')
    storage.removeItem('x')
    expect(fake.getItem('app:x')).toBeNull()
  })

  it('survives unavailable localStorage', () => {
    const storage = createLocalStorageStorage('', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      }
    } as unknown as Storage)
    expect(storage.getItem('x')).toBeNull()
    expect(() => storage.setItem('x', '1')).not.toThrow()
    expect(() => storage.removeItem('x')).not.toThrow()
  })

  it('adapts GM value APIs with a prefix and delete support', () => {
    const values = new Map<string, string>()
    const api = {
      getValue: (key: string, fallback: string | null) => values.get(key) ?? fallback,
      setValue: (key: string, value: string) => values.set(key, value),
      deleteValue: (key: string) => values.delete(key)
    }
    const storage: SettingsStorage = createGMStorage(api, 'shot:')
    storage.setItem('a', '1')
    expect(values.get('shot:a')).toBe('1')
    expect(storage.getItem('a')).toBe('1')
    storage.removeItem('a')
    expect(storage.getItem('a')).toBeNull()
  })

  it('falls back to an empty value when no delete API exists', () => {
    const values = new Map<string, string>()
    const storage = createGMStorage({
      getValue: (key, fallback) => values.get(key) ?? fallback,
      setValue: (key, value) => values.set(key, value)
    })
    storage.setItem('a', '1')
    storage.removeItem('a')
    expect(values.get('a')).toBe('')
  })
})
