/**
 * polygon-clipping’s published ESM bundle only exposes
 * `export { index as default }` (functions live on `.default`).
 * The package typings declare named exports that don’t exist at runtime → Vite error.
 *
 * Resolve the real API from namespace or default.
 */
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import * as pcModule from 'polygon-clipping'

type Geom = Polygon | MultiPolygon

type PolygonClippingOps = {
  union: (first: Geom, ...more: Geom[]) => MultiPolygon
  intersection: (first: Geom, ...more: Geom[]) => MultiPolygon
  xor: (first: Geom, ...more: Geom[]) => MultiPolygon
  difference: (subject: Geom, ...clips: Geom[]) => MultiPolygon
}

function loadOps(): PolygonClippingOps {
  const mod = pcModule as unknown as PolygonClippingOps & { default?: PolygonClippingOps }
  if (typeof mod.difference === 'function') return mod
  const d = mod.default
  if (d && typeof d.difference === 'function') return d
  throw new Error('polygon-clipping: expected union/intersection/xor/difference API')
}

const ops = loadOps()

export const union = (first: Geom, ...more: Geom[]) => ops.union(first, ...more)
export const intersection = (first: Geom, ...more: Geom[]) => ops.intersection(first, ...more)
export const xor = (first: Geom, ...more: Geom[]) => ops.xor(first, ...more)
export const difference = (subject: Geom, ...clips: Geom[]) => ops.difference(subject, ...clips)
