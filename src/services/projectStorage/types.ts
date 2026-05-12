/** Stable handle for a project in a storage backend (IndexedDB, filesystem, future API). */
export type ProjectStorageUri = string

export type ProjectRecord = {
  id: string
  name: string
  storageUri: ProjectStorageUri
  createdAt: number
  updatedAt: number
}

export type ProjectWriteInput = {
  storageUri?: ProjectStorageUri | null
  json: string
  name?: string
}

/** Swap implementations without changing UI or editor code. */
export interface ProjectStoragePort {
  list(): Promise<ProjectRecord[]>
  read(storageUri: ProjectStorageUri): Promise<string>
  write(input: ProjectWriteInput): Promise<ProjectRecord>
  delete(storageUri: ProjectStorageUri): Promise<void>
}
