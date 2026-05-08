import type { MultiPolygon, Pair } from 'polygon-clipping'
import { transformPointMatrix } from '@/engines/geometry/svgWorldTransform'

export function transformMultiPolygonWithMatrix(mp: MultiPolygon, m: DOMMatrix): MultiPolygon {
  return mp.map((poly) =>
    poly.map((ring) =>
      ring.map(([x, y]) => {
        const p = transformPointMatrix(m, x, y)
        return [p.x, p.y] as Pair
      })
    )
  )
}
