import type { MultiPolygon, Polygon, Pair } from 'polygon-clipping'
import { difference, intersection, union, xor } from '@/engines/geometry/polygonClippingApi'
import type { VectorElement } from '@/types/document'
import { elementShapeToPathD } from '@/engines/geometry/shapeToPath'
import {
  pathSubpathIsClosed,
  pointsToClosedRing,
  samplePathDToPoints,
  splitPathSubpaths,
  strokeOutlineRing
} from '@/engines/geometry/pathFlatten'
import { transformPointMatrix } from '@/engines/geometry/svgWorldTransform'

export type BooleanOpKind = 'union' | 'subtract' | 'intersect' | 'xor'

function fmt(n: number) {
  return Number(n.toFixed(3))
}

export function vectorElementLocalPathD(el: VectorElement): string | null {
  if (el.type === 'path') {
    return typeof el.attrs.d === 'string' ? el.attrs.d : null
  }
  return elementShapeToPathD(el.type, el.attrs as Record<string, unknown>)
}

export function getStrokeWidth(attrs: Record<string, unknown>): number {
  const sw = attrs['stroke-width']
  if (typeof sw === 'number') return Math.max(0.01, sw)
  const n = Number(sw ?? 2)
  return Math.max(0.01, Number.isFinite(n) ? n : 2)
}

export function attributeFillIsNone(attrs: Record<string, unknown>): boolean {
  const f = attrs.fill
  if (f === undefined || f === null || f === 'none' || f === 'transparent') return true
  if (typeof f === 'string' && f.startsWith('url(')) return false
  return false
}

/** Local-space path → multipolygon, then map to world coordinates. */
export function elementToWorldMultiPolygon(el: VectorElement, worldMatrix: DOMMatrix): MultiPolygon | null {
  const d = vectorElementLocalPathD(el)
  if (!d?.trim()) return null

  const sw = getStrokeWidth(el.attrs as Record<string, unknown>)
  const fillNone = attributeFillIsNone(el.attrs as Record<string, unknown>)

  const fragments = splitPathSubpaths(d)
  const polygons: Polygon[] = []

  for (const frag of fragments) {
    const closed = pathSubpathIsClosed(frag)
    const pts = samplePathDToPoints(frag)
    if (pts.length < 2) continue

    let ring: Pair[]
    if (closed && !fillNone) {
      ring = pointsToClosedRing(pts)
    } else {
      const stroked = strokeOutlineRing(pts, sw)
      if (!stroked) continue
      ring = stroked
    }
    polygons.push([mapRingToWorld(ring, worldMatrix)])
  }

  return polygons.length ? polygons : null
}

function mapRingToWorld(ring: Pair[], m: DOMMatrix): Pair[] {
  return ring.map(([x, y]) => {
    const p = transformPointMatrix(m, x, y)
    return [p.x, p.y] as Pair
  })
}

export function booleanCombine(
  subject: MultiPolygon,
  op: BooleanOpKind,
  others: MultiPolygon[]
): MultiPolygon {
  if (others.length === 0) return subject
  if (op === 'union') {
    let acc = subject
    for (const o of others) acc = union(acc, o)
    return acc
  }
  if (op === 'intersect') {
    let acc = subject
    for (const o of others) acc = intersection(acc, o)
    return acc
  }
  if (op === 'xor') {
    let acc = subject
    for (const o of others) acc = xor(acc, o)
    return acc
  }
  let clip = others[0]
  for (let i = 1; i < others.length; i++) clip = union(clip, others[i])
  return difference(subject, clip)
}

export function multiPolygonToPathD(mp: MultiPolygon): string | null {
  if (!mp.length) return null
  const chunks: string[] = []
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) continue
      const inner = ring.slice(0, -1)
      let d = ''
      for (let i = 0; i < inner.length; i += 1) {
        const [x, y] = inner[i]
        d += i === 0 ? `M ${fmt(x)} ${fmt(y)}` : ` L ${fmt(x)} ${fmt(y)}`
      }
      d += ' Z'
      chunks.push(d)
    }
  }
  return chunks.length ? chunks.join(' ') : null
}
