/**
 * Texture brush engine.
 *
 * Given an SVG path `d` and a {@link TextureBrush} config, produce a deterministic
 * list of stamps (position + rotation + scale + alpha) the renderer can draw
 * along the path. The path is treated as a *guide*: we walk it at `spacing`
 * intervals and emit one stamp per step.
 *
 * Why not `<pattern>` fill?
 *   - Patterns don't rotate with the path tangent — a "fur" or "grass" stamp
 *     pointing the same way everywhere looks like wallpaper, not a stroke.
 *   - Patterns don't randomise per-stamp scale / scatter / alpha; the artist's
 *     intent for organic media (charcoal, crayon) needs that variance.
 *
 * Determinism: a single integer seed combined with the stamp index drives a
 * tiny fract-sin PRNG, so the same brush always lays down the same dots, even
 * after reloading the project or exporting to standalone SVG.
 */
import type { TextureBrush, TextureBrushPresetId } from '@/types/texture'

export type StampInstance = {
  /** Stamp centre in the host path's local coordinate space. */
  x: number
  y: number
  /** Rotation in degrees (already includes path tangent and per-stamp jitter). */
  rotation: number
  /** Final scale multiplier applied to the preset's reference geometry. */
  scale: number
  /** Final alpha 0..1 for this stamp. */
  alpha: number
  /** Visual layering hint — current implementation just renders in array order. */
  index: number
}

/** What colour role the stamp inherits when {@link TextureBrush.color} is empty. */
export type PresetColorRole = 'stroke' | 'fill'

export type TextureBrushPreset = {
  id: TextureBrushPresetId
  label: string
  /** Short blurb shown in the picker. */
  description: string
  /**
   * Each preset is one or more sub-paths centred at the origin and roughly
   * within ±referenceSize/2. Multiple sub-paths allow internal "grain"
   * (e.g. 3 dots = pencil), drawn with fill (`color`).
   */
  stamp: { d: string; fillRule?: 'nonzero' | 'evenodd' }[]
  /** Nominal radius of the stamp at scale=1. Used as the spacing reference. */
  referenceSize: number
  /** Where to source the colour when the brush config leaves `color` unset. */
  colorRole: PresetColorRole
  /** Defaults applied when a user first picks this preset. */
  defaults: Omit<TextureBrush, 'preset' | 'seed'>
}

/**
 * Stamp shapes are intentionally tiny SVG paths. We hand-tune them rather than
 * generating from JS because:
 *   - Keeps the renderer pure (no DOM mutation just to build a "stamp svg").
 *   - Exporters can serialise them verbatim into the output SVG.
 */
