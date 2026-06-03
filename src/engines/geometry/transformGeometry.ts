/**
 * Geometry baking: apply an affine matrix directly to an element's *points*
 * instead of stacking a `scale()` / `rotate()` transform on the wrapper `<g>`.
 *
 * This is the core of the "transforms move the path points, not a matrix"
 * behaviour. A primitive (rect/circle/ellipse/line) stays a primitive while the
 * matrix is axis-aligned (translate + non-rotated scale); the moment rotation or
 * skew is involved it is converted to a `path` whose anchors carry the rotation,
 * because an axis-aligned rect simply can't represent a rotated rectangle.
 */
import type { PathPoint, Transform, VectorElement, VectorElementType } from '@/types/document'

/** 2D affine matrix. Maps (x, y) -> (a*x + c*y + e, b*x + d*y + f). Matches DOMMatrix naming. */
export type Mat2D = { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY_MAT: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Compose two matrices: result applies `n` first, then `m` (m * n). */
export function mul(m: Mat2D, n: Mat2D): Mat2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f
  }
}

export function translateMat(tx: number, ty: number): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

/** Scale by (sx, sy) about pivot (px, py). */
export function scaleAboutMat(sx: number, sy: number, px: number, py: number): Mat2D {
  return { a: sx, b: 0, c: 0, d: sy, e: px - sx * px, f: py - sy * py }
}

/** Rotate by `deg` about pivot (px, py). */
export function rotateAboutMat(deg: number, px: number, py: number): Mat2D {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: px - cos * px + sin * py,
    f: py - sin * px - cos * py
  }
}

export function applyToPoint(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

/** Invert an affine matrix. Returns identity if singular. */
export function invertMat(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c
  if (Math.abs(det) < 1e-12) return { ...IDENTITY_MAT }
  const inv = 1 / det
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv
  }
}

/** Convert a DOMMatrix (or its 2D components) to a Mat2D. */
export function matFromDOM(m: { a: number; b: number; c: number; d: number; e: number; f: number }): Mat2D {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
}

const EPS = 1e-6

export function isIdentityMat(m: Mat2D): boolean {
  return (
    Math.abs(m.a - 1) < EPS &&
    Math.abs(m.b) < EPS &&
    Math.abs(m.c) < EPS &&
    Math.abs(m.d - 1) < EPS &&
    Math.abs(m.e) < EPS &&
    Math.abs(m.f) < EPS
  )
}

export function isPureTranslate(m: Mat2D): boolean {
  return (
    Math.abs(m.a - 1) < EPS &&
    Math.abs(m.b) < EPS &&
    Math.abs(m.c) < EPS &&
    Math.abs(m.d - 1) < EPS
  )
}

/** No rotation / skew component — only translate + axis-aligned scale. */
export function isAxisAligned(m: Mat2D): boolean {
  return Math.abs(m.b) < EPS && Math.abs(m.c) < EPS
}

