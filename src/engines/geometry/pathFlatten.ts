import type { Pair, Ring } from 'polygon-clipping'

/** Split `d` into subpaths that start with M/m (each may end with Z). */
export function splitPathSubpaths(d: string): string[] {
  const t = d.trim()
  if (!t) return []
  const parts = t.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : [t]
}

export function pathSubpathIsClosed(fragment: string): boolean {
  return /\s*[Zz]\s*$/.test(fragment.trim())
}

/** Sample SVG path as ordered points (world coords if matrix applied externally). */
export function samplePathDToPoints(d: string, samplesPerUnit = 0.08): { x: number; y: number }[] {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  const len = path.getTotalLength()
  if (len < 1e-6) return []
  const n = Math.max(16, Math.ceil(len * samplesPerUnit))
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i += 1) {
    const p = path.getPointAtLength((i / n) * len)
    pts.push({ x: p.x, y: p.y })
  }
  return pts
}

/** Closed ring for polygon-clipping (repeat first point at end). */
export function pointsToClosedRing(pts: { x: number; y: number }[]): Ring {
  if (pts.length < 3) {
    const p = pts[0] ?? { x: 0, y: 0 }
    return [
      [p.x, p.y],
      [p.x + 0.001, p.y],
      [p.x, p.y + 0.001],
      [p.x, p.y]
    ]
  }
  const ring: Pair[] = pts.map((p) => [p.x, p.y])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]])
  }
  return ring
}

/** Thick stroke as a simple closed ring (miter joins; good enough for eraser / open paths). */
export function strokeOutlineRing(
  pts: { x: number; y: number }[],
  strokeWidth: number
): Ring | null {
  if (pts.length < 2 || strokeWidth <= 0) return null
  const hw = strokeWidth / 2
  const left: Pair[] = []
  const right: Pair[] = []

  const normAt = (i: number): { nx: number; ny: number } => {
    let dx = 0
    let dy = 0
    if (i === 0 && pts.length > 1) {
      dx = pts[1].x - pts[0].x
      dy = pts[1].y - pts[0].y
    } else if (i === pts.length - 1) {
      dx = pts[i].x - pts[i - 1].x
      dy = pts[i].y - pts[i - 1].y
    } else {
      dx = pts[i + 1].x - pts[i - 1].x
      dy = pts[i + 1].y - pts[i - 1].y
    }
    const L = Math.hypot(dx, dy) || 1
    dx /= L
    dy /= L
    return { nx: -dy, ny: dx }
  }

  for (let i = 0; i < pts.length; i += 1) {
    const { nx, ny } = normAt(i)
    left.push([pts[i].x + nx * hw, pts[i].y + ny * hw])
    right.push([pts[i].x - nx * hw, pts[i].y - ny * hw])
  }

  const ring: Pair[] = [...left]
  for (let i = right.length - 1; i >= 0; i -= 1) {
    ring.push(right[i])
  }
  const f = ring[0]
  ring.push([f[0], f[1]])
  return ring
}