export const TEXTURE_BRUSH_PRESETS: TextureBrushPreset[] = [
  {
    id: 'pencil',
    label: 'Pencil',
    description: 'Granular graphite — small clustered dots with high opacity variance.',
    stamp: [
      /** Two unevenly placed dots → "grain". */
      { d: 'M -0.6 -0.3 a 0.9 0.9 0 1 0 1.8 0 a 0.9 0.9 0 1 0 -1.8 0 Z' },
      { d: 'M 0.8 0.6 a 0.5 0.5 0 1 0 1.0 0 a 0.5 0.5 0 1 0 -1.0 0 Z' }
    ],
    referenceSize: 3,
    colorRole: 'stroke',
    defaults: {
      spacing: 1.4,
      scale: 1,
      scaleJitter: 0.5,
      rotationJitter: 30,
      scatter: 0.8,
      opacity: 0.55,
      opacityJitter: 0.4,
      orient: 'tangent'
    }
  },
  {
    id: 'charcoal',
    label: 'Charcoal',
    description: 'Smudgy, rough — big stamps with strong opacity & scale jitter.',
    stamp: [
      /** Irregular blob. */
      {
        d: 'M -2.2 -0.6 C -2.4 -1.6, -1.0 -2.1, 0.2 -1.7 C 1.6 -1.3, 2.3 -0.4, 2.1 0.7 C 1.9 1.7, 0.5 2.2, -0.8 1.9 C -2.0 1.6, -2.0 0.4, -2.2 -0.6 Z'
      },
      /** Inner "hole" for grit feel — drawn with even-odd so it punches through. */
      { d: 'M -0.6 -0.1 a 0.45 0.45 0 1 0 0.9 0 a 0.45 0.45 0 1 0 -0.9 0 Z', fillRule: 'evenodd' }
    ],
    referenceSize: 4,
    colorRole: 'stroke',
    defaults: {
      spacing: 1.8,
      scale: 1.1,
      scaleJitter: 0.5,
      rotationJitter: 45,
      scatter: 1.2,
      opacity: 0.65,
      opacityJitter: 0.45,
      orient: 'tangent'
    }
  },
  {
    id: 'brush',
    label: 'Brush',
    description: 'Soft tapered ellipse — paint-style, low jitter.',
    stamp: [{ d: 'M -3 0 C -3 -1.3, 3 -1.3, 3 0 C 3 1.3, -3 1.3, -3 0 Z' }],
    referenceSize: 5,
    colorRole: 'stroke',
    defaults: {
      spacing: 1.5,
      scale: 1,
      scaleJitter: 0.15,
      rotationJitter: 4,
      scatter: 0.2,
      opacity: 0.85,
      opacityJitter: 0.1,
      orient: 'tangent'
    }
  },
  {
    id: 'marker',
    label: 'Marker',
    description: 'Rounded rectangle stamp, opaque — clean highlighter look.',
    stamp: [{ d: 'M -3 -0.9 h 6 a 0.9 0.9 0 0 1 0.9 0.9 v 0 a 0.9 0.9 0 0 1 -0.9 0.9 h -6 a 0.9 0.9 0 0 1 -0.9 -0.9 v 0 a 0.9 0.9 0 0 1 0.9 -0.9 Z' }],
    referenceSize: 5,
    colorRole: 'stroke',
    defaults: {
      spacing: 1.1,
      scale: 1,
      scaleJitter: 0.05,
      rotationJitter: 0,
      scatter: 0,
      opacity: 0.45,
      opacityJitter: 0,
      orient: 'tangent'
    }
  },
  {
    id: 'crayon',
    label: 'Crayon',
    description: 'Waxy chunk + interior speckles — looks dragged on rough paper.',
    stamp: [
      { d: 'M -2.4 -1.1 L 2.4 -0.7 L 2.2 1.2 L -2.5 0.9 Z' },
      { d: 'M -0.8 -0.3 a 0.35 0.35 0 1 0 0.7 0 a 0.35 0.35 0 1 0 -0.7 0 Z', fillRule: 'evenodd' },
      { d: 'M 0.9 0.4 a 0.3 0.3 0 1 0 0.6 0 a 0.3 0.3 0 1 0 -0.6 0 Z', fillRule: 'evenodd' }
    ],
    referenceSize: 4.5,
    colorRole: 'stroke',
    defaults: {
      spacing: 1.6,
      scale: 1,
      scaleJitter: 0.3,
      rotationJitter: 14,
      scatter: 0.4,
      opacity: 0.7,
      opacityJitter: 0.3,
      orient: 'tangent'
    }
  },
  {
    id: 'ink',
    label: 'Ink',
    description: 'Teardrop droplet — wet ink, variable scale, almost no jitter.',
    stamp: [
      {
        d: 'M 0 -2.4 C 1.2 -2.0, 1.6 -0.7, 1.2 0.5 C 0.8 1.7, -0.8 1.7, -1.2 0.5 C -1.6 -0.7, -1.2 -2.0, 0 -2.4 Z'
      }
    ],
    referenceSize: 4,
    colorRole: 'stroke',
    defaults: {
      spacing: 2.4,
      scale: 0.9,
      scaleJitter: 0.55,
      rotationJitter: 360,
      scatter: 1.8,
      opacity: 0.85,
      opacityJitter: 0.25,
      orient: 'upright'
    }
  },
  {
    id: 'fur',
    label: 'Fur',
    description: 'Tiny curved hair perpendicular to the path — soft pelt feel.',
    stamp: [
      /** Curl pointing "outward" so tangent rotation fans it along the curve. */
      { d: 'M 0 0 C 0.3 -1.5, 0.9 -2.3, 1.6 -2.6 C 0.9 -2.0, 0.4 -1.0, 0 0 Z' }
    ],
    referenceSize: 5,
    colorRole: 'stroke',
    defaults: {
      spacing: 0.9,
      scale: 1,
      scaleJitter: 0.4,
      rotationJitter: 35,
      scatter: 0.6,
      opacity: 0.9,
      opacityJitter: 0.2,
      orient: 'tangent'
    }
  },
  {
    id: 'grass',
    label: 'Grass',
    description: 'Pointy blade growing perpendicular to the path.',
    stamp: [{ d: 'M -0.8 0 L 0 -4.5 L 0.8 0 Z' }],
    referenceSize: 5,
    colorRole: 'fill',
    defaults: {
      spacing: 1.2,
      scale: 1,
      scaleJitter: 0.55,
      rotationJitter: 22,
      scatter: 0.3,
      opacity: 1,
      opacityJitter: 0.15,
      orient: 'tangent'
    }
  }
]