/** Build the matrix the renderer applies for a Transform (translate, rotate, skew, scale). */
export function matFromTransform(t: Transform): Mat2D {
  let m = translateMat(t.x, t.y)
  if (t.rotation) m = mul(m, rotateAboutMat(t.rotation, 0, 0))
  if (t.skewX) m = mul(m, { a: 1, b: 0, c: Math.tan((t.skewX * Math.PI) / 180), d: 1, e: 0, f: 0 })
  if (t.skewY) m = mul(m, { a: 1, b: Math.tan((t.skewY * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 })
  if (t.scaleX !== 1 || t.scaleY !== 1) m = mul(m, { a: t.scaleX, b: 0, c: 0, d: t.scaleY, e: 0, f: 0 })
  return m
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function round(n: number): number {
  return Number(n.toFixed(2))
}

/* -------------------------------------------------------------------------- */
/* Path point helpers (canonical: shared with the path-edit tooling)           */
/* -------------------------------------------------------------------------- */

/**
 * Parse a `d` made of M / L / C / Z commands (absolute or relative) into the
 * editable `PathPoint[]` representation. Returns null for paths we can't model
 * as simple anchors (arcs, quadratics, etc.) — callers fall back to
 * {@link applyMatrixToPathD}.
 */
export function parsePathDToPoints(d: string): { points: PathPoint[]; closed: boolean } | null {
  if (!d.trim()) return null
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens || tokens.length === 0) return null
  const points: PathPoint[] = []
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let closed = false
  const readNum = () => {
    const t = tokens[i]
    if (t === undefined) return null
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    i += 1
    return n
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t
      i += 1
      if (cmd === 'Z' || cmd === 'z') closed = true
      continue
    }
    if (!cmd) return null
    if (cmd === 'M' || cmd === 'm') {
      const x = readNum()
      const y = readNum()
      if (x === null || y === null) return null
      cx = cmd === 'm' ? cx + x : x
      cy = cmd === 'm' ? cy + y : y
      points.push({ x: cx, y: cy, mode: 'corner' })
      cmd = cmd === 'm' ? 'l' : 'L'
      continue
    }
    if (cmd === 'L' || cmd === 'l') {
      const x = readNum()
      const y = readNum()
      if (x === null || y === null) return null
      cx = cmd === 'l' ? cx + x : x
      cy = cmd === 'l' ? cy + y : y
      points.push({ x: cx, y: cy, mode: 'corner' })
      continue
    }
    if (cmd === 'C' || cmd === 'c') {
      const x1 = readNum()
      const y1 = readNum()
      const x2 = readNum()
      const y2 = readNum()
      const x = readNum()
      const y = readNum()
      if ([x1, y1, x2, y2, x, y].some((v) => v === null)) return null
      const cp1x = cmd === 'c' ? cx + (x1 as number) : (x1 as number)
      const cp1y = cmd === 'c' ? cy + (y1 as number) : (y1 as number)
      const cp2x = cmd === 'c' ? cx + (x2 as number) : (x2 as number)
      const cp2y = cmd === 'c' ? cy + (y2 as number) : (y2 as number)
      cx = cmd === 'c' ? cx + (x as number) : (x as number)
      cy = cmd === 'c' ? cy + (y as number) : (y as number)
      if (points.length > 0) {
        const prev = points[points.length - 1]
        prev.outX = cp1x
        prev.outY = cp1y
      }
      points.push({ x: cx, y: cy, inX: cp2x, inY: cp2y, mode: 'asymmetric' })
      continue
    }
    return null
  }
  if (points.length < 2) return null
  return { points, closed }
}

/** Serialize editable anchors to a cubic `d` string. */
export function pathDFromPoints(points: PathPoint[], closePath = false): string {
  if (points.length < 2) return ''
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]
    const cp1x = prev.outX
    const cp1y = prev.outY
    const cp2x = cur.inX
    const cp2y = cur.inY
    if (
      typeof cp1x === 'number' &&
      typeof cp1y === 'number' &&
      typeof cp2x === 'number' &&
      typeof cp2y === 'number'
    ) {
      d += ` C ${round(cp1x)} ${round(cp1y)} ${round(cp2x)} ${round(cp2y)} ${round(cur.x)} ${round(cur.y)}`
    } else {
      d += ` L ${round(cur.x)} ${round(cur.y)}`
    }
  }
  if (closePath) {
    const last = points[points.length - 1]
    const first = points[0]
    if (
      typeof last.outX === 'number' &&
      typeof last.outY === 'number' &&
      typeof first.inX === 'number' &&
      typeof first.inY === 'number'
    ) {
      d += ` C ${round(last.outX)} ${round(last.outY)} ${round(first.inX)} ${round(first.inY)} ${round(first.x)} ${round(first.y)}`
    } else {
      d += ` L ${round(first.x)} ${round(first.y)}`
    }
    return `${d} Z`
  }
  return d
}

/** Transform every anchor + handle of an anchor list by a matrix. */
export function applyMatrixToPoints(points: PathPoint[], m: Mat2D): PathPoint[] {
  return points.map((p) => {
    const main = applyToPoint(m, p.x, p.y)
    const out: PathPoint = { ...p, x: main.x, y: main.y }
    if (typeof p.inX === 'number' && typeof p.inY === 'number') {
      const t = applyToPoint(m, p.inX, p.inY)
      out.inX = t.x
      out.inY = t.y
    }
    if (typeof p.outX === 'number' && typeof p.outY === 'number') {
      const t = applyToPoint(m, p.outX, p.outY)
      out.outX = t.x
      out.outY = t.y
    }
    return out
  })
}

