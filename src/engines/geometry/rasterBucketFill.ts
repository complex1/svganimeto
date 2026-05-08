import { exportStillFrameSvg } from '@/engines/export/exportSvg'
import type { AnimationTrack } from '@/types/animation'
import type { Project } from '@/types/document'

type Pt = { x: number; y: number }

const MAX_RASTER_SIDE = 1400
const MAX_FILL_PIXELS = 900_000

function snapScale(pw: number, ph: number): { rw: number; rh: number; scale: number } {
  const m = Math.max(pw, ph)
  const scale = m > MAX_RASTER_SIDE ? MAX_RASTER_SIDE / m : 1
  const rw = Math.max(1, Math.round(pw * scale))
  const rh = Math.max(1, Math.round(ph * scale))
  return { rw, rh, scale }
}

export async function rasterizeStillFrameToImageData(
  project: Project,
  tracks: AnimationTrack[],
  timeSec: number,
  rw: number,
  rh: number
): Promise<ImageData> {
  const svg = exportStillFrameSvg(project, tracks, timeSec)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = rw
    canvas.height = rh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    ctx.drawImage(img, 0, 0, rw, rh)
    return ctx.getImageData(0, 0, rw, rh)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function colorMatch(
  data: Uint8ClampedArray,
  i: number,
  seed: number,
  tolSq: number
): boolean {
  return colorDistanceSq(data, i, seed) <= tolSq
}

function colorDistanceSq(data: Uint8ClampedArray, i: number, seed: number): number {
  const dr = data[i]! - data[seed]!
  const dg = data[i + 1]! - data[seed + 1]!
  const db = data[i + 2]! - data[seed + 2]!
  const da = data[i + 3]! - data[seed + 3]!
  return dr * dr + dg * dg + db * db + da * da * 0.25
}

function lumaAt(data: Uint8ClampedArray, i: number): number {
  return data[i]! * 0.2126 + data[i + 1]! * 0.7152 + data[i + 2]! * 0.0722
}

function edgeAwareExpandMask(
  filled: Uint8Array,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  seed: number,
  toleranceRgb: number,
  startCount: number
) {
  let count = startCount
  const growTolSq = toleranceRgb * toleranceRgb * 10 + 144
  const maxLumaDrop = Math.max(14, toleranceRgb * 2.5)
  const seedLuma = lumaAt(rgba, seed)
  const toFill = new Uint8Array(w * h)

  const shouldInclude = (p: number) => {
    const pi = p * 4
    if (colorDistanceSq(rgba, pi, seed) > growTolSq) return false
    return seedLuma - lumaAt(rgba, pi) <= maxLumaDrop
  }

  for (let step = 0; step < 2; step += 1) {
    let any = false
    toFill.fill(0)
    for (let p = 0; p < filled.length; p += 1) {
      if (!filled[p]) continue
      const x = p % w
      const y = (p / w) | 0
      const n1 = x > 0 ? p - 1 : -1
      const n2 = x + 1 < w ? p + 1 : -1
      const n3 = y > 0 ? p - w : -1
      const n4 = y + 1 < h ? p + w : -1
      const n5 = x > 0 && y > 0 ? p - w - 1 : -1
      const n6 = x + 1 < w && y > 0 ? p - w + 1 : -1
      const n7 = x > 0 && y + 1 < h ? p + w - 1 : -1
      const n8 = x + 1 < w && y + 1 < h ? p + w + 1 : -1
      for (const n of [n1, n2, n3, n4, n5, n6, n7, n8]) {
        if (n < 0 || filled[n] || toFill[n]) continue
        if (!shouldInclude(n)) continue
        toFill[n] = 1
        any = true
      }
    }
    if (!any) break
    for (let p = 0; p < toFill.length; p += 1) {
      if (!toFill[p]) continue
      filled[p] = 1
      count += 1
      if (count > MAX_FILL_PIXELS) return
    }
  }
}

/**
 * Stack-based flood fill (depth-first traversal without recursion).
 * 4-connected so narrow diagonal gaps don't leak across corners.
 */
export function floodFillMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  toleranceRgb: number
): Uint8Array | null {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
  const seedIdx = sy * w + sx
  const seed = seedIdx * 4
  const tolSq = toleranceRgb * toleranceRgb * 4

  const filled = new Uint8Array(w * h)
  if (!colorMatch(rgba, seed, seed, tolSq)) return null

  const stack: number[] = [seedIdx]
  let count = 0

  while (stack.length) {
    const p = stack.pop()!
    if (filled[p]) continue
    const pi = p * 4
    if (!colorMatch(rgba, pi, seed, tolSq)) continue

    filled[p] = 1
    count += 1
    if (count > MAX_FILL_PIXELS) return null

    const x = p % w
    const y = (p / w) | 0
    if (x > 0 && !filled[p - 1]) stack.push(p - 1)
    if (x + 1 < w && !filled[p + 1]) stack.push(p + 1)
    if (y > 0 && !filled[p - w]) stack.push(p - w)
    if (y + 1 < h && !filled[p + w]) stack.push(p + w)
  }

  if (count < 8) return null
  edgeAwareExpandMask(filled, rgba, w, h, seed, toleranceRgb, count)
  return filled
}