export function getTextureBrushPreset(id: TextureBrushPresetId): TextureBrushPreset {
  return TEXTURE_BRUSH_PRESETS.find((p) => p.id === id) ?? TEXTURE_BRUSH_PRESETS[0]
}

/**
 * Element types the brush can decorate. We pick "stroke-like" geometry only:
 * pure `rect`/`circle`/`ellipse` aren't great guides (no natural direction),
 * and a brush along their outline would surprise the user.
 */
export const TEXTURE_BRUSH_ELIGIBLE_TYPES: ReadonlyArray<string> = [
  'path',
  'polyline',
  'polygon',
  'line'
]

/**
 * Distill any supported element into an SVG path `d` we can walk along.
 * - `path` → its own `d`
 * - `polyline` / `polygon` → straight segments (closes the polygon)
 * - `line` → single segment
 * Returns `null` when there's no usable geometry (so the renderer can skip).
 */
export function extractGuidePathD(
  type: string,
  attrs: Record<string, unknown>
): string | null {
  if (type === 'path') {
    const d = attrs.d
    return typeof d === 'string' && d.trim().length > 0 ? d : null
  }
  if (type === 'polyline' || type === 'polygon') {
    const raw = attrs.points
    if (typeof raw !== 'string') return null
    const nums = raw
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
    if (nums.length < 4) return null
    let d = `M ${nums[0]} ${nums[1]}`
    for (let i = 2; i + 1 < nums.length; i += 2) d += ` L ${nums[i]} ${nums[i + 1]}`
    if (type === 'polygon') d += ' Z'
    return d
  }
  if (type === 'line') {
    const x1 = Number(attrs.x1)
    const y1 = Number(attrs.y1)
    const x2 = Number(attrs.x2)
    const y2 = Number(attrs.y2)
    if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return null
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  return null
}

/** Build a fresh, fully-specified {@link TextureBrush} for the chosen preset. */
export function defaultTextureBrush(presetId: TextureBrushPresetId, seed = Math.floor(Math.random() * 1_000_000)): TextureBrush {
  const preset = getTextureBrushPreset(presetId)
  return { preset: preset.id, seed, ...preset.defaults }
}

/* ---------- deterministic RNG ---------- */
/**
 * `fract(sin(x) * k)` is a well-known cheap pseudo-random generator. Quality is
 * sufficient for visual jitter (we don't need crypto randomness) and stays
 * stable across browsers, which is important so a saved project + brush seed
 * looks identical on every machine.
 */
function fractSin(x: number): number {
  const v = Math.sin(x) * 43758.5453123
  return v - Math.floor(v)
}
function rng(seed: number, salt: number): number {
  return fractSin(seed * 12.9898 + salt * 78.233 + 0.000123)
}

/* ---------- path measurement (DOM-backed, cached) ---------- */
type MeasuredPath = {
  d: string
  length: number
  /** Pre-sampled points + tangent angles (deg), so we can avoid repeated DOM calls during animation. */
  samples: Array<{ x: number; y: number; t: number; angle: number }>
}

/**
 * Cache keyed by the path `d` string. SVG `getTotalLength()` / `getPointAtLength`
 * are expensive (they tessellate the path); we sample once per `d` and reuse.
 * Capped via a small LRU so long sessions don't leak.
 */
const PATH_MEASURE_CACHE = new Map<string, MeasuredPath | null>()
const PATH_MEASURE_LIMIT = 128

function remember(key: string, value: MeasuredPath | null) {
  if (PATH_MEASURE_CACHE.size >= PATH_MEASURE_LIMIT) {
    const first = PATH_MEASURE_CACHE.keys().next().value
    if (first !== undefined) PATH_MEASURE_CACHE.delete(first)
  }
  PATH_MEASURE_CACHE.set(key, value)
  return value
}

/** How densely we sample the underlying path for stamp lookup. Fine enough for any spacing. */
const PATH_SAMPLE_STEP = 1.0

function measurePath(d: string): MeasuredPath | null {
  if (typeof document === 'undefined') return null
  if (PATH_MEASURE_CACHE.has(d)) return PATH_MEASURE_CACHE.get(d) ?? null
  let host: SVGSVGElement | null = null
  try {
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    host.setAttribute('width', '0')
    host.setAttribute('height', '0')
    host.style.position = 'absolute'
    host.style.left = '-99999px'
    host.style.top = '-99999px'
    host.style.visibility = 'hidden'
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    node.setAttribute('d', d)
    host.appendChild(node)
    document.body.appendChild(host)
    const total = node.getTotalLength()
    if (!Number.isFinite(total) || total <= 0) {
      return remember(d, null)
    }
    const samples: MeasuredPath['samples'] = []
    const step = Math.max(0.25, PATH_SAMPLE_STEP)
    for (let s = 0; s <= total; s += step) {
      const p = node.getPointAtLength(s)
      const ahead = node.getPointAtLength(Math.min(total, s + 0.5))
      const behind = node.getPointAtLength(Math.max(0, s - 0.5))
      const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI
      samples.push({ x: p.x, y: p.y, t: s, angle })
    }
    return remember(d, { d, length: total, samples })
  } catch {
    return remember(d, null)
  } finally {
    if (host && host.parentElement) host.parentElement.removeChild(host)
  }
}

function sampleAt(measured: MeasuredPath, distance: number) {
  const samples = measured.samples
  if (samples.length === 0) return null
  if (distance <= samples[0].t) return samples[0]
  if (distance >= samples[samples.length - 1].t) return samples[samples.length - 1]
  /** Binary search the sorted samples then lerp position + angle for sub-step precision. */
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= distance) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const span = b.t - a.t || 1
  const k = (distance - a.t) / span
  /** Shortest-arc angle lerp to avoid wrap-around glitches at ±180°. */
  let da = b.angle - a.angle
  if (da > 180) da -= 360
  else if (da < -180) da += 360
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    angle: a.angle + da * k,
    t: distance
  }
}

