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

function quadSmoothPath(pts: Vec2[]): string | null {
  if (pts.length < 2) return null
  if (pts.length === 2) {
    return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)} L ${fmt(pts[1].x)} ${fmt(pts[1].y)}`
  }
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i += 1) {
    const xc = (pts[i].x + pts[i + 1].x) / 2
    const yc = (pts[i].y + pts[i + 1].y) / 2
    d += ` Q ${fmt(pts[i].x)} ${fmt(pts[i].y)} ${fmt(xc)} ${fmt(yc)}`
  }
  const last = pts[pts.length - 1]
  d += ` Q ${fmt(last.x)} ${fmt(last.y)} ${fmt(last.x)} ${fmt(last.y)}`
  return d
}

function fmt(n: number) {
  return Number(n.toFixed(2))
}

/**
 * Raw tablet samples → smoothed open SVG path `d` (stroke-only friendly).
 * `smoothing` is 0–1 (higher = softer line, more Chaikin / averaging).
 */
export function buildPencilPathD(raw: Vec2[], smoothing: number): string | null {
  if (raw.length < 2) return null
  const t = Math.max(0, Math.min(1, smoothing))
  let pts = raw
  pts = movingAverage(pts, Math.round(1 + t * 10))
  pts = chaikinOpen(pts, t > 0.2 ? (t > 0.55 ? 2 : 1) : 0)
  pts = rdp(pts, 0.35 + t * 4)
  return quadSmoothPath(pts)
}
