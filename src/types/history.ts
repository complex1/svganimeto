import type { VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'

export type HistorySnapshot = {
  elements: VectorElement[]
  tracks: AnimationTrack[]
}
