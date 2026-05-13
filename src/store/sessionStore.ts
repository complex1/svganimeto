import { create } from 'zustand'
import type { ProjectStorageUri } from '@/services/projectStorage/types'

type SessionState = {
  activeStorageUri: ProjectStorageUri | null
  setActiveStorageUri: (storageUri: ProjectStorageUri | null) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  activeStorageUri: null,
  setActiveStorageUri: (activeStorageUri) => set({ activeStorageUri })
}))
