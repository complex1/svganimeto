import type { ProjectRecord, ProjectStoragePort, ProjectWriteInput } from './types'

function assertApi() {
  if (!window.api?.projectLibrary) {
    throw new Error('Desktop project library is unavailable')
  }
  return window.api.projectLibrary
}

export const electronProjectStorage: ProjectStoragePort = {
  list() {
    return assertApi().list()
  },
  read(storageUri) {
    return assertApi().read(storageUri)
  },
  write(input: ProjectWriteInput) {
    return assertApi().write(input)
  },
  delete(storageUri) {
    return assertApi().delete(storageUri)
  }
}

export async function openProjectFileFromDialog(): Promise<{
  record: ProjectRecord
  json: string
} | null> {
  return assertApi().openFromDialog()
}
