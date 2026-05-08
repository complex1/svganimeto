import type { MultiPolygon, Pair, Polygon } from 'polygon-clipping'

/** Ray-cast; `ring` closed (explicit edge from second-to-last to last, last equals first). */
export function pointInRing(x: number, y: number, ring: Pair[]): boolean {
  const n = ring.length
  if (n < 4) return false
  let inside = false
  for (let i = 0; i < n - 1; i += 1) {
    const xi = ring[i]![0]
    const yi = ring[i]![1]
    const xj = ring[i + 1]![0]
    const yj = ring[i + 1]![1]
    const denom = yj - yi
    const inter =
      yi !== yj && (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (denom + 1e-18) + xi
    if (inter) inside = !inside
  }
  return inside
}

export function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  if (poly.length === 0) return false
  const outer = poly[0]
  if (!outer || !pointInRing(x, y, outer)) return false
  for (let h = 1; h < poly.length; h++) {
    const hole = poly[h]
    if (hole && pointInRing(x, y, hole)) return false
  }
  return true
}

export function pointInMultiPolygon(x: number, y: number, mp: MultiPolygon): boolean {
  for (const poly of mp) {
    if (pointInPolygon(x, y, poly)) return true
  }
  return false
}
