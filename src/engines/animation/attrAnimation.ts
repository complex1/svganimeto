import type { VectorAttrValue } from '@/types/document'
import type { AnimatableProperty, AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import { applyEasing } from '@/engines/animation/interpolate'

const COLOR_PROPS: Set<AnimatableProperty> = new Set(['fill', 'stroke', 'fxShadowColor'])

function sortKeyframes(kfs: Keyframe[]): Keyframe[] {
  return [...kfs].sort((a, b) => a.time - b.time)
}

/** #rgb / #rrggbb / #rrggbbaa → 0xRRGGBB (alpha dropped for lerp; use opaque). */
export function hexToPackedRgb(hex: string): number | undefined {
  const h = hex.trim()
  if (!h.startsWith('#')) return undefined
  const body = h.slice(1)
  let r = 0
  let g = 0
  let b = 0
  if (body.length === 3) {
    r = parseInt(body[0]! + body[0]!, 16)
    g = parseInt(body[1]! + body[1]!, 16)
    b = parseInt(body[2]! + body[2]!, 16)
  } else if (body.length === 6 || body.length === 8) {
    r = parseInt(body.slice(0, 2), 16)
    g = parseInt(body.slice(2, 4), 16)
    b = parseInt(body.slice(4, 6), 16)
  } else return undefined
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return undefined
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}

export function packedRgbToHex(packed: number): string {
  const r = (packed >> 16) & 255
  const g = (packed >> 8) & 255
  const b = packed & 255
  const x = (n: number) => n.toString(16).padStart(2, '0')
  return `#${x(r)}${x(g)}${x(b)}`
}

function samplePackedColorTrack(track: AnimationTrack, time: number): number | undefined {
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
  const ar = (a.value >> 16) & 255
  const ag = (a.value >> 8) & 255
  const ab = a.value & 255
  const br = (b.value >> 16) & 255
  const bg = (b.value >> 8) & 255
  const bb = b.value & 255
  const r = Math.round(ar + (br - ar) * eased)
  const g = Math.round(ag + (bg - ag) * eased)
  const bl = Math.round(ab + (bb - ab) * eased)
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255)
}

/** Path `d`: hold previous keyframe text (step). Morphing between strings is not implemented. */
export function samplePathDTrack(track: AnimationTrack, time: number): string | undefined {
  if (track.property !== 'pathD') return undefined
  const kfs = sortKeyframes(track.keyframes).filter((k) => typeof k.valueText === 'string')
  if (kfs.length === 0) return undefined
  let best: Keyframe | null = null
  for (const k of kfs) {
    if (k.time <= time + 1e-6) {
      if (!best || k.time > best.time) best = k
    }
  }
  return best?.valueText
}

function sampleNumericAttr(track: AnimationTrack, time: number): number | undefined {
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
  const eased = applyEasing(raw, b.easing ?? a.easing ?? ('linear' as EasingId))
  return a.value + (b.value - a.value) * eased
}

/**
 * Merge animated presentation attrs onto base attrs for one element at `time`.
 * Does not include transform (handled separately).
 */
export function mergeAttrsFromTracks(
  baseAttrs: Record<string, VectorAttrValue>,
  elementId: string,
  tracks: AnimationTrack[],
  time: number
): Record<string, VectorAttrValue> {
  const out: Record<string, VectorAttrValue> = { ...baseAttrs }

  for (const tr of tracks) {
    if (tr.elementId !== elementId || tr.keyframes.length === 0) continue

    if (tr.property === 'fill' || tr.property === 'stroke' || tr.property === 'fxShadowColor') {
      const v = samplePackedColorTrack(tr, time)
      if (v !== undefined) {
        if (tr.property === 'fxShadowColor') {
          out.__fxShadowColor = packedRgbToHex(v)
        } else {
          out[tr.property] = packedRgbToHex(v)
        }
      }
      continue
    }

    if (tr.property === 'pathD') {
      const d = samplePathDTrack(tr, time)
      if (d !== undefined) out.d = d
      continue
    }

    if (tr.property === 'strokeWidth') {
      const v = sampleNumericAttr(tr, time)
      if (v !== undefined) out['stroke-width'] = v
      continue
    }

    if (tr.property === 'fxBlur') {
      const v = sampleNumericAttr(tr, time)
      if (v !== undefined) out.__fxBlur = v
      continue
    }
    if (tr.property === 'fxShadowX') {
      const v = sampleNumericAttr(tr, time)
      if (v !== undefined) out.__fxShadowX = v
      continue
    }
    if (tr.property === 'fxShadowY') {
      const v = sampleNumericAttr(tr, time)
      if (v !== undefined) out.__fxShadowY = v
      continue
    }
    if (tr.property === 'fxShadowBlur') {
      const v = sampleNumericAttr(tr, time)
      if (v !== undefined) out.__fxShadowBlur = v
      continue
    }
  }

  return out
}

export function isColorAnimatableProperty(p: AnimatableProperty): boolean {
  return COLOR_PROPS.has(p)
}