function cellSegments(
  a: boolean,
  b: boolean,
  c: boolean,
  d: boolean,
  bx: number,
  by: number
): [Pt, Pt][] {
  const e: Pt[] = []
  if (a !== b) e.push({ x: bx + 0.5, y: by })
  if (b !== c) e.push({ x: bx + 1, y: by + 0.5 })
  if (c !== d) e.push({ x: bx + 0.5, y: by + 1 })
  if (d !== a) e.push({ x: bx, y: by + 0.5 })

  if (e.length === 0) return []
  if (e.length === 2) return [[e[0]!, e[1]!]]
  if (e.length === 4) {
    if (a === c) return [
      [e[0]!, e[1]!],
      [e[2]!, e[3]!]
    ]
    return [
      [e[0]!, e[3]!],
      [e[1]!, e[2]!]
    ]
  }
  return []
}

function pk(p: Pt): string {
  return `${Math.round(p.x * 1024)}:${Math.round(p.y * 1024)}`
}

/** Merge marching-squares segments into closed polylines. */
function stitchSegments(segments: [Pt, Pt][]): Pt[][] {
  const edgeKeyPair = (a: Pt, b: Pt): string => {
    const aa = pk(a)
    const bb = pk(b)
    return aa < bb ? `${aa}~${bb}` : `${bb}~${aa}`
  }

  const at = new Map<string, Pt[]>()
  const addHalf = (from: Pt, to: Pt) => {
    const fk = pk(from)
    const arr = at.get(fk) ?? []
    arr.push(to)
    at.set(fk, arr)
  }

  const usedEdges = new Set<string>()
  for (const [p, q] of segments) {
    addHalf(p, q)
    addHalf(q, p)
  }

  const loops: Pt[][] = []
  const maxSteps = segments.length * 12 + 200

  for (const startSeg of segments) {
    const seg = startSeg as [Pt, Pt]
    let cur = seg[0]!
    const prevNode = seg[1]!
    const starter = edgeKeyPair(cur, prevNode)
    if (usedEdges.has(starter)) continue

    const loop: Pt[] = [cur]
    let prev = cur
    cur = prevNode

    let steps = 0
    while (steps++ < maxSteps) {
      const ek = edgeKeyPair(prev, cur)
      usedEdges.add(ek)
      loop.push(cur)

      const hubs = at.get(pk(cur)) ?? []
      let next: Pt | null = null
      for (const h of hubs) {
        if (pk(h) === pk(prev)) continue
        const e2 = edgeKeyPair(cur, h)
        if (usedEdges.has(e2)) continue
        next = h
        break
      }
      if (!next) break
      if (loop.length > 2 && distSq(next, loop[0]!) < 1e-8) {
        loops.push(loop)
        break
      }
      prev = cur
      cur = next
    }
  }

  const seen = new Set<string>()
  return loops.filter((l) => {
    const k = loopKey(l)
    if (seen.has(k) || l.length < 4) return false
    seen.add(k)
    return true
  })
}

function loopKey(loop: Pt[]): string {
  if (!loop.length) return ''
  const imin = loop.reduce((b, _, i, a) => (pk(a[i]!) < pk(a[b]!) ? i : b), 0)
  const rotated = [...loop.slice(imin), ...loop.slice(0, imin)]
  return rotated.map((p) => pk(p)).join('|')
}

function marchingSquareLoops(mask: Uint8Array, w: number, h: number): Pt[][] {
  const segments: [Pt, Pt][] = []
  for (let j = 0; j < h - 1; j += 1) {
    const row = j * w
    for (let i = 0; i < w - 1; i += 1) {
      const a = !!(mask[row + i])
      const b = !!(mask[row + i + 1])
      const c = !!(mask[row + i + w + 1])
      const d = !!(mask[row + i + w])
      for (const s of cellSegments(a, b, c, d, i, j)) {
        segments.push(s)
      }
    }
  }
  return stitchSegments(segments)
}