/* -------------------------------------------------------------------------- */
/* General `d` transform (fallback for arcs / quadratics from imported SVG)    */
/* -------------------------------------------------------------------------- */

/** Convert one SVG arc segment to one-or-more cubic Bézier segments. */
function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): number[][] {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]]
  const phi = (phiDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy
  let rxAbs = Math.abs(rx)
  let ryAbs = Math.abs(ry)
  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rxAbs *= s
    ryAbs *= s
  }
  const sign = largeArc !== sweep ? 1 : -1
  const num = rxAbs * rxAbs * ryAbs * ryAbs - rxAbs * rxAbs * y1p * y1p - ryAbs * ryAbs * x1p * x1p
  const den = rxAbs * rxAbs * y1p * y1p + ryAbs * ryAbs * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * (rxAbs * y1p)) / ryAbs
  const cyp = (co * -(ryAbs * x1p)) / rxAbs
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs)
  let dTheta = angle((x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs, (-x1p - cxp) / rxAbs, (-y1p - cyp) / ryAbs)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI
  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)))
  const result: number[][] = []
  const delta = dTheta / segs
  const tHandle = (4 / 3) * Math.tan(delta / 4)
  let startAngle = theta1
  let px = x1
  let py = y1
  for (let i = 0; i < segs; i += 1) {
    const endAngle = startAngle + delta
    const cosA1 = Math.cos(startAngle)
    const sinA1 = Math.sin(startAngle)
    const cosA2 = Math.cos(endAngle)
    const sinA2 = Math.sin(endAngle)
    const ex = cx + cosPhi * rxAbs * cosA2 - sinPhi * ryAbs * sinA2
    const ey = cy + sinPhi * rxAbs * cosA2 + cosPhi * ryAbs * sinA2
    const dx1 = -rxAbs * cosPhi * sinA1 - ryAbs * sinPhi * cosA1
    const dy1 = -rxAbs * sinPhi * sinA1 + ryAbs * cosPhi * cosA1
    const dx2 = -rxAbs * cosPhi * sinA2 - ryAbs * sinPhi * cosA2
    const dy2 = -rxAbs * sinPhi * sinA2 + ryAbs * cosPhi * cosA2
    result.push([px + dx1 * tHandle, py + dy1 * tHandle, ex - dx2 * tHandle, ey - dy2 * tHandle, ex, ey])
    px = ex
    py = ey
    startAngle = endAngle
  }
  return result
}

/**
 * Transform an arbitrary `d` string by a matrix. Handles M/L/H/V/C/S/Q/T/A/Z,
 * normalising everything to absolute M/L/C/Z so the result is exact even under
 * rotation/skew. Used as a fallback when a path can't be modelled as anchors.
 */
