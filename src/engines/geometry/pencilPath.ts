import type { PathPoint } from '@/types/document'

type Vec2 = { x: number; y: number }

function movingAverage(pts: Vec2[], radius: number): Vec2[] {
  if (pts.length < 3 || radius < 1) return pts
  const out: Vec2[] = []
  const r = Math.min(radius, 12)
  for (let i = 0; i < pts.length; i += 1) {
    let sx = 0
    let sy = 0
    let c = 0
    for (let j = Math.max(0, i - r); j <= Math.min(pts.length - 1, i + r); j += 1) {
      sx += pts[j].x
      sy += pts[j].y
      c += 1
    }
    out.push({ x: sx / c, y: sy / c })
  }
  return out
}

function chaikinOpen(pts: Vec2[], iters: number): Vec2[] {
  let cur = pts
  for (let k = 0; k < iters; k += 1) {
    if (cur.length < 2) return cur
    const next: Vec2[] = [cur[0]]
    for (let i = 0; i < cur.length - 1; i += 1) {
      const p = cur[i]
      const q = cur[i + 1]
      const q1 = { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 }
      const q2 = { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 }
      next.push(q1, q2)
    }
    next.push(cur[cur.length - 1])
    cur = next
  }
  return cur
}

function rdp(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length <= 2 || eps <= 0) return pts
  let idx = 0
  let dmax = 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const vv = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / vv))
    const px = a.x + vx * t
    const py = a.y + vy * t
    const d = Math.hypot(p.x - px, p.y - py)
    if (d > dmax) {
      dmax = d
      idx = i
    }
  }
  if (dmax > eps) {
    const left = rdp(pts.slice(0, idx + 1), eps)
    const right = rdp(pts.slice(idx), eps)
    return [...left.slice(0, -1), ...right]
  }
  return [a, b]
}

function fmt(n: number) {
  return Number(n.toFixed(2))
}

/**
 * Convert a smoothed polyline into editable `PathPoint[]` anchors with cubic
 * in/out handles derived from centripetal Catmull–Rom tangents. We pick
 * Catmull–Rom (alpha=0.5) because:
 *   1. It produces tangents that visually match the smooth flow the pencil
 *      already renders (so the editable representation looks identical to the
 *      preview the user just drew).
 *   2. Handles align with neighbour-chord direction, which is what an artist
 *      expects to grab when fine-tuning a freehand stroke.
 *
 * Returns `null` for inputs that can't form a usable path (<2 points).
 */
function polylineToPathPoints(pts: Vec2[]): PathPoint[] | null {
  if (pts.length < 2) return null
  const n = pts.length
  /**
   * For an OPEN polyline we reflect the endpoints inward so the start/end
   * tangents don't pin to zero (which would yield kinky handles right at the
   * mouse-down / mouse-up site).
   */
  const ghost = (idx: number): Vec2 => {
    if (idx < 0) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y }
    if (idx >= n) {
      return { x: 2 * pts[n - 1].x - pts[n - 2].x, y: 2 * pts[n - 1].y - pts[n - 2].y }
    }
    return pts[idx]
  }

  const out: PathPoint[] = pts.map((p) => ({ x: p.x, y: p.y, mode: 'asymmetric' }))

  const alpha = 0.5
  const knot = (a: Vec2, b: Vec2) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha)

  for (let i = 0; i < n - 1; i += 1) {
    const p0 = ghost(i - 1)
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = ghost(i + 2)
    const t01 = knot(p0, p1) || 1
    const t12 = knot(p1, p2) || 1
    const t23 = knot(p2, p3) || 1
    const m1x = (p2.x - p0.x) * (t12 / (t01 + t12))
    const m1y = (p2.y - p0.y) * (t12 / (t01 + t12))
    const m2x = (p3.x - p1.x) * (t12 / (t12 + t23))
    const m2y = (p3.y - p1.y) * (t12 / (t12 + t23))
    out[i].outX = p1.x + m1x / 3
    out[i].outY = p1.y + m1y / 3
    out[i + 1].inX = p2.x - m2x / 3
    out[i + 1].inY = p2.y - m2y / 3
  }

  return out
}

/**
 * Serialize `PathPoint[]` to an open cubic-Bézier `d` string. Kept in this
 * module so the pencil tool can emit a `d` that round-trips identically when
 * re-parsed by the path-edit tooling (`parsePathDToPoints` understands `M/L/C`).
 */
function pathPointsToD(points: PathPoint[]): string {
  if (points.length < 2) return ''
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]
    const haveCubic =
      typeof prev.outX === 'number' &&
      typeof prev.outY === 'number' &&
      typeof cur.inX === 'number' &&
      typeof cur.inY === 'number'
    if (haveCubic) {
      d += ` C ${fmt(prev.outX as number)} ${fmt(prev.outY as number)} ${fmt(cur.inX as number)} ${fmt(cur.inY as number)} ${fmt(cur.x)} ${fmt(cur.y)}`
    } else {
      d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`
    }
  }
  return d
}

function smoothRaw(raw: Vec2[], smoothing: number): Vec2[] {
  const t = Math.max(0, Math.min(1, smoothing))
  let pts = raw
  pts = movingAverage(pts, Math.round(1 + t * 10))
  pts = chaikinOpen(pts, t > 0.2 ? (t > 0.55 ? 2 : 1) : 0)
  pts = rdp(pts, 0.35 + t * 4)
  return pts
}

/**
 * Raw tablet samples → smoothed open SVG path + the editable anchor list that
 * produced it. Storing both lets us render the visible stroke from the `d`
 * string while the path-edit tool drives off `__pathPoints` (so anchors and
 * Bézier handles are interactive after the stroke is committed).
 */
export function buildPencilStroke(
  raw: Vec2[],
  smoothing: number
): { d: string; points: PathPoint[] } | null {
  if (raw.length < 2) return null
  const smoothed = smoothRaw(raw, smoothing)
  const points = polylineToPathPoints(smoothed)
  if (!points) return null
  const d = pathPointsToD(points)
  if (!d) return null
  return { d, points }
}

/**
 * @deprecated prefer {@link buildPencilStroke}; kept for callers that only
 * need the path data and don't care about per-anchor editing.
 */
export function buildPencilPathD(raw: Vec2[], smoothing: number): string | null {
  return buildPencilStroke(raw, smoothing)?.d ?? null
}
