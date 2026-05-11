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

/** Approximate morph between two path `d` strings by sampling point count and lerping (open paths OK). */
export function morphPathDApprox(d0: string, d1: string, t: number): string | null {
  if (t <= 0) return d0
  if (t >= 1) return d1
  const path0 = getPathEl()
  const path1 = getPathEl()
  if (!path0 || !path1) return null
  const N = 48
  try {
    path0.setAttribute('d', d0)
    path1.setAttribute('d', d1)
    const l0 = path0.getTotalLength()
    const l1 = path1.getTotalLength()
    if (!Number.isFinite(l0) || !Number.isFinite(l1) || l0 <= 0 || l1 <= 0) return null
    const pts: string[] = []
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const p0 = path0.getPointAtLength(u * l0)
      const p1 = path1.getPointAtLength(u * l1)
      const x = p0.x + (p1.x - p0.x) * t
      const y = p0.y + (p1.y - p0.y) * t
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`)
    }
    return pts.join(' ')
  } catch {
    return null
  }
}
