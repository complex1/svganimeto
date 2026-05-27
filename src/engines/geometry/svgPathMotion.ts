/**
 * DOM-based SVG path sampling and rough morph (preview / export in renderer context).
 */

function getPathEl(): SVGPathElement | null {
  if (typeof document === 'undefined') return null
  return document.createElementNS('http://www.w3.org/2000/svg', 'path')
}

/** Point on path at normalized distance t in [0,1]. */
export function getPointOnPathAt(d: string, t: number): { x: number; y: number; angle: number } | null {
  const path = getPathEl()
  if (!path) return null
  try {
    path.setAttribute('d', d)
    const len = path.getTotalLength()
    if (!Number.isFinite(len) || len <= 0) return null
    const u = Math.max(0, Math.min(1, t))
    const dist = u * len
    const p2 = dist < len - 1e-6 ? dist + Math.min(0.5, len * 0.001) : Math.max(0, dist - 0.5)
    const p = path.getPointAtLength(dist)
    const pm = path.getPointAtLength(Math.min(p2, len))
    const angle = (Math.atan2(pm.y - p.y, pm.x - p.x) * 180) / Math.PI
    return { x: p.x, y: p.y, angle }
  } catch {
    return null
  }
}

/**
 * Centripetal Catmull–Rom to cubic Bézier segment between p1 and p2 using p0/p3 as
 * tangent neighbours. `alpha=0.5` gives the centripetal flavour, which avoids loops
 * and overshoot near sharp curvature changes.
 */
function catmullRomSegment(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  alpha = 0.5
): string {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha)
  const t01 = dist(p0, p1) || 1
  const t12 = dist(p1, p2) || 1
  const t23 = dist(p2, p3) || 1
  const m1x = (p2.x - p0.x) * (t12 / (t01 + t12))
  const m1y = (p2.y - p0.y) * (t12 / (t01 + t12))
  const m2x = (p3.x - p1.x) * (t12 / (t12 + t23))
  const m2y = (p3.y - p1.y) * (t12 / (t12 + t23))
  const c1x = p1.x + m1x / 3
  const c1y = p1.y + m1y / 3
  const c2x = p2.x - m2x / 3
  const c2y = p2.y - m2y / 3
  return `C${c1x.toFixed(3)} ${c1y.toFixed(3)} ${c2x.toFixed(3)} ${c2y.toFixed(3)} ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`
}

/**
 * Approximate morph between two path `d` strings by resampling along arc-length
 * and lerping point-by-point. Emits cubic Béziers (centripetal Catmull–Rom)
 * across the whole morph so the in-between shapes look as curvy as the
 * end-states instead of degenerating into polyline edges at intermediate t.
 */
export function morphPathDApprox(d0: string, d1: string, t: number): string | null {
  const path0 = getPathEl()
  const path1 = getPathEl()
  if (!path0 || !path1) return null
  const N = 64
  try {
    path0.setAttribute('d', d0)
    path1.setAttribute('d', d1)
    const l0 = path0.getTotalLength()
    const l1 = path1.getTotalLength()
    if (!Number.isFinite(l0) || !Number.isFinite(l1) || l0 <= 0 || l1 <= 0) return null
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const p0 = path0.getPointAtLength(u * l0)
      const p1 = path1.getPointAtLength(u * l1)
      pts.push({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t
      })
    }
    if (pts.length < 2) return null
    const closed = Math.hypot(pts[0].x - pts[N].x, pts[0].y - pts[N].y) < 0.5
    const get = (idx: number) => {
      if (closed) return pts[((idx % N) + N) % N]
      return pts[Math.max(0, Math.min(N, idx))]
    }
    const out: string[] = [`M${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)}`]
    for (let i = 0; i < N; i++) {
      out.push(catmullRomSegment(get(i - 1), get(i), get(i + 1), get(i + 2)))
    }
    if (closed) out.push('Z')
    return out.join(' ')
  } catch {
    return null
  }
}
