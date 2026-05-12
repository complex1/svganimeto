import { create } from 'zustand'
import type { ProjectStorageUri } from '@/services/projectStorage/types'

export type AppScreen = 'home' | 'editor'

type SessionState = {
  screen: AppScreen
  activeStorageUri: ProjectStorageUri | null
  setScreen: (screen: AppScreen) => void
  setActiveStorageUri: (storageUri: ProjectStorageUri | null) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  screen: 'home',
  activeStorageUri: null,
  setScreen: (screen) => set({ screen }),
  setActiveStorageUri: (activeStorageUri) => set({ activeStorageUri })
}))
