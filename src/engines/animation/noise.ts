/**
 * Per-element noise effects (a.k.a. "wiggle") layered on top of the merged
 * transform / attrs at render time.
 *
 * Each `NoiseDef` describes a single property whose value should wobble between
 * `min` and `max` while the playhead is inside `[from, to]`. Outside the window
 * the property reverts to whatever the keyframes / base value produce — so noise
 * is *additive on top of* the existing animation system, not a replacement.
 *
 * The wobble itself is a smooth value-noise: deterministic per-`seed`, so the
 * shake is reproducible across reloads and identical between Preview/Render.
 */
import type { Transform } from '@/types/document'
import type { NoiseDef, NoiseProperty } from '@/types/animation'

export const NOISE_PROPERTIES: { value: NoiseProperty; label: string }[] = [
  { value: 'x', label: 'X position' },
  { value: 'y', label: 'Y position' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'scaleX', label: 'Scale X' },
  { value: 'scaleY', label: 'Scale Y' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'skewX', label: 'Skew X' },
  { value: 'skewY', label: 'Skew Y' }
]

function hashStringSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  /** Map to a finite positive int comfortably within Float64 precision. */
  return h % 0xffffff
}

/**
 * 1-D pseudo-random in [0, 1). Stable across machines (no Math.random / Date).
 */
function fractSin(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Smoothed value noise — picks a random anchor every integer step and smoothly
 * interpolates between neighbours using a cubic (Hermite) smoothstep. Output
 * range [0, 1). Continuous and C^1, so the wobble doesn't visibly tear at
 * integer boundaries.
 */
function valueNoise01(t: number, seed: number): number {
  const i = Math.floor(t)
  const f = t - i
  const a = fractSin(i, seed)
  const b = fractSin(i + 1, seed)
  /** smoothstep — 3t² − 2t³ — keeps the curve C¹ continuous. */
  const w = f * f * (3 - 2 * f)
  return a + (b - a) * w
}

/**
 * Sample a single noise definition at `time`. Returns `null` when the time is
 * outside `[from, to]` so callers can leave the original value untouched.
 */
export function sampleNoiseValue(noise: NoiseDef, time: number): number | null {
  if (time < noise.from || time > noise.to) return null
  const seed = noise.seed ?? hashStringSeed(noise.id)
  const freq = Math.max(0.01, noise.frequency || 1)
  /** Normalize to seconds-relative-to-window-start so changing `from` shifts phase predictably. */
  const localT = (time - noise.from) * freq
  const u = valueNoise01(localT, seed)
  return noise.min + (noise.max - noise.min) * u
}

const TRANSFORM_NOISE_KEYS: ReadonlySet<NoiseProperty> = new Set<NoiseProperty>([
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'skewX',
  'skewY'
])

/**
 * Layer all active noise definitions onto an already-merged transform.
 * Later defs on the same property win (last-write-wins).
 */
export function applyNoiseToTransform(
  tr: Transform,
  noises: NoiseDef[] | undefined,
  time: number
): Transform {
  if (!noises || noises.length === 0) return tr
  let out = tr
  let mutated = false
  for (const n of noises) {
    if (!TRANSFORM_NOISE_KEYS.has(n.property)) continue
    const v = sampleNoiseValue(n, time)
    if (v === null) continue
    if (!mutated) {
      out = { ...tr }
      mutated = true
    }
    ;(out as unknown as Record<string, number>)[n.property] = v
  }
  return out
}
