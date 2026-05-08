import type { SymbolDefinition, VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import type { GradientDef } from '@/types/gradient'

export type HistorySnapshot = {
  elements: VectorElement[]
  tracks: AnimationTrack[]
  gradients: GradientDef[]
  symbols: SymbolDefinition[]
}
