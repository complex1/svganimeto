import type { MultiPolygon, Polygon } from 'polygon-clipping'
import { difference } from '@/engines/geometry/polygonClippingApi'
import type { VectorElement } from '@/types/document'
import {
  elementToWorldMultiPolygon,
  multiPolygonToPathD,
  vectorElementLocalPathD
} from '@/engines/geometry/pathBooleanEngine'
import { multiplyWorldMatrices } from '@/engines/geometry/svgWorldTransform'
import { transformMultiPolygonWithMatrix } from '@/engines/geometry/transformMultiPolygon'
import { findAncestorChain } from '@/engines/document/tree'

const BOOLEAN_TYPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline'
])

function pathAttrsFromShape(el: VectorElement, d: string): Record<string, string | number | boolean> {
  const stroke = typeof el.attrs.stroke === 'string' ? el.attrs.stroke : '#5b8def'
  const sw = el.attrs['stroke-width']
  const strokeW = typeof sw === 'number' ? sw : Number(sw ?? 2)
  const fill =
    typeof el.attrs.fill === 'string'
      ? el.attrs.fill
      : el.type === 'line'
        ? 'none'
        : '#d1d5db'
  return {
    d,
    fill,
    stroke,
    'stroke-width': strokeW,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'fill-rule': 'evenodd'
  }
}

function eraseNode(
  roots: VectorElement[],
  el: VectorElement,
  clip: Polygon
): VectorElement | null {
  if (!BOOLEAN_TYPES.has(el.type)) {
    if (el.type === 'group' && el.children?.length) {
      const nextKids = el.children
        .map((c) => eraseNode(roots, c, clip))
        .filter((x): x is VectorElement => Boolean(x))
      if (nextKids.length === 0) return null
      return { ...el, children: nextKids }
    }
    return el
  }

  const d0 = vectorElementLocalPathD(el)
  if (!d0?.trim()) return el

  const chain = findAncestorChain(roots, el.id)
  if (!chain) return el
  const world = multiplyWorldMatrices(chain.map((n) => n.transform))

  const mp = elementToWorldMultiPolygon(el, world)
  if (!mp || mp.length === 0) return el

  const after = difference(mp, clip)
  if (!after.length) return null

  let inv: DOMMatrix
  try {
    inv = world.inverse()
  } catch {
    return el
  }

  const localMp = transformMultiPolygonWithMatrix(after, inv)
  const newD = multiPolygonToPathD(localMp)
  if (!newD) return null

  return {
    ...el,
    type: 'path',
    name: el.name.startsWith('Erased') ? el.name : `${el.name}`,
    attrs: {
      ...pathAttrsFromShape(el, newD),
      __pathClosed: true
    }
  }
}

/** Subtract clip polygon (world / SVG coords) from geometry in the tree. */
export function applyEraserClipToTree(roots: VectorElement[], clipRingWorld: MultiPolygon): VectorElement[] {
  if (!clipRingWorld.length) return roots
  const clip: Polygon = clipRingWorld[0]
  return roots
    .map((el) => eraseNode(roots, el, clip))
    .filter((x): x is VectorElement => Boolean(x))
}
