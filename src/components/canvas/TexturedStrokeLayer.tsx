import { useMemo } from 'react'
import type { TextureBrush } from '@/types/texture'
import {
  getTextureBrushPreset,
  resolveStampColor,
  sampleTextureStamps
} from '@/engines/texture/textureBrushes'

/**
 * Render the textured-stroke overlay for a single host element. Sits in the
 * host's local coordinate space (same `<g>` as the path it decorates) so the
 * editor transform, motion path and animation all apply to the stamps too.
 *
 * The host path is intentionally still rendered separately by the regular
 * `InnerShape` — when an artist sets `fill: 'none'` and `stroke: 'none'` the
 * stamps are all that's visible (the path becomes a pure guide). When the
 * artist keeps a stroke colour, the original line shows through, giving a
 * "stroke + texture" look that's hard to fake with a pattern fill.
 */
export function TexturedStrokeLayer({
  pathD,
  brush,
  hostAttrs
}: {
  pathD: string
  brush: TextureBrush
  hostAttrs: Record<string, unknown>
}) {
  const preset = getTextureBrushPreset(brush.preset)

  /**
   * `sampleTextureStamps` is moderately expensive (DOM `getPointAtLength` once
   * per `d`, cached). We memoise per-render against the inputs that actually
   * affect placement so scrubbing the timeline doesn't recompute when only the
   * transform changes.
   */
  const stamps = useMemo(
    () => sampleTextureStamps(pathD, brush),
    [
      pathD,
      brush.preset,
      brush.spacing,
      brush.scale,
      brush.scaleJitter,
      brush.rotationJitter,
      brush.scatter,
      brush.opacity,
      brush.opacityJitter,
      brush.seed,
      brush.orient
    ]
  )

  if (stamps.length === 0) return null

  const fillColor = resolveStampColor(brush, hostAttrs)

  return (
    <g
      data-texture-brush={brush.preset}
      pointerEvents="none"
      style={{ mixBlendMode: 'normal' }}
    >
      {stamps.map((s) => (
        <g
          key={s.index}
          transform={`translate(${s.x.toFixed(3)} ${s.y.toFixed(3)}) rotate(${s.rotation.toFixed(2)}) scale(${s.scale.toFixed(3)})`}
          opacity={s.alpha}
        >
          {preset.stamp.map((shape, j) => (
            <path
              key={j}
              d={shape.d}
              fill={fillColor}
              fillRule={shape.fillRule ?? 'nonzero'}
              stroke="none"
            />
          ))}
        </g>
      ))}
    </g>
  )
}
