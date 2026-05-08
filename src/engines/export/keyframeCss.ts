import type { AnimationTrack } from '@/types/animation'

/** Unique sorted sample times for CSS keyframes: keyframe times plus 0 and duration. */
export function flattenTimesForElement(
  elementId: string,
  tracks: AnimationTrack[],
  durationSec: number
): number[] {
  const set = new Set<number>([0, Math.max(0, durationSec)])
  for (const tr of tracks) {
    if (tr.elementId !== elementId) continue
    for (const k of tr.keyframes) {
      set.add(k.time)
    }
  }
  return [...set].sort((a, b) => a - b)
}
