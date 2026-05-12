import { electronProjectStorage } from './electronProjectStorage'
import { indexedDbProjectStorage } from './indexedDbProjectStorage'
import type { ProjectStoragePort } from './types'

export function getProjectStorage(): ProjectStoragePort {
  if (typeof window !== 'undefined' && window.api?.projectLibrary) {
    return electronProjectStorage
  }
  return indexedDbProjectStorage
}