/**
 * Produce one {@link StampInstance} per spacing step along `d`. Returns `[]`
 * when the path can't be measured (e.g. server-side, empty `d`) — callers
 * should then skip rendering the brush overlay for that element.
 */
export function sampleTextureStamps(d: string, brush: TextureBrush): StampInstance[] {
  if (!d || typeof d !== 'string') return []
  const preset = getTextureBrushPreset(brush.preset)
  const measured = measurePath(d)
  if (!measured) return []

  /**
   * `spacing` is expressed in path units. We clamp the lower bound so a user
   * sliding spacing toward zero doesn't create thousands of stamps that lock
   * the UI. `STAMP_BUDGET` is generous enough for realistic strokes but bounds
   * worst-case work.
   */
  const STAMP_BUDGET = 1200
  const minSpacing = Math.max(0.25, preset.referenceSize * 0.15)
  const spacing = Math.max(minSpacing, brush.spacing)
  /** If the user picks a tiny spacing on a very long path, scale up to fit budget. */
  const projected = measured.length / spacing
  const effectiveSpacing = projected > STAMP_BUDGET ? measured.length / STAMP_BUDGET : spacing

  const out: StampInstance[] = []
  let i = 0
  for (let s = 0; s <= measured.length + 1e-3; s += effectiveSpacing) {
    const here = sampleAt(measured, Math.min(s, measured.length))
    if (!here) continue
    const r1 = rng(brush.seed, i * 4 + 1)
    const r2 = rng(brush.seed, i * 4 + 2)
    const r3 = rng(brush.seed, i * 4 + 3)
    const r4 = rng(brush.seed, i * 4 + 4)
    /** Convert each rNG to symmetric ±1, then scale by the user's jitter knob. */
    const j = (r: number) => r * 2 - 1
    const scatter = j(r1) * brush.scatter
    const scaleJitter = 1 + j(r2) * Math.max(0, brush.scaleJitter)
    const rotJitter = j(r3) * brush.rotationJitter
    const opacityJitter = 1 + j(r4) * Math.max(0, brush.opacityJitter)
    /** Perpendicular offset is computed against the local tangent → "scatter" is along the normal. */
    const perpAngle = ((here.angle + 90) * Math.PI) / 180
    const x = here.x + Math.cos(perpAngle) * scatter
    const y = here.y + Math.sin(perpAngle) * scatter
    const baseAngle = brush.orient === 'tangent' ? here.angle : 0
    const finalScale = Math.max(0.05, brush.scale * scaleJitter)
    const finalAlpha = Math.max(0, Math.min(1, brush.opacity * opacityJitter))
    out.push({
      x,
      y,
      rotation: baseAngle + rotJitter,
      scale: finalScale,
      alpha: finalAlpha,
      index: i
    })
    i += 1
  }
  return out
}

/**
 * Resolve the colour each stamp should be filled with, falling back to the
 * host element's stroke/fill (depending on preset role) when the brush itself
 * doesn't pin a colour.
 */
export function resolveStampColor(
  brush: TextureBrush,
  hostAttrs: Record<string, unknown>
): string {
  if (brush.color && brush.color.trim().length > 0) return brush.color
  const preset = getTextureBrushPreset(brush.preset)
  const primary = hostAttrs[preset.colorRole]
  if (typeof primary === 'string' && primary !== 'none' && primary.trim().length > 0) {
    return primary
  }
  /** Final fallback so the stamp is at least visible against a dark canvas. */
  return '#222831'
}
