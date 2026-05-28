/**
 * Texture brush data model.
 *
 * A textured stroke uses the host element's path as a guide and walks along it,
 * dropping small "stamp" shapes at regular spacing. Each stamp may be rotated
 * to the path tangent and randomised (scatter, scale, rotation, opacity) using a
 * deterministic seed so the same stroke renders identically across reloads /
 * export.
 *
 * We deliberately keep the brush as a separate, named field on the element
 * (instead of stuffing JSON into `attrs`) so the rest of the editor — keyframe
 * sampling, exporters, history snapshots — never has to special-case its shape.
 */
export type TextureBrushPresetId =
  | 'pencil'
  | 'charcoal'
  | 'brush'
  | 'marker'
  | 'crayon'
  | 'ink'
  | 'fur'
  | 'grass'

export type TextureBrushOrient =
  /** Each stamp rotates with the path tangent (default for strokes). */
  | 'tangent'
  /** Stamps stay upright in world space (useful for spray-style "ink"). */
  | 'upright'

export type TextureBrush = {
  preset: TextureBrushPresetId
  /**
   * Distance between consecutive stamp centres along the path, in path units.
   * A reasonable range is `0.25 * referenceSize` … `4 * referenceSize` of the
   * preset. Values <= 0 are clamped at render time to avoid infinite loops.
   */
  spacing: number
  /** Multiplier on the preset's reference stamp size. */
  scale: number
  /** ± fraction of `scale` applied randomly per stamp (0 = uniform, 1 = ±100 %). */
  scaleJitter: number
  /** ± random rotation per stamp, degrees (added to the tangent rotation). */
  rotationJitter: number
  /** ± random perpendicular offset from the path, in path units. */
  scatter: number
  /** Base alpha applied to each stamp (0..1). */
  opacity: number
  /** ± fraction of opacity applied randomly per stamp. */
  opacityJitter: number
  /**
   * Fill colour. When omitted, each stamp inherits the host's `stroke`, or
   * `fill`, whichever is the most natural for the preset (see the registry).
   */
  color?: string
  /**
   * Stable RNG seed so the same brush re-renders the exact same stamp pattern
   * frame-to-frame and after reload. We supply a fresh seed on creation.
   */
  seed: number
  orient: TextureBrushOrient
}
