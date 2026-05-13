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

function translateMatrix(x: number, y: number): DOMMatrix {
  const m = new DOMMatrix()
  m.translateSelf(x, y)
  return m
}

/** Apply a world-space affine op around a pivot point. */
export function affineAroundPivot(
  base: DOMMatrix,
  pivot: { x: number; y: number },
  op: DOMMatrix
): DOMMatrix {
  return translateMatrix(pivot.x, pivot.y)
    .multiply(op)
    .multiply(translateMatrix(-pivot.x, -pivot.y))
    .multiply(base)
}

/** Best-effort inverse of `composeSvgTransformMatrix` (skew is not recovered). */
export function decomposeSvgTransformMatrix(
  m: DOMMatrix
): Pick<Transform, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'> {
  const x = m.e
  const y = m.f
  const scaleX = Math.hypot(m.a, m.b)
  const rotation = scaleX > 1e-12 ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0
  const det = m.a * m.d - m.b * m.c
  const scaleY = scaleX > 1e-12 ? det / scaleX : 1
  return {
    x,
    y,
    rotation,
    scaleX: Math.max(0.05, Math.abs(scaleX)),
    scaleY: Math.max(0.05, Math.abs(scaleY))
  }
}

export function parentWorldMatrix(el: SVGGraphicsElement | null): DOMMatrix {
  const parent = el?.parentElement as SVGGraphicsElement | null
  if (!parent || parent.tagName.toLowerCase() === 'svg') return new DOMMatrix()
  return parent.getCTM() ?? new DOMMatrix()
}
