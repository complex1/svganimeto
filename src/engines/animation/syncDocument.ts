import type { VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { mapElements } from '@/engines/document/tree'

export function rebuildTransformsAtTime(
  elements: VectorElement[],
  tracks: AnimationTrack[],
  time: number
): VectorElement[] {
  return mapElements(elements, (el) => ({
    ...el,
    transform: mergeTransformFromTracks(el.transform, el.id, tracks, time)
  }))
}
