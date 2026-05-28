export type EasingId =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'

/** Timeline UI selection (not persisted in project JSON). */
export type KeyframeSelectionEntry = {
  trackId: string
  keyframeId: string
}

export type Keyframe = {
  id: string
  time: number
  value: number
  /** Path `d` string when `property === 'pathD'`. */
  valueText?: string
  easing?: EasingId
}

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'skewX'
  | 'skewY'
  /** Packed 0xRRGGBB in `value` (use color utils). */
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  /** Path `d` uses `valueText` on each keyframe; `value` unused. */
  | 'pathD'
  | 'fxBlur'
  | 'fxShadowX'
  | 'fxShadowY'
  | 'fxShadowBlur'
  /** Shadow color packed like fill. */
  | 'fxShadowColor'
  /** Normalized 0–1 distance along path referenced by attrs.__motionPathId. */
  | 'motionPathOffset'
  /** `mask` presentation attribute (typically url(#id)); keyframe valueText. */
  | 'mask'
  /** `clip-path` presentation attribute; keyframe valueText. */
  | 'clipPath'
  /** SVG `filter` attribute url(#id) — separate from CSS blur/shadow on __fx*. */
  | 'svgFilter'

/** Clipboard payload for copy/paste of keyframes (relative times). */
export type KeyframeClipboardEntry = {
  elementId: string
  property: AnimatableProperty
  /** Seconds from the earliest copied keyframe time. */
  offsetFromAnchor: number
  value: number
  valueText?: string
  easing?: EasingId
}

export type AnimationTrack = {
  id: string
  elementId: string
  property: AnimatableProperty
  keyframes: Keyframe[]
}

/**
 * Properties that the noise (wiggle) effect can drive. Restricted to transform
 * channels — colour / path noise is out of scope.
 */
export type NoiseProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'skewX'
  | 'skewY'

/**
 * Render-time wiggle effect attached to a single VectorElement property. While
 * the playhead is inside `[from, to]`, the property's value is replaced with a
 * smooth pseudo-random oscillation between `min` and `max` at `frequency` Hz.
 * Stored on the element itself (not as a track) so it composes on top of
 * keyframed animation without polluting the timeline.
 */
export type NoiseDef = {
  id: string
  property: NoiseProperty
  from: number
  to: number
  min: number
  max: number
  frequency: number
  seed?: number
}
