/**
 * Predefined animation presets the user can audition and apply to the selected layer.
 *
 * A preset is a *recipe*: given user-tunable `params` it expands into a small set of
 * keyframes (normalized to t∈[0,1] within `duration`), each tagged with a `mode` that
 * controls how the keyframe value combines with the layer's base transform value.
 *
 * Modes:
 *   - 'absolute'  → keyframe value used as-is (e.g. opacity = 0)
 *   - 'offset'    → keyframe value added to base (e.g. slide from base.x - 200)
 *   - 'baseMul'   → keyframe value multiplied with base (e.g. pop from scale * 0)
 *
 * The preview component plays the recipe in-place on a small SVG using these same
 * rules + `applyEasing`, so what users see in the preview matches what gets baked into
 * the timeline by `applyPreset`.
 */
import type { AnimatableProperty, AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import type { Transform } from '@/types/document'
import { applyEasing } from '@/engines/animation/interpolate'
import { nanoid } from 'nanoid'

export type PresetCategory = 'in' | 'out' | 'emphasis'

export type PresetParam =
  | {
      id: string
      label: string
      type: 'number'
      min: number
      max: number
      step: number
      default: number
      suffix?: string
    }
  | {
      id: string
      label: string
      type: 'select'
      options: { value: string; label: string }[]
      default: string
    }

export type PresetKeyframeDef = {
  /** Normalized time within the preset, 0 = start, 1 = end. */
  tNorm: number
  property: AnimatableProperty
  mode: 'absolute' | 'offset' | 'baseMul'
  value: number
  easing?: EasingId
}

export type AnimationPreset = {
  id: string
  name: string
  category: PresetCategory
  description: string
  params: PresetParam[]
  build: (params: Record<string, number | string>) => PresetKeyframeDef[]
}

export const PRESET_EASINGS: { value: EasingId; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In/Out' },
  { value: 'easeOutCubic', label: 'Ease Out (Cubic)' },
  { value: 'easeOutBack', label: 'Ease Out (Back)' },
  { value: 'easeInOutBack', label: 'Ease In/Out (Back)' }
]

const easingParam = (def: EasingId = 'easeOut'): PresetParam => ({
  id: 'easing',
  label: 'Easing',
  type: 'select',
  default: def,
  options: PRESET_EASINGS.map((e) => ({ value: e.value, label: e.label }))
})

const durationParam = (def = 1, min = 0.1, max = 10): PresetParam => ({
  id: 'duration',
  label: 'Duration',
  type: 'number',
  min,
  max,
  step: 0.1,
  default: def,
  suffix: 's'
})

const distanceParam = (def = 200): PresetParam => ({
  id: 'distance',
  label: 'Distance',
  type: 'number',
  min: 10,
  max: 2000,
  step: 10,
  default: def,
  suffix: 'px'
})

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: 'fade-in',
    name: 'Fade In',
    category: 'in',
    description: 'Layer fades from invisible to fully opaque.',
    params: [durationParam(1), easingParam('easeOut')],
    build: (p) => [
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'fade-out',
    name: 'Fade Out',
    category: 'out',
    description: 'Layer fades from fully opaque to invisible.',
    params: [durationParam(1), easingParam('easeIn')],
    build: (p) => [
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 1 },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 0, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'slide-in-left',
    name: 'Slide In Left',
    category: 'in',
    description: 'Layer enters from the left and fades in.',
    params: [durationParam(0.8), distanceParam(200), easingParam('easeOut')],
    build: (p) => [
      { tNorm: 0, property: 'x', mode: 'offset', value: -Number(p.distance) },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'x', mode: 'offset', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'slide-in-right',
    name: 'Slide In Right',
    category: 'in',
    description: 'Layer enters from the right and fades in.',
    params: [durationParam(0.8), distanceParam(200), easingParam('easeOut')],
    build: (p) => [
      { tNorm: 0, property: 'x', mode: 'offset', value: Number(p.distance) },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'x', mode: 'offset', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'slide-in-top',
    name: 'Slide In Top',
    category: 'in',
    description: 'Layer drops in from above.',
    params: [durationParam(0.8), distanceParam(150), easingParam('easeOutCubic')],
    build: (p) => [
      { tNorm: 0, property: 'y', mode: 'offset', value: -Number(p.distance) },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'y', mode: 'offset', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'slide-in-bottom',
    name: 'Slide In Bottom',
    category: 'in',
    description: 'Layer rises in from below.',
    params: [durationParam(0.8), distanceParam(150), easingParam('easeOutCubic')],
    build: (p) => [
      { tNorm: 0, property: 'y', mode: 'offset', value: Number(p.distance) },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'y', mode: 'offset', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'pop-in',
    name: 'Pop In',
    category: 'in',
    description: 'Layer pops in with an overshoot.',
    params: [durationParam(0.7), easingParam('easeOutBack')],
    build: (p) => [
      { tNorm: 0, property: 'scaleX', mode: 'baseMul', value: 0 },
      { tNorm: 0, property: 'scaleY', mode: 'baseMul', value: 0 },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'scaleX', mode: 'baseMul', value: 1, easing: p.easing as EasingId },
      { tNorm: 1, property: 'scaleY', mode: 'baseMul', value: 1, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: 'easeOut' }
    ]
  },
  {
    id: 'shrink-out',
    name: 'Shrink Out',
    category: 'out',
    description: 'Layer shrinks to nothing and fades out.',
    params: [durationParam(0.6), easingParam('easeIn')],
    build: (p) => [
      { tNorm: 0, property: 'scaleX', mode: 'baseMul', value: 1 },
      { tNorm: 0, property: 'scaleY', mode: 'baseMul', value: 1 },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 1 },
      { tNorm: 1, property: 'scaleX', mode: 'baseMul', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'scaleY', mode: 'baseMul', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 0, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'spin-in',
    name: 'Spin In',
    category: 'in',
    description: 'Layer spins into place while fading in.',
    params: [
      durationParam(0.9),
      {
        id: 'angle',
        label: 'Start angle',
        type: 'number',
        min: -720,
        max: 720,
        step: 15,
        default: -180,
        suffix: '°'
      },
      easingParam('easeOut')
    ],
    build: (p) => [
      { tNorm: 0, property: 'rotation', mode: 'offset', value: Number(p.angle) },
      { tNorm: 0, property: 'opacity', mode: 'absolute', value: 0 },
      { tNorm: 1, property: 'rotation', mode: 'offset', value: 0, easing: p.easing as EasingId },
      { tNorm: 1, property: 'opacity', mode: 'absolute', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'pulse',
    name: 'Pulse',
    category: 'emphasis',
    description: 'Brief scale bump and back. Great for attention.',
    params: [
      durationParam(0.6),
      {
        id: 'amount',
        label: 'Strength',
        type: 'number',
        min: 1.05,
        max: 2,
        step: 0.05,
        default: 1.2
      },
      easingParam('easeInOut')
    ],
    build: (p) => [
      { tNorm: 0, property: 'scaleX', mode: 'baseMul', value: 1 },
      { tNorm: 0, property: 'scaleY', mode: 'baseMul', value: 1 },
      { tNorm: 0.5, property: 'scaleX', mode: 'baseMul', value: Number(p.amount), easing: p.easing as EasingId },
      { tNorm: 0.5, property: 'scaleY', mode: 'baseMul', value: Number(p.amount), easing: p.easing as EasingId },
      { tNorm: 1, property: 'scaleX', mode: 'baseMul', value: 1, easing: p.easing as EasingId },
      { tNorm: 1, property: 'scaleY', mode: 'baseMul', value: 1, easing: p.easing as EasingId }
    ]
  },
  {
    id: 'shake',
    name: 'Shake',
    category: 'emphasis',
    description: 'Quick horizontal wobble. Use for errors or alerts.',
    params: [
      durationParam(0.6),
      {
        id: 'amplitude',
        label: 'Amplitude',
        type: 'number',
        min: 2,
        max: 80,
        step: 1,
        default: 12,
        suffix: 'px'
      }
    ],
    build: (p) => {
      const a = Number(p.amplitude)
      const steps = [0, -1, 1, -0.75, 0.75, -0.4, 0.4, 0]
      return steps.map((s, i) => ({
        tNorm: i / (steps.length - 1),
        property: 'x' as const,
        mode: 'offset' as const,
        value: s * a,
        easing: 'linear' as EasingId
      }))
    }
  },
  {
    id: 'bounce',
    name: 'Bounce',
    category: 'emphasis',
    description: 'Vertical bounce that settles to the base position.',
    params: [
      durationParam(0.8),
      {
        id: 'height',
        label: 'Height',
        type: 'number',
        min: 5,
        max: 400,
        step: 5,
        default: 60,
        suffix: 'px'
      }
    ],
    build: (p) => {
      const h = Number(p.height)
      return [
        { tNorm: 0, property: 'y', mode: 'offset', value: 0, easing: 'easeOut' },
        { tNorm: 0.3, property: 'y', mode: 'offset', value: -h, easing: 'easeIn' },
        { tNorm: 0.55, property: 'y', mode: 'offset', value: 0, easing: 'easeOut' },
        { tNorm: 0.78, property: 'y', mode: 'offset', value: -h * 0.35, easing: 'easeIn' },
        { tNorm: 1, property: 'y', mode: 'offset', value: 0, easing: 'easeOut' }
      ]
    }
  }
]

/** Resolve a keyframe def into the absolute value to write into the track. */
export function resolvePresetValue(
  def: PresetKeyframeDef,
  base: Transform
): number {
  const baseVal = (base as unknown as Record<string, number>)[def.property] ?? 0
  switch (def.mode) {
    case 'absolute':
      return def.value
    case 'offset':
      return baseVal + def.value
    case 'baseMul':
      return baseVal * def.value
    default:
      return def.value
  }
}

/**
 * Sample a preset at normalized time `tNorm` ∈ [0,1] for preview rendering.
 * Returns the *delta* relative to the base for every property the preset touches
 * (plus any `absolute` overrides). The preview component composes these onto the
 * placeholder shape to draw a faithful in-place playback.
 */
export function samplePresetAtNorm(
  preset: AnimationPreset,
  params: Record<string, number | string>,
  tNorm: number,
  base: Transform
): Partial<Record<AnimatableProperty, number>> {
  const defs = preset.build(params)
  /** Group by property so we can interpolate independently. */
  const byProp = new Map<AnimatableProperty, PresetKeyframeDef[]>()
  for (const def of defs) {
    const list = byProp.get(def.property) ?? []
    list.push(def)
    byProp.set(def.property, list)
  }
  const out: Partial<Record<AnimatableProperty, number>> = {}
  for (const [prop, defs] of byProp) {
    const sorted = [...defs].sort((a, b) => a.tNorm - b.tNorm)
    if (tNorm <= sorted[0].tNorm) {
      out[prop] = resolvePresetValue(sorted[0], base)
      continue
    }
    if (tNorm >= sorted[sorted.length - 1].tNorm) {
      out[prop] = resolvePresetValue(sorted[sorted.length - 1], base)
      continue
    }
    let i = 0
    for (let j = 1; j < sorted.length; j++) {
      if (sorted[j].tNorm >= tNorm) {
        i = j - 1
        break
      }
    }
    const a = sorted[i]
    const b = sorted[i + 1]
    const span = b.tNorm - a.tNorm
    const raw = span > 0 ? (tNorm - a.tNorm) / span : 1
    const eased = applyEasing(raw, b.easing ?? a.easing ?? 'linear')
    const va = resolvePresetValue(a, base)
    const vb = resolvePresetValue(b, base)
    out[prop] = va + (vb - va) * eased
  }
  return out
}

export type ApplyPresetOptions = {
  preset: AnimationPreset
  params: Record<string, number | string>
  baseTransform: Transform
  startTime: number
  /** Existing tracks for the element (so we can merge instead of overwrite when desired). */
  tracks: AnimationTrack[]
  elementId: string
  /** When true, any pre-existing keyframes for the touched properties are wiped first. */
  replaceExisting: boolean
}

/**
 * Build the next set of tracks after applying `preset` to `elementId`. Returns the
 * full updated tracks array (caller can hand it to `setTracks`).
 */
export function buildTracksWithPreset(opts: ApplyPresetOptions): AnimationTrack[] {
  const { preset, params, baseTransform, startTime, tracks, elementId, replaceExisting } = opts
  const duration = Number(params.duration ?? 1)
  const defs = preset.build(params)
  /** Group preset kfs by property so each property gets one track update. */
  const newKeyframesByProp = new Map<AnimatableProperty, Keyframe[]>()
  for (const def of defs) {
    const list = newKeyframesByProp.get(def.property) ?? []
    list.push({
      id: nanoid(8),
      time: startTime + def.tNorm * duration,
      value: resolvePresetValue(def, baseTransform),
      easing: def.easing
    })
    newKeyframesByProp.set(def.property, list)
  }

  const out: AnimationTrack[] = []
  const touched = new Set<AnimatableProperty>()
  for (const t of tracks) {
    if (t.elementId !== elementId) {
      out.push(t)
      continue
    }
    const incoming = newKeyframesByProp.get(t.property)
    if (!incoming) {
      out.push(t)
      continue
    }
    touched.add(t.property)
    /**
     * Replace = drop all existing kfs and use only the preset's.
     * Otherwise: keep existing kfs that don't overlap the preset window, then merge.
     */
    const existing = replaceExisting
      ? []
      : t.keyframes.filter(
          (k) => k.time < startTime - 1e-6 || k.time > startTime + duration + 1e-6
        )
    out.push({
      ...t,
      keyframes: [...existing, ...incoming].sort((a, b) => a.time - b.time)
    })
  }
  /** Any preset property without an existing track → new track. */
  for (const [prop, kfs] of newKeyframesByProp) {
    if (touched.has(prop)) continue
    out.push({
      id: nanoid(8),
      elementId,
      property: prop,
      keyframes: kfs.sort((a, b) => a.time - b.time)
    })
  }
  return out
}