function distSq(a: Pt, b: Pt): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function douglasPeucker(pts: Pt[], epsSq: number): Pt[] {
  if (pts.length <= 3) return pts.slice()
  let im = 1
  let md = -1
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abLen2 = abx * abx + aby * aby || 1e-12
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]!
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / abLen2))
    const nx = a.x + t * abx
    const ny = a.y + t * aby
    const ds = distSq(p, { x: nx, y: ny })
    if (ds > md) {
      md = ds
      im = i
    }
  }
  if (md > epsSq) {
    const l = douglasPeucker(pts.slice(0, im + 1), epsSq)
    const r = douglasPeucker(pts.slice(im), epsSq)
    return l.slice(0, -1).concat(r)
  }
  return [a, b]
}

function loopToSvgPath(loop: Pt[], pw: number, ph: number, rw: number, rh: number, epsSvg: number): string {
  if (loop.length < 3) return ''
  const sx = pw / rw
  const sy = ph / rh
  let pts = loop.map((p) => ({ x: p.x * sx, y: p.y * sy }))
  while (pts.length > 1 && pk(pts[0]!) === pk(pts[pts.length - 1]!)) {
    pts = pts.slice(0, -1)
  }
  const chain = pts.length > 1 ? [...pts, pts[0]!] : pts
  const epsSq = (epsSvg / Math.min(sx, sy)) ** 2
  let simp = douglasPeucker(chain, epsSq)
  while (simp.length > 1 && pk(simp[0]!) === pk(simp[simp.length - 1]!)) {
    simp = simp.slice(0, -1)
  }
  if (simp.length < 3) return ''
  const fmt = (n: number) => Number(n.toFixed(2)).toString()
  let d = `M ${fmt(simp[0]!.x)} ${fmt(simp[0]!.y)}`
  for (let i = 1; i < simp.length; i += 1) {
    d += ` L ${fmt(simp[i]!.x)} ${fmt(simp[i]!.y)}`
  }
  d += ' Z'
  return d
}

export type RasterBucketFillOptions = {
  /** Max channel delta (roughly) for matching the seed; higher = fill more similar colors. */
  tolerance: number
  /** Simplification in SVG units (smaller = more detail). */
  simplifyEpsilon: number
}

/**
 * Raster snapshot → flood fill → marching squares → path `d` in project space.
 */
export async function buildFillPathFromRasterSample(
  project: Project,
  tracks: AnimationTrack[],
  timeSec: number,
  svgX: number,
  svgY: number,
  opts: RasterBucketFillOptions
): Promise<string | null> {
  const { width: pw, height: ph } = project
  const { rw, rh } = snapScale(pw, ph)
  const imgd = await rasterizeStillFrameToImageData(project, tracks, timeSec, rw, rh)
  const px = Math.max(0, Math.min(rw - 1, Math.floor((svgX / pw) * rw)))
  const py = Math.max(0, Math.min(rh - 1, Math.floor((svgY / ph) * rh)))
  const mask = floodFillMask(imgd.data, rw, rh, px, py, opts.tolerance)
  if (!mask) return null

  const loops = marchingSquareLoops(mask, rw, rh)

  let outer: Pt[] | null = null
  if (loops.length) {
    outer = loops.reduce((best, loop) =>
      polygonAreaLoop(loop) > polygonAreaLoop(best) ? loop : best,
      loops[0]!
    )
  }

  if (!outer?.length) {
    const bx = bboxOfMask(mask, rw, rh)
    if (!bx) return null
    const pad = 0.15
    const x0 = (bx.minX - pad) * (pw / rw)
    const y0 = (bx.minY - pad) * (ph / rh)
    const x1 = (bx.maxX + 1 + pad) * (pw / rw)
    const y1 = (bx.maxY + 1 + pad) * (ph / rh)
    const fmt = (n: number) => Number(n.toFixed(2)).toString()
    return `M ${fmt(x0)} ${fmt(y0)} L ${fmt(x1)} ${fmt(y0)} L ${fmt(x1)} ${fmt(y1)} L ${fmt(x0)} ${fmt(y1)} Z`
  }

  return loopToSvgPath(outer, pw, ph, rw, rh, opts.simplifyEpsilon)
}

function polygonAreaLoop(loop: Pt[]): number {
  if (loop.length < 3) return 0
  let sum = 0
  const n = loop.length
  for (let i = 0; i < n; i += 1) {
    const p = loop[i]!
    const q = loop[(i + 1) % n]!
    sum += p.x * q.y - q.x * p.y
  }
  return Math.abs(sum / 2)
}

function bboxOfMask(mask: Uint8Array, w: number, h: number) {
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < h; y += 1) {
    const r = y * w
    for (let x = 0; x < w; x += 1) {
      if (!mask[r + x]) continue
      any = true
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return any ? { minX, minY, maxX, maxY } : null
}
