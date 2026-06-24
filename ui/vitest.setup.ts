// Node 25 exposes a partial global localStorage unless --localstorage-file is set.
// Keep jsdom specs stable with a small Storage-compatible in-memory shim.
const store = new Map<string, string>()
const localStorageShim: Storage = {
  get length() { return store.size },
  clear: () => store.clear(),
  getItem: (key: string) => store.get(key) ?? null,
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  removeItem: (key: string) => { store.delete(key) },
  setItem: (key: string, value: string) => { store.set(key, String(value)) },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageShim,
  configurable: true,
  writable: true,
})
