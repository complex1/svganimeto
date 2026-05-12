import { nanoid } from 'nanoid'
import type { ProjectRecord, ProjectStoragePort, ProjectWriteInput } from './types'
import {
  ensureProjectIdInJson,
  projectIdFromJson,
  projectNameFromJson
} from './projectCodec'

const DB_NAME = 'svg-animation-studio'
const DB_VERSION = 1
const STORE = 'projects'

type ProjectRow = ProjectRecord & { json: string }

function idbUri(id: string): string {
  return `idb:${id}`
}

function parseIdbUri(storageUri: string): string {
  if (!storageUri.startsWith('idb:')) {
    throw new Error(`Not an IndexedDB project URI: ${storageUri}`)
  }
  return storageUri.slice(4)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export const indexedDbProjectStorage: ProjectStoragePort = {
  async list() {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const rows = await requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<ProjectRow[]>)
    db.close()
    return rows
      .map(({ id, name, storageUri, createdAt, updatedAt }) => ({
        id,
        name,
        storageUri,
        createdAt,
        updatedAt
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async read(storageUri) {
    const id = parseIdbUri(storageUri)
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const row = await requestToPromise(tx.objectStore(STORE).get(id) as IDBRequest<ProjectRow | undefined>)
    db.close()
    if (!row) throw new Error('Project not found')
    return row.json
  },

  async write(input) {
    const now = Date.now()
    const existingId = input.storageUri ? parseIdbUri(input.storageUri) : undefined
    const id = existingId ?? projectIdFromJson(input.json) ?? nanoid(10)
    const json = ensureProjectIdInJson(input.json, id)
    const name = input.name?.trim() || projectNameFromJson(json)
    const storageUri = idbUri(id)

    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const existing = await requestToPromise(store.get(id) as IDBRequest<ProjectRow | undefined>)
    const row: ProjectRow = {
      id,
      name,
      storageUri,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      json
    }
    store.put(row)
    await transactionDone(tx)
    db.close()
    return {
      id,
      name,
      storageUri,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  },

  async delete(storageUri) {
    const id = parseIdbUri(storageUri)
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await transactionDone(tx)
    db.close()
  }
}
