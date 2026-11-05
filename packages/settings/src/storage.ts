/**
 * Minimal synchronous key/value storage used by the settings controller.
 * Values are always strings so that GM / localStorage / memory adapters behave
 * identically.
 */
export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createMemoryStorage(initial: Record<string, string> = {}): SettingsStorage {
  const data = new Map<string, string>(Object.entries(initial))

  return {
    getItem(key) {
      return data.get(key) ?? null
    },
    setItem(key, value) {
      data.set(key, value)
    },
    removeItem(key) {
      data.delete(key)
    }
  }
}

export function createLocalStorageStorage(prefix = '', storage?: Storage): SettingsStorage {
  function resolve(): Storage | null {
    if (storage) return storage
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }

  return {
    getItem(key) {
      try {
        return resolve()?.getItem(prefix + key) ?? null
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        resolve()?.setItem(prefix + key, value)
      } catch {
        // Quota errors or disabled storage are non-fatal for settings.
      }
    },
    removeItem(key) {
      try {
        resolve()?.removeItem(prefix + key)
      } catch {
        // Ignore.
      }
    }
  }
}

export interface GMStorageApi {
  getValue(key: string, defaultValue: string | null): string | null
  setValue(key: string, value: string): void
  deleteValue?(key: string): void
}

/**
 * Adapter around Tampermonkey / Violentmonkey `GM_getValue` style APIs.
 * Pass the functions explicitly so this library never depends on globals.
 */
export function createGMStorage(api: GMStorageApi, prefix = ''): SettingsStorage {
  return {
    getItem(key) {
      try {
        const value = api.getValue(prefix + key, null)
        return typeof value === 'string' ? value : null
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        api.setValue(prefix + key, value)
      } catch {
        // Ignore write failures (e.g. sandbox restrictions).
      }
    },
    removeItem(key) {
      try {
        if (api.deleteValue) {
          api.deleteValue(prefix + key)
        } else {
          api.setValue(prefix + key, '')
        }
      } catch {
        // Ignore.
      }
    }
  }
}
