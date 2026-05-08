import type { AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import type { Transform } from '@/types/document'

function sortKeyframes(kfs: Keyframe[]): Keyframe[] {
  return [...kfs].sort((a, b) => a.time - b.time)
}

const BACK_C1 = 1.70158

function easeInBack(x: number): number {
  return x * x * ((BACK_C1 + 1) * x - BACK_C1)
}

function easeOutBack(x: number): number {
  const t = x - 1
  return 1 + t * t * ((BACK_C1 + 1) * t + BACK_C1)
}

function easeInOutBack(x: number): number {
  if (x < 0.5) {
    const u = 2 * x
    return (u * u * ((BACK_C1 + 1) * u - BACK_C1)) / 2
  }
  const u = 2 * x - 2
  return (1 + u * u * ((BACK_C1 + 1) * u + BACK_C1)) / 2
}

export function applyEasing(t: number, easing: EasingId = 'linear'): number {
  const x = Math.min(1, Math.max(0, t))
  switch (easing) {
    case 'linear':
      return x
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    case 'easeInCubic':
      return x * x * x
    case 'easeOutCubic':
      return 1 - Math.pow(1 - x, 3)
    case 'easeInOutCubic':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
    case 'easeInBack':
      return easeInBack(x)
    case 'easeOutBack':
      return easeOutBack(x)
    case 'easeInOutBack':
      return easeInOutBack(x)
    default:
      return x
  }
}

/** Sample a single numeric track at time `time` (seconds). */
export function sampleTrack(track: AnimationTrack, time: number): number | undefined {
  const kfs = sortKeyframes(track.keyframes)
  if (kfs.length === 0) return undefined
  if (kfs.length === 1) return kfs[0].value
  if (time <= kfs[0].time) return kfs[0].value
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value

  let i = 0
  for (let j = 1; j < kfs.length; j++) {
    if (kfs[j].time >= time) {
      i = j - 1
      break
    }
  }
  const a = kfs[i]
  const b = kfs[i + 1]
  const span = b.time - a.time
  if (span <= 0) return b.value
  const raw = (time - a.time) / span
  const eased = applyEasing(raw, b.easing ?? a.easing ?? 'linear')
  return a.value + (b.value - a.value) * eased
}

/** Merge sampled track values into a Transform (only defined properties override base). */
export function mergeTransformFromTracks(
  base: Transform,
  elementId: string,
  tracks: AnimationTrack[],
  time: number
): Transform {
  const next: Transform = { ...base }
  for (const track of tracks) {
    if (track.elementId !== elementId) continue
    if (track.keyframes.length === 0) continue
    const v = sampleTrack(track, time)
    if (v === undefined) continue
    if (track.property in next) {
      ;(next as Record<string, number>)[track.property] = v
    }
  }
  return next
}
