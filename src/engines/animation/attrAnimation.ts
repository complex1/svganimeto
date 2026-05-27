import type { VectorAttrValue } from '@/types/document'
import type { AnimatableProperty, AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import { applyEasing } from '@/engines/animation/interpolate'
import { morphPathDApprox } from '@/engines/geometry/svgPathMotion'

const COLOR_PROPS: Set<AnimatableProperty> = new Set(['fill', 'stroke', 'fxShadowColor'])

/** Timeline keyframes use valueText (hold or segment morph for pathD). */
export const ATTR_TEXT_STEP_PROPERTIES: ReadonlySet<AnimatableProperty> = new Set([
  'pathD',
  'mask',
  'clipPath',
  'svgFilter'
])

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

/** sRGB component (0..255) -> linear-light (0..1). */
function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

/** Linear-light (0..1) -> sRGB component (0..255). */
function linearToSrgb(x: number): number {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

/**
 * Lerp two packed sRGB colors in linear-light space.
 *
 * Naive sRGB interpolation (the previous behaviour) muddies mid-tones — e.g. blue→yellow
 * passes through grey-brown. Linearizing first keeps gradients perceptually faithful and
 * fixes the "weird" mid-animation tones the user reported.
 */
function lerpPackedRgbLinear(a: number, b: number, t: number): number {
  const ar = srgbToLinear((a >> 16) & 255)
  const ag = srgbToLinear((a >> 8) & 255)
  const ab = srgbToLinear(a & 255)
  const br = srgbToLinear((b >> 16) & 255)
  const bg = srgbToLinear((b >> 8) & 255)
  const bb = srgbToLinear(b & 255)
  const r = linearToSrgb(ar + (br - ar) * t)
  const g = linearToSrgb(ag + (bg - ag) * t)
  const bl = linearToSrgb(ab + (bb - ab) * t)
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255)
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
  return lerpPackedRgbLinear(a.value, b.value, eased)
}

/** Path `d`: between keyframes, approximate morph; outside, hold last key. */
export function samplePathDTrack(track: AnimationTrack, time: number): string | undefined {
  if (track.property !== 'pathD') return undefined
  const kfs = sortKeyframes(track.keyframes).filter((k) => typeof k.valueText === 'string')
  if (kfs.length === 0) return undefined
  if (time <= kfs[0].time) return kfs[0].valueText
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].valueText

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    if (time >= a.time && time <= b.time + 1e-6) {
      const span = b.time - a.time
      if (span <= 1e-6) return b.valueText
      const raw = (time - a.time) / span
      const eased = applyEasing(raw, b.easing ?? a.easing ?? ('linear' as EasingId))
      const d0 = a.valueText ?? ''
      const d1 = b.valueText ?? ''
      if (!d0 || !d1) return d0 || d1
      const morphed = morphPathDApprox(d0, d1, eased)
      return morphed ?? (eased < 0.5 ? d0 : d1)
    }
  }
  return undefined
}

/** mask / clipPath / svgFilter: step/hold last keyframe with valueText at or before t. */
export function sampleTextHoldTrack(
  track: AnimationTrack,
  time: number,
  expected: AnimatableProperty
): string | undefined {
  if (track.property !== expected) return undefined
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

    if (tr.property === 'mask') {
      const s = sampleTextHoldTrack(tr, time, 'mask')
      if (s !== undefined) out.mask = s
      continue
    }
    if (tr.property === 'clipPath') {
      const s = sampleTextHoldTrack(tr, time, 'clipPath')
      if (s !== undefined) out['clip-path'] = s
      continue
    }
    if (tr.property === 'svgFilter') {
      const s = sampleTextHoldTrack(tr, time, 'svgFilter')
      if (s !== undefined) out.filter = s
      continue
    }
  }

  return out
}

export function isColorAnimatableProperty(p: AnimatableProperty): boolean {
  return COLOR_PROPS.has(p)
}