export function applyMatrixToPathD(d: string, m: Mat2D): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens) return d
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevCtrlX = 0
  let prevCtrlY = 0
  let prevCmd = ''
  const out: string[] = []
  const rd = () => {
    const n = Number(tokens[i])
    i += 1
    return Number.isFinite(n) ? n : 0
  }
  const emitMove = (x: number, y: number) => {
    const p = applyToPoint(m, x, y)
    out.push(`M ${round(p.x)} ${round(p.y)}`)
  }
  const emitLine = (x: number, y: number) => {
    const p = applyToPoint(m, x, y)
    out.push(`L ${round(p.x)} ${round(p.y)}`)
  }
  const emitCubic = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    const a = applyToPoint(m, c1x, c1y)
    const b = applyToPoint(m, c2x, c2y)
    const e = applyToPoint(m, x, y)
    out.push(`C ${round(a.x)} ${round(a.y)} ${round(b.x)} ${round(b.y)} ${round(e.x)} ${round(e.y)}`)
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t
      i += 1
      if (cmd === 'Z' || cmd === 'z') {
        out.push('Z')
        cx = sx
        cy = sy
        prevCmd = 'Z'
      }
      continue
    }
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    if (C === 'M') {
      let x = rd()
      let y = rd()
      if (rel) {
        x += cx
        y += cy
      }
      cx = x
      cy = y
      sx = x
      sy = y
      emitMove(x, y)
      cmd = rel ? 'l' : 'L'
    } else if (C === 'L') {
      let x = rd()
      let y = rd()
      if (rel) {
        x += cx
        y += cy
      }
      cx = x
      cy = y
      emitLine(x, y)
    } else if (C === 'H') {
      let x = rd()
      if (rel) x += cx
      cx = x
      emitLine(cx, cy)
    } else if (C === 'V') {
      let y = rd()
      if (rel) y += cy
      cy = y
      emitLine(cx, cy)
    } else if (C === 'C') {
      let c1x = rd()
      let c1y = rd()
      let c2x = rd()
      let c2y = rd()
      let x = rd()
      let y = rd()
      if (rel) {
        c1x += cx
        c1y += cy
        c2x += cx
        c2y += cy
        x += cx
        y += cy
      }
      emitCubic(c1x, c1y, c2x, c2y, x, y)
      prevCtrlX = c2x
      prevCtrlY = c2y
      cx = x
      cy = y
    } else if (C === 'S') {
      let c2x = rd()
      let c2y = rd()
      let x = rd()
      let y = rd()
      if (rel) {
        c2x += cx
        c2y += cy
        x += cx
        y += cy
      }
      const c1x = prevCmd === 'C' || prevCmd === 'S' ? 2 * cx - prevCtrlX : cx
      const c1y = prevCmd === 'C' || prevCmd === 'S' ? 2 * cy - prevCtrlY : cy
      emitCubic(c1x, c1y, c2x, c2y, x, y)
      prevCtrlX = c2x
      prevCtrlY = c2y
      cx = x
      cy = y
    } else if (C === 'Q') {
      let qx = rd()
      let qy = rd()
      let x = rd()
      let y = rd()
      if (rel) {
        qx += cx
        qy += cy
        x += cx
        y += cy
      }
      const c1x = cx + (2 / 3) * (qx - cx)
      const c1y = cy + (2 / 3) * (qy - cy)
      const c2x = x + (2 / 3) * (qx - x)
      const c2y = y + (2 / 3) * (qy - y)
      emitCubic(c1x, c1y, c2x, c2y, x, y)
      prevCtrlX = qx
      prevCtrlY = qy
      cx = x
      cy = y
    } else if (C === 'T') {
      let x = rd()
      let y = rd()
      if (rel) {
        x += cx
        y += cy
      }
      const qx = prevCmd === 'Q' || prevCmd === 'T' ? 2 * cx - prevCtrlX : cx
      const qy = prevCmd === 'Q' || prevCmd === 'T' ? 2 * cy - prevCtrlY : cy
      const c1x = cx + (2 / 3) * (qx - cx)
      const c1y = cy + (2 / 3) * (qy - cy)
      const c2x = x + (2 / 3) * (qx - x)
      const c2y = y + (2 / 3) * (qy - y)
      emitCubic(c1x, c1y, c2x, c2y, x, y)
      prevCtrlX = qx
      prevCtrlY = qy
      cx = x
      cy = y
    } else if (C === 'A') {
      const rx = rd()
      const ry = rd()
      const rot = rd()
      const laf = rd()
      const sf = rd()
      let x = rd()
      let y = rd()
      if (rel) {
        x += cx
        y += cy
      }
      const cubics = arcToCubics(cx, cy, rx, ry, rot, laf, sf, x, y)
      for (const seg of cubics) emitCubic(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5])
      cx = x
      cy = y
    } else {
      i += 1
    }
    prevCmd = C
  }
  return out.join(' ')
}

/* -------------------------------------------------------------------------- */
/* Primitive -> editable anchors                                               */
/* -------------------------------------------------------------------------- */

const K = 0.5522847498307936

function ellipseAnchors(cx: number, cy: number, rx: number, ry: number): PathPoint[] {
  const ox = rx * K
  const oy = ry * K
  return [
    { x: cx - rx, y: cy, inX: cx - rx, inY: cy + oy, outX: cx - rx, outY: cy - oy, mode: 'symmetric' },
    { x: cx, y: cy - ry, inX: cx - ox, inY: cy - ry, outX: cx + ox, outY: cy - ry, mode: 'symmetric' },
    { x: cx + rx, y: cy, inX: cx + rx, inY: cy - oy, outX: cx + rx, outY: cy + oy, mode: 'symmetric' },
    { x: cx, y: cy + ry, inX: cx + ox, inY: cy + ry, outX: cx - ox, outY: cy + ry, mode: 'symmetric' }
  ]
}

