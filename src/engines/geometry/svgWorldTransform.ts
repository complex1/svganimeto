import type { Transform } from '@/types/document'

/** Matches `transformToSvgString` composition order for DOMMatrix. */
export function composeSvgTransformMatrix(t: Transform): DOMMatrix {
  const m = new DOMMatrix()
  m.translateSelf(t.x, t.y)
  m.rotateSelf(t.rotation)
  if (t.skewX !== 0) m.skewXSelf(t.skewX)
  if (t.skewY !== 0) m.skewYSelf(t.skewY)
  m.scaleSelf(t.scaleX, t.scaleY)
  return m
}

export function multiplyWorldMatrices(chain: Transform[]): DOMMatrix {
  let acc = new DOMMatrix()
  for (const tr of chain) {
    acc = acc.multiply(composeSvgTransformMatrix(tr))
  }
  return acc
}

export function transformPointMatrix(m: DOMMatrix, x: number, y: number): { x: number; y: number } {
  const p = new DOMPoint(x, y).matrixTransform(m)
  return { x: p.x, y: p.y }
}
