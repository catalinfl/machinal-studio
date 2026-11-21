import { SvelteMap } from 'svelte/reactivity'

const localSources = new SvelteMap<string, File>()
let scope = 'guest'
const dirtySources = new Map<string, File | undefined>()

export function setLocalMediaScope(value: string): void { scope = value }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('direction-project-media', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Could not store local media in this browser.'))
  })
}

async function persistSource(key: string, file?: File): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite')
      const store = transaction.objectStore('files')
      if (file) store.put(file, key)
      else store.delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Local media could not be saved. Check available browser storage and retry.'))
      transaction.onabort = transaction.onerror
    })
  } finally { db.close() }
}

export async function flushLocalSources(): Promise<void> {
  const targetScope = scope
  for (const [id, file] of [...dirtySources]) {
    await persistSource(`${targetScope}:${id}`, file)
    if (dirtySources.get(id) === file) dirtySources.delete(id)
  }
}

export async function restoreLocalSources(value: string): Promise<Map<string, string>> {
  const previews = new Map<string, string>()
  if (typeof indexedDB === 'undefined') return previews
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const prefix = `${value}:`
      const request = db.transaction('files').objectStore('files').openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { resolve(); return }
        const key = String(cursor.key)
        if (key.startsWith(`${value}:`)) {
          const id = key.slice(value.length + 1)
          const file = cursor.value as File
          localSources.set(id, file)
          previews.set(id, URL.createObjectURL(file))
        }
        cursor.continue()
      }
      request.onerror = () => reject(new Error('Local project media could not be loaded.'))
    })
  } finally { db.close() }
  return previews
}

export function rememberLocalSource(file: File): string {
  const sourceId = crypto.randomUUID()
  localSources.set(sourceId, file)
  dirtySources.set(sourceId, file)
  return sourceId
}

export function getLocalSource(sourceId: string): File | undefined {
  return localSources.get(sourceId)
}

export function replaceLocalSource(sourceId: string, file: File): void {
  localSources.set(sourceId, file)
  dirtySources.set(sourceId, file)
}

export async function copyLocalSourcesToScope(targetScope: string, ids: string[]): Promise<void> {
  for (const id of new Set(ids)) {
    const file = localSources.get(id)
    if (file) await persistSource(`${targetScope}:${id}`, file)
  }
}

export function forgetLocalSource(sourceId: string): void {
  localSources.delete(sourceId)
  dirtySources.set(sourceId, undefined)
}