function parsePointList(input: string): PathPoint[] {
  const nums = input
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
  const pts: PathPoint[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1], mode: 'corner' })
  return pts
}

function pointsAttrFromAnchors(points: PathPoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

/** Anchors describing an element's current geometry (local space), or null. */
function elementToAnchors(el: VectorElement): { points: PathPoint[]; closed: boolean } | null {
  const a = el.attrs
  switch (el.type) {
    case 'rect': {
      const x = num(a.x)
      const y = num(a.y)
      const w = num(a.width)
      const h = num(a.height)
      if (w <= 0 || h <= 0) return null
      return {
        points: [
          { x, y, mode: 'corner' },
          { x: x + w, y, mode: 'corner' },
          { x: x + w, y: y + h, mode: 'corner' },
          { x, y: y + h, mode: 'corner' }
        ],
        closed: true
      }
    }
    case 'circle': {
      const r = num(a.r)
      if (r <= 0) return null
      return { points: ellipseAnchors(num(a.cx), num(a.cy), r, r), closed: true }
    }
    case 'ellipse': {
      const rx = num(a.rx)
      const ry = num(a.ry)
      if (rx <= 0 || ry <= 0) return null
      return { points: ellipseAnchors(num(a.cx), num(a.cy), rx, ry), closed: true }
    }
    case 'line':
      return {
        points: [
          { x: num(a.x1), y: num(a.y1), mode: 'corner' },
          { x: num(a.x2), y: num(a.y2), mode: 'corner' }
        ],
        closed: false
      }
    case 'polygon':
    case 'polyline': {
      const pts = parsePointList(String(a.points ?? ''))
      if (pts.length < 2) return null
      return { points: pts, closed: el.type === 'polygon' }
    }
    case 'path': {
      if (Array.isArray(a.__pathPoints) && (a.__pathPoints as PathPoint[]).length >= 2) {
        const pts = a.__pathPoints as PathPoint[]
        const d = typeof a.d === 'string' ? a.d : ''
        return { points: pts.map((p) => ({ ...p })), closed: /z\s*$/i.test(d.trim()) }
      }
      const parsed = typeof a.d === 'string' ? parsePathDToPoints(a.d) : null
      return parsed
    }
    default:
      return null
  }
}

/** Presentation attributes to carry over when converting a shape to a path. */
export function carryGeometryStyleAttrs(attrs: VectorElement['attrs']): VectorElement['attrs'] {
  const drop = new Set([
    'x',
    'y',
    'width',
    'height',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
    'd',
    '__pathPoints'
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (!drop.has(k)) out[k] = v
  }
  return out as VectorElement['attrs']
}

export const POINT_BAKE_TYPES: VectorElementType[] = [
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline'
]

/** True when geometry baking applies to this element type (Tier A). */
export function isPointBakeType(type: VectorElementType): boolean {
  return POINT_BAKE_TYPES.includes(type)
}

export type BakeResult = { type: VectorElementType; attrs: VectorElement['attrs'] }

/**
 * Apply a matrix (already expressed in the element's local space) to its
 * geometry. Returns the new `{ type, attrs }`, or null for element types that
 * have no points to move (group / text / image / symbolInstance -> Tier B).
 */
export function bakeMatrixIntoElement(el: VectorElement, m: Mat2D): BakeResult | null {
  if (!isPointBakeType(el.type)) return null
  if (isIdentityMat(m)) return { type: el.type, attrs: { ...el.attrs } }
  const a = el.attrs

  /** Axis-aligned (no rotation/skew) keeps primitives as primitives. */
  if (isAxisAligned(m)) {
    const sx = m.a
    const sy = m.d
    switch (el.type) {
      case 'rect': {
        const p0 = applyToPoint(m, num(a.x), num(a.y))
        const w = num(a.width) * sx
        const h = num(a.height) * sy
        const nx = w < 0 ? p0.x + w : p0.x
        const ny = h < 0 ? p0.y + h : p0.y
        const attrs: Record<string, unknown> = {
          ...a,
          x: round(nx),
          y: round(ny),
          width: round(Math.abs(w)),
          height: round(Math.abs(h))
        }
        if (typeof a.rx === 'number') attrs.rx = round(Math.abs(num(a.rx) * sx))
        if (typeof a.ry === 'number') attrs.ry = round(Math.abs(num(a.ry) * sy))
        return { type: 'rect', attrs: attrs as VectorElement['attrs'] }
      }
      case 'circle': {
        const c = applyToPoint(m, num(a.cx), num(a.cy))
        const r = num(a.r)
        if (Math.abs(Math.abs(sx) - Math.abs(sy)) < EPS) {
          return {
            type: 'circle',
            attrs: { ...a, cx: round(c.x), cy: round(c.y), r: round(Math.abs(r * sx)) } as VectorElement['attrs']
          }
        }
        /** Non-uniform scale turns a circle into an ellipse. */
        const { r: _r, ...rest } = a as Record<string, unknown>
        void _r
        return {
          type: 'ellipse',
          attrs: {
            ...rest,
            cx: round(c.x),
            cy: round(c.y),
            rx: round(Math.abs(r * sx)),
            ry: round(Math.abs(r * sy))
          } as VectorElement['attrs']
        }
      }
      case 'ellipse': {
        const c = applyToPoint(m, num(a.cx), num(a.cy))
        return {
          type: 'ellipse',
          attrs: {
            ...a,
            cx: round(c.x),
            cy: round(c.y),
            rx: round(Math.abs(num(a.rx) * sx)),
            ry: round(Math.abs(num(a.ry) * sy))
          } as VectorElement['attrs']
        }
      }
      case 'line': {
        const p1 = applyToPoint(m, num(a.x1), num(a.y1))
        const p2 = applyToPoint(m, num(a.x2), num(a.y2))
        return {
          type: 'line',
          attrs: {
            ...a,
            x1: round(p1.x),
            y1: round(p1.y),
            x2: round(p2.x),
            y2: round(p2.y)
          } as VectorElement['attrs']
        }
      }
      case 'polygon':
      case 'polyline': {
        const pts = parsePointList(String(a.points ?? ''))
        if (pts.length < 2) return null
        const moved = applyMatrixToPoints(pts, m)
        return {
          type: el.type,
          attrs: { ...a, points: pointsAttrFromAnchors(moved) } as VectorElement['attrs']
        }
      }
      case 'path':
      default:
        break
    }
  }

  /** Path elements: transform anchors if we have them, else transform the raw `d`. */
  if (el.type === 'path') {
    if (Array.isArray(a.__pathPoints) && (a.__pathPoints as PathPoint[]).length >= 2) {
      const moved = applyMatrixToPoints(a.__pathPoints as PathPoint[], m)
      const closed = typeof a.d === 'string' && /z\s*$/i.test(a.d.trim())
      return {
        type: 'path',
        attrs: { ...a, __pathPoints: moved, d: pathDFromPoints(moved, closed) } as VectorElement['attrs']
      }
    }
    const d = typeof a.d === 'string' ? a.d : ''
    if (!d) return null
    return { type: 'path', attrs: { ...a, d: applyMatrixToPathD(d, m) } as VectorElement['attrs'] }
  }

  /** Rotation / skew on a primitive: convert to an editable path. */
  const anchors = elementToAnchors(el)
  if (!anchors) return null
  const moved = applyMatrixToPoints(anchors.points, m)
  const d = pathDFromPoints(moved, anchors.closed)
  return {
    type: 'path',
    attrs: { ...carryGeometryStyleAttrs(a), d, __pathPoints: moved } as VectorElement['attrs']
  }
}

/** Current geometry as a local-space `d` string (for pathD keyframes). */
export function elementGeometryToPathD(el: VectorElement): string | null {
  if (el.type === 'path') return typeof el.attrs.d === 'string' ? el.attrs.d : null
  const anchors = elementToAnchors(el)
  if (!anchors) return null
  return pathDFromPoints(anchors.points, anchors.closed)
}
