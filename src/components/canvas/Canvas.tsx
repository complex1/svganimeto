import { nanoid } from 'nanoid'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { ElementRenderer } from '@/components/canvas/ElementRenderer'
import { SelectionOverlay } from '@/components/canvas/SelectionOverlay'
import { defaultTransform, type VectorElement } from '@/types/document'
import { flattenForLayers, updateElementById } from '@/engines/document/tree'
import type { DrawTool } from '@/store/editorStore'
import type { PathPoint, PathPointMode } from '@/types/document'

type BrushKind = 'solid' | 'marker' | 'texture'
type BrushSettings = {
  kind: BrushKind
  size: number
  color: string
  stability: number
  /** 0–1: distance between stamps along stroke (higher = farther apart) */
  spacing: number
  /** 0–1: random lateral scatter of each stamp */
  jitter: number
  /** 0–1: random radius / opacity variation */
  noise: number
}
type Vec2 = { x: number; y: number }
type BrushStamp = { cx: number; cy: number; r: number; opacity: number }

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function totalArcLength(poly: Vec2[]): number {
  let sum = 0
  for (let i = 1; i < poly.length; i += 1) {
    sum += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y)
  }
  return sum
}

function pointAndTangentAtArcLength(poly: Vec2[], s: number): { p: Vec2; tx: number; ty: number } {
  if (poly.length === 0) return { p: { x: 0, y: 0 }, tx: 1, ty: 0 }
  if (poly.length === 1) return { p: { ...poly[0] }, tx: 1, ty: 0 }
  let d = 0
  for (let i = 1; i < poly.length; i += 1) {
    const ax = poly[i - 1].x
    const ay = poly[i - 1].y
    const bx = poly[i].x
    const by = poly[i].y
    const seg = Math.hypot(bx - ax, by - ay)
    if (d + seg >= s - 1e-9) {
      const t = seg > 1e-9 ? (s - d) / seg : 0
      const p = lerp({ x: ax, y: ay }, { x: bx, y: by }, t)
      const tx = seg > 1e-9 ? (bx - ax) / seg : 1
      const ty = seg > 1e-9 ? (by - ay) / seg : 0
      return { p, tx, ty }
    }
    d += seg
  }
  const last = poly[poly.length - 1]
  const prev = poly[poly.length - 2]
  const seg = Math.hypot(last.x - prev.x, last.y - prev.y) || 1
  return {
    p: { ...last },
    tx: (last.x - prev.x) / seg,
    ty: (last.y - prev.y) / seg
  }
}

function brushSpacingPx(settings: BrushSettings): number {
  const t = Math.max(0.05, Math.min(0.98, settings.spacing))
  const gap = settings.size * (0.14 + t * 0.72)
  const kindMul = settings.kind === 'texture' ? 0.62 : settings.kind === 'marker' ? 0.92 : 0.88
  return Math.max(0.6, gap * kindMul)
}

function makeBrushStamp(
  p: Vec2,
  tx: number,
  ty: number,
  settings: BrushSettings,
  rand: () => number
): BrushStamp {
  const seg = Math.hypot(tx, ty) || 1
  const nx = -ty / seg
  const ny = tx / seg
  const jitterPx = settings.jitter * settings.size * 0.42
  const jAlong = (rand() - 0.5) * 2 * jitterPx * 0.25
  const jPerp = (rand() - 0.5) * 2 * jitterPx
  const cx = p.x + (tx / seg) * jAlong + nx * jPerp
  const cy = p.y + (ty / seg) * jAlong + ny * jPerp

  const rBase = settings.size / 2
  const r = Math.max(0.15, rBase * (1 + (rand() - 0.5) * 2 * settings.noise * 0.55))

  let opacity =
    settings.kind === 'marker'
      ? 0.42 + rand() * 0.38
      : settings.kind === 'texture'
        ? 0.28 + rand() * 0.52
        : 0.82 + rand() * 0.18
  opacity *= 1 - settings.noise * rand() * 0.28
  return { cx, cy, r, opacity: Math.max(0.04, Math.min(1, opacity)) }
}

function appendBrushStampsAlongStroke(stroke: {
  smooth: Vec2[]
  stamps: BrushStamp[]
  lastStampArc: number
  settings: BrushSettings
  rand: () => number
}) {
  const { smooth, settings } = stroke
  if (smooth.length < 2) return
  const L = totalArcLength(smooth)
  const spacing = brushSpacingPx(settings)
  while (stroke.lastStampArc + spacing <= L + 1e-6) {
    stroke.lastStampArc += spacing
    const { p, tx, ty } = pointAndTangentAtArcLength(smooth, stroke.lastStampArc)
    stroke.stamps.push(makeBrushStamp(p, tx, ty, settings, stroke.rand))
  }
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

function localToSvg(svg: SVGSVGElement, target: SVGGraphicsElement, x: number, y: number) {
  const targetScreen = target.getScreenCTM()
  const svgScreen = svg.getScreenCTM()
  if (!targetScreen || !svgScreen) return { x, y }
  const svgInv = svgScreen.inverse()
  const pt = svg.createSVGPoint()
  pt.x = x
  pt.y = y
  const inScreen = pt.matrixTransform(targetScreen)
  const inSvg = inScreen.matrixTransform(svgInv)
  return { x: inSvg.x, y: inSvg.y }
}

function svgToLocal(svg: SVGSVGElement, target: SVGGraphicsElement, x: number, y: number) {
  const targetScreen = target.getScreenCTM()
  const svgScreen = svg.getScreenCTM()
  if (!targetScreen || !svgScreen) return { x, y }
  const targetInv = targetScreen.inverse()
  const pt = svg.createSVGPoint()
  pt.x = x
  pt.y = y
  const inScreen = pt.matrixTransform(svgScreen)
  const inLocal = inScreen.matrixTransform(targetInv)
  return { x: inLocal.x, y: inLocal.y }
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function cubicAt(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
) {
  const q0 = lerp(p0, p1, t)
  const q1 = lerp(p1, p2, t)
  const q2 = lerp(p2, p3, t)
  const r0 = lerp(q0, q1, t)
  const r1 = lerp(q1, q2, t)
  return lerp(r0, r1, t)
}

function nearestOnLine(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  q: { x: number; y: number }
) {
  const vx = p1.x - p0.x
  const vy = p1.y - p0.y
  const vv = vx * vx + vy * vy
  if (vv < 1e-9) return { t: 0, x: p0.x, y: p0.y, dist2: (q.x - p0.x) ** 2 + (q.y - p0.y) ** 2 }
  const t = Math.max(0, Math.min(1, ((q.x - p0.x) * vx + (q.y - p0.y) * vy) / vv))
  const x = p0.x + vx * t
  const y = p0.y + vy * t
  const dx = q.x - x
  const dy = q.y - y
  return { t, x, y, dist2: dx * dx + dy * dy }
}

function nearestOnCubic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  q: { x: number; y: number }
) {
  let bestT = 0
  let best = cubicAt(p0, p1, p2, p3, 0)
  let bestDist2 = (q.x - best.x) ** 2 + (q.y - best.y) ** 2
  const steps = 60
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const p = cubicAt(p0, p1, p2, p3, t)
    const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
    if (d2 < bestDist2) {
      bestT = t
      best = p
      bestDist2 = d2
    }
  }
  return { t: bestT, x: best.x, y: best.y, dist2: bestDist2 }
}

function parsePointList(input: string) {
  const nums = input
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] })
  }
  return points
}

function rectToPathD(x: number, y: number, w: number, h: number, rx = 0, ry = 0) {
  const rrx = Math.max(0, Math.min(rx || 0, w / 2))
  const rry = Math.max(0, Math.min(ry || 0, h / 2))
  if (rrx <= 0 && rry <= 0) {
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
  }
  return [
    `M ${x + rrx} ${y}`,
    `L ${x + w - rrx} ${y}`,
    `A ${rrx} ${rry} 0 0 1 ${x + w} ${y + rry}`,
    `L ${x + w} ${y + h - rry}`,
    `A ${rrx} ${rry} 0 0 1 ${x + w - rrx} ${y + h}`,
    `L ${x + rrx} ${y + h}`,
    `A ${rrx} ${rry} 0 0 1 ${x} ${y + h - rry}`,
    `L ${x} ${y + rry}`,
    `A ${rrx} ${rry} 0 0 1 ${x + rrx} ${y}`,
    'Z'
  ].join(' ')
}

function elementShapeToPathD(type: string, attrs: Record<string, unknown>) {
  const n = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : Number(v ?? fallback))
  if (type === 'rect') {
    return rectToPathD(
      n(attrs.x),
      n(attrs.y),
      Math.max(0, n(attrs.width)),
      Math.max(0, n(attrs.height)),
      Math.max(0, n(attrs.rx)),
      Math.max(0, n(attrs.ry))
    )
  }
  if (type === 'circle') {
    const cx = n(attrs.cx)
    const cy = n(attrs.cy)
    const r = Math.max(0, n(attrs.r))
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
  }
  if (type === 'ellipse') {
    const cx = n(attrs.cx)
    const cy = n(attrs.cy)
    const rx = Math.max(0, n(attrs.rx))
    const ry = Math.max(0, n(attrs.ry))
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
  }
  if (type === 'line') {
    return `M ${n(attrs.x1)} ${n(attrs.y1)} L ${n(attrs.x2)} ${n(attrs.y2)}`
  }
  if (type === 'polygon' || type === 'polyline') {
    const pts = parsePointList(String(attrs.points ?? ''))
    if (pts.length < 2) return null
    const d = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ')
    return type === 'polygon' ? `${d} Z` : d
  }
  return null
}

function ellipseToPathPoints(cx: number, cy: number, rx: number, ry: number): PathPoint[] {
  const k = 0.5522847498307936
  const ox = rx * k
  const oy = ry * k
  return [
    {
      x: cx - rx,
      y: cy,
      inX: cx - rx,
      inY: cy + oy,
      outX: cx - rx,
      outY: cy - oy,
      mode: 'symmetric'
    },
    {
      x: cx,
      y: cy - ry,
      inX: cx - ox,
      inY: cy - ry,
      outX: cx + ox,
      outY: cy - ry,
      mode: 'symmetric'
    },
    {
      x: cx + rx,
      y: cy,
      inX: cx + rx,
      inY: cy - oy,
      outX: cx + rx,
      outY: cy + oy,
      mode: 'symmetric'
    },
    {
      x: cx,
      y: cy + ry,
      inX: cx + ox,
      inY: cy + ry,
      outX: cx - ox,
      outY: cy + ry,
      mode: 'symmetric'
    }
  ]
}

function pathDFromPoints(points: PathPoint[], closePath = false) {
  if (points.length < 2) return ''
  let d = `M ${Number(points[0].x.toFixed(2))} ${Number(points[0].y.toFixed(2))}`
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
      d += ` C ${Number(cp1x.toFixed(2))} ${Number(cp1y.toFixed(2))} ${Number(cp2x.toFixed(2))} ${Number(cp2y.toFixed(2))} ${Number(cur.x.toFixed(2))} ${Number(cur.y.toFixed(2))}`
    } else {
      d += ` L ${Number(cur.x.toFixed(2))} ${Number(cur.y.toFixed(2))}`
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
      d += ` C ${Number(last.outX.toFixed(2))} ${Number(last.outY.toFixed(2))} ${Number(first.inX.toFixed(2))} ${Number(first.inY.toFixed(2))} ${Number(first.x.toFixed(2))} ${Number(first.y.toFixed(2))}`
    } else {
      d += ` L ${Number(first.x.toFixed(2))} ${Number(first.y.toFixed(2))}`
    }
    return `${d} Z`
  }
  return d
}

function parsePathDToPoints(d: string): { points: PathPoint[]; closed: boolean } | null {
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
      if (cmd === 'Z' || cmd === 'z') {
        closed = true
      }
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

function syncOppositeHandle(
  points: PathPoint[],
  idx: number,
  moved: 'in' | 'out',
  mode: PathPointMode,
  preserveOppositeLength: boolean
) {
  const pt = points[idx]
  const anchor = { x: pt.x, y: pt.y }
  if (moved === 'out') {
    if (typeof pt.outX !== 'number' || typeof pt.outY !== 'number') return
    const vx = pt.outX - anchor.x
    const vy = pt.outY - anchor.y
    if (mode === 'symmetric') {
      pt.inX = anchor.x - vx
      pt.inY = anchor.y - vy
      return
    }
    if (mode === 'asymmetric') {
      const ivx = (pt.inX ?? anchor.x) - anchor.x
      const ivy = (pt.inY ?? anchor.y) - anchor.y
      const ilen = Math.hypot(ivx, ivy) || Math.hypot(vx, vy) || 0
      const vlen = Math.hypot(vx, vy) || 1
      const scale = preserveOppositeLength ? ilen / vlen : 1
      pt.inX = anchor.x - vx * scale
      pt.inY = anchor.y - vy * scale
    }
    return
  }
  if (typeof pt.inX !== 'number' || typeof pt.inY !== 'number') return
  const vx = pt.inX - anchor.x
  const vy = pt.inY - anchor.y
  if (mode === 'symmetric') {
    pt.outX = anchor.x - vx
    pt.outY = anchor.y - vy
    return
  }
  if (mode === 'asymmetric') {
    const ovx = (pt.outX ?? anchor.x) - anchor.x
    const ovy = (pt.outY ?? anchor.y) - anchor.y
    const olen = Math.hypot(ovx, ovy) || Math.hypot(vx, vy) || 0
    const vlen = Math.hypot(vx, vy) || 1
    const scale = preserveOppositeLength ? olen / vlen : 1
    pt.outX = anchor.x - vx * scale
    pt.outY = anchor.y - vy * scale
  }
}

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const project = useEditorStore((s) => s.project)
  const viewBox = useEditorStore((s) => s.viewBox)
  const zoom = useEditorStore((s) => s.zoom)
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const select = useEditorStore((s) => s.select)
  const addToSelection = useEditorStore((s) => s.addToSelection)
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setViewBox = useEditorStore((s) => s.setViewBox)
  const panBy = useEditorStore((s) => s.panBy)
  const mode = useEditorStore((s) => s.mode)
  const activeTool = useEditorStore((s) => s.activeTool)
  const addElement = useEditorStore((s) => s.addElement)
  const setElementAttrs = useEditorStore((s) => s.setElementAttrs)
  const setElements = useEditorStore((s) => s.setElements)
  const pushHistory = useEditorStore((s) => s.pushHistory)

  const [spaceDown, setSpaceDown] = useState(false)
  const [draft, setDraft] = useState<{
    tool: Exclude<DrawTool, 'select' | 'text' | 'pen' | 'path-edit'>
    start: { x: number; y: number }
    current: { x: number; y: number }
  } | null>(null)
  const [penDraft, setPenDraft] = useState<{
    points: PathPoint[]
    hover: { x: number; y: number } | null
  } | null>(null)
  const [pathPointMenu, setPathPointMenu] = useState<{
    pathId: string
    pointIdx: number
    left: number
    top: number
  } | null>(null)
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    kind: 'solid',
    size: 8,
    color: '#5b8def',
    stability: 0.55,
    spacing: 0.32,
    jitter: 0.28,
    noise: 0.35
  })
  const [brushPreview, setBrushPreview] = useState<{ stamps: BrushStamp[]; settings: BrushSettings } | null>(
    null
  )
  const pathPointMenuRef = useRef<HTMLDivElement | null>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)
  const lastPenCommitRef = useRef<{ d: string; at: number } | null>(null)
  const brushStrokeRef = useRef<{
    pointerId: number
    raw: Vec2[]
    smooth: Vec2[]
    stamps: BrushStamp[]
    lastStampArc: number
    settings: BrushSettings
    rand: () => number
  } | null>(null)
  const penPointerRef = useRef<{ pointerId: number; idx: number; origin: { x: number; y: number } } | null>(
    null
  )
  const pathEditDragRef = useRef<{
    kind: 'anchor' | 'in' | 'out'
    pointerId: number
    idx: number
    start: PathPoint[]
  } | null>(null)

  const commitPenPath = useCallback(
    (points: PathPoint[], closePath = false) => {
      const d = pathDFromPoints(points, closePath)
      if (!d) return
      const now = Date.now()
      const last = lastPenCommitRef.current
      if (last && last.d === d && now - last.at < 250) return
      lastPenCommitRef.current = { d, at: now }
      addElement({
        id: nanoid(10),
        name: `Path ${project.elements.length + 1}`,
        type: 'path',
        attrs: {
          d,
          __pathPoints: points,
          __pathClosed: closePath,
          fill: 'none',
          stroke: '#5b8def',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        },
        transform: defaultTransform(),
        visible: true,
        locked: false
      })
    },
    [addElement, project.elements.length]
  )

  const brushAlpha = (stability: number) => Math.max(0.08, 1 - Math.max(0, Math.min(1, stability)) * 0.9)

  const commitBrushStroke = useCallback(
    (stroke: {
      smooth: Vec2[]
      stamps: BrushStamp[]
      settings: BrushSettings
      rand: () => number
    }) => {
      let stamps = stroke.stamps
      if (stamps.length === 0 && stroke.smooth.length >= 1) {
        const p = stroke.smooth[0]
        stamps = [makeBrushStamp(p, 1, 0, stroke.settings, stroke.rand)]
      }
      if (stamps.length === 0) return

      const children: VectorElement[] = stamps.map((st, i) => ({
        id: nanoid(8),
        name: `Stamp ${i + 1}`,
        type: 'circle',
        attrs: {
          cx: Number(st.cx.toFixed(2)),
          cy: Number(st.cy.toFixed(2)),
          r: Number(st.r.toFixed(2)),
          fill: stroke.settings.color,
          opacity: Number(st.opacity.toFixed(3)),
          stroke: 'none'
        },
        transform: defaultTransform(),
        visible: true,
        locked: false
      }))

      addElement({
        id: nanoid(10),
        name: `Brush ${project.elements.length + 1}`,
        type: 'group',
        attrs: {},
        children,
        transform: defaultTransform(),
        visible: true,
        locked: false
      })
    },
    [addElement, project.elements.length]
  )

  const selectedPath = (() => {
    if (selectedIds.length !== 1) return null
    const id = selectedIds[0]
    const el = flattenForLayers(project.elements).find((x) => x.el.id === id)?.el
    if (!el || el.type !== 'path') return null
    const points = Array.isArray(el.attrs.__pathPoints)
      ? (el.attrs.__pathPoints as PathPoint[])
      : typeof el.attrs.d === 'string'
        ? parsePathDToPoints(el.attrs.d)?.points ?? null
        : null
    if (!points || points.length === 0) return null
    const closed =
      typeof el.attrs.__pathClosed === 'boolean'
        ? el.attrs.__pathClosed
        : typeof el.attrs.d === 'string'
          ? Boolean(parsePathDToPoints(el.attrs.d)?.closed)
          : false
    return { id: el.id, points, closed }
  })()
  const selectedPathNode =
    selectedPath && svgRef.current
      ? (svgRef.current.querySelector(
          `[data-el-id="${CSS.escape(selectedPath.id)}"]`
        ) as SVGGraphicsElement | null)
      : null

  useEffect(() => {
    if (activeTool !== 'pen') setPenDraft(null)
  }, [activeTool])

  useEffect(() => {
    if (activeTool !== 'brush') {
      setBrushPreview(null)
      brushStrokeRef.current = null
    }
  }, [activeTool])

  useEffect(() => {
    if (!pathPointMenu) return
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null
      if (!pathPointMenuRef.current || (target && pathPointMenuRef.current.contains(target))) return
      setPathPointMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [pathPointMenu])

  useEffect(() => {
    if (activeTool !== 'path-edit') setPathPointMenu(null)
  }, [activeTool])

  useEffect(() => {
    if (!pathPointMenu || !selectedPath || selectedPath.id !== pathPointMenu.pathId) {
      setPathPointMenu(null)
    }
  }, [pathPointMenu, selectedPath])

  const applyPointMode = (pointIdx: number, mode: PathPointMode) => {
    if (!selectedPath) return
    const points = selectedPath.points.map((p) => ({ ...p }))
    const current = points[pointIdx]
    if (!current) return
    current.mode = mode
    if (mode === 'corner') {
      delete current.inX
      delete current.inY
      delete current.outX
      delete current.outY
    } else if (mode === 'symmetric' || mode === 'asymmetric') {
      const defaultLen = 24
      if (typeof current.outX !== 'number' || typeof current.outY !== 'number') {
        current.outX = current.x + defaultLen
        current.outY = current.y
      }
      if (typeof current.inX !== 'number' || typeof current.inY !== 'number') {
        current.inX = current.x - defaultLen
        current.inY = current.y
      }
      if (mode === 'symmetric') {
        syncOppositeHandle(points, pointIdx, 'out', 'symmetric', false)
      }
    } else {
      const defaultLen = 24
      if (typeof current.outX !== 'number' || typeof current.outY !== 'number') {
        current.outX = current.x + defaultLen
        current.outY = current.y
      }
      if (typeof current.inX !== 'number' || typeof current.inY !== 'number') {
        current.inX = current.x - defaultLen
        current.inY = current.y
      }
    }
    setElementAttrs(selectedPath.id, {
      __pathPoints: points,
      __pathClosed: selectedPath.closed,
      d: pathDFromPoints(points, selectedPath.closed)
    })
  }

  const insertPointOnSelectedPath = (localClick: { x: number; y: number }) => {
    if (!selectedPath || selectedPath.points.length < 2) return
    const points = selectedPath.points.map((p) => ({ ...p }))
    let best:
      | {
          segIdx: number
          t: number
          x: number
          y: number
          cubic: boolean
          dist2: number
        }
      | null = null

    const considerSegment = (i0: number, i1: number) => {
      const a = points[i0]
      const b = points[i1]
      const hasCubic =
        typeof a.outX === 'number' &&
        typeof a.outY === 'number' &&
        typeof b.inX === 'number' &&
        typeof b.inY === 'number'
      const hit = hasCubic
        ? nearestOnCubic(
            { x: a.x, y: a.y },
            { x: a.outX as number, y: a.outY as number },
            { x: b.inX as number, y: b.inY as number },
            { x: b.x, y: b.y },
            localClick
          )
        : nearestOnLine({ x: a.x, y: a.y }, { x: b.x, y: b.y }, localClick)
      if (!best || hit.dist2 < best.dist2) {
        best = { segIdx: i0, t: hit.t, x: hit.x, y: hit.y, cubic: hasCubic, dist2: hit.dist2 }
      }
    }

    for (let i = 0; i < points.length - 1; i += 1) {
      considerSegment(i, i + 1)
    }
    if (selectedPath.closed) considerSegment(points.length - 1, 0)
    if (!best) return
    const bestHit = best

    const insertAt = bestHit.segIdx + 1
    if (!bestHit.cubic) {
      const newPoint: PathPoint = { x: bestHit.x, y: bestHit.y, mode: 'corner' }
      points.splice(insertAt, 0, newPoint)
      setElementAttrs(selectedPath.id, {
        __pathPoints: points,
        __pathClosed: selectedPath.closed,
        d: pathDFromPoints(points, selectedPath.closed)
      })
      return
    }

    const a = points[bestHit.segIdx]
    const bIdx = insertAt % points.length
    const b = points[bIdx]
    const p0 = { x: a.x, y: a.y }
    const p1 = { x: a.outX as number, y: a.outY as number }
    const p2 = { x: b.inX as number, y: b.inY as number }
    const p3 = { x: b.x, y: b.y }
    const t = bestHit.t
    const q0 = lerp(p0, p1, t)
    const q1 = lerp(p1, p2, t)
    const q2 = lerp(p2, p3, t)
    const r0 = lerp(q0, q1, t)
    const r1 = lerp(q1, q2, t)
    const s = lerp(r0, r1, t)

    a.outX = q0.x
    a.outY = q0.y
    b.inX = q2.x
    b.inY = q2.y
    const newPoint: PathPoint = {
      x: s.x,
      y: s.y,
      inX: r0.x,
      inY: r0.y,
      outX: r1.x,
      outY: r1.y,
      mode: 'asymmetric'
    }
    points.splice(insertAt, 0, newPoint)
    setElementAttrs(selectedPath.id, {
      __pathPoints: points,
      __pathClosed: selectedPath.closed,
      d: pathDFromPoints(points, selectedPath.closed)
    })
  }

  const onElementPointerDown = useCallback(
    (id: string, shiftKey: boolean) => {
      const clicked = flattenForLayers(useEditorStore.getState().project.elements).find((x) => x.el.id === id)?.el
      if (
        activeTool === 'path-edit' &&
        clicked &&
        clicked.type !== 'path' &&
        ['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline'].includes(clicked.type)
      ) {
        const shouldConvert = window.confirm(
          `Convert "${clicked.name}" (${clicked.type}) to editable path?`
        )
        if (shouldConvert) {
          const d = elementShapeToPathD(clicked.type, clicked.attrs as Record<string, unknown>)
          if (d) {
            const n = (v: unknown, fallback = 0) =>
              typeof v === 'number' ? v : Number(v ?? fallback)
            const shapePoints =
              clicked.type === 'circle'
                ? ellipseToPathPoints(
                    n((clicked.attrs as Record<string, unknown>).cx),
                    n((clicked.attrs as Record<string, unknown>).cy),
                    Math.max(0, n((clicked.attrs as Record<string, unknown>).r)),
                    Math.max(0, n((clicked.attrs as Record<string, unknown>).r))
                  )
                : clicked.type === 'ellipse'
                  ? ellipseToPathPoints(
                      n((clicked.attrs as Record<string, unknown>).cx),
                      n((clicked.attrs as Record<string, unknown>).cy),
                      Math.max(0, n((clicked.attrs as Record<string, unknown>).rx)),
                      Math.max(0, n((clicked.attrs as Record<string, unknown>).ry))
                    )
                  : null
            const nextD =
              shapePoints && shapePoints.length > 1 ? pathDFromPoints(shapePoints, true) : d
            const nextElements = updateElementById(useEditorStore.getState().project.elements, id, (el) => ({
              ...el,
              type: 'path',
              attrs: {
                ...el.attrs,
                d: nextD,
                ...(shapePoints
                  ? {
                      __pathPoints: shapePoints,
                      __pathClosed: true
                    }
                  : {})
              }
            }))
            setElements(nextElements)
          }
        }
      }
      if (shiftKey) addToSelection(id)
      else select([id])
    },
    [activeTool, addToSelection, select, setElements]
  )

  const onWheel = (e: React.WheelEvent) => {
    if (!svgRef.current || !wrapRef.current) return
    e.preventDefault()
    const vb = useEditorStore.getState().viewBox
    const rect = wrapRef.current.getBoundingClientRect()
    const svg = svgRef.current
    const p = clientToSvg(svg, e.clientX, e.clientY)
    const factor = Math.exp(-e.deltaY * 0.001)
    const nw = Math.max(50, vb.width / factor)
    const nh = Math.max(50, vb.height / factor)
    const rx = (p.x - vb.x) / vb.width
    const ry = (p.y - vb.y) / vb.height
    const nx = p.x - nw * rx
    const ny = p.y - nh * ry
    setViewBox({ x: nx, y: ny, width: nw, height: nh })
    void rect
    void zoom
  }

  const onBgPointerDown = (e: React.PointerEvent) => {
    const isLeft = e.button === 0
    const drawEnabled =
      mode === 'draw' &&
      ['rect', 'circle', 'ellipse', 'line', 'pen', 'brush', 'text'].includes(activeTool)
    const targetEl = e.target as HTMLElement
    const overArtboard = e.target === e.currentTarget || targetEl.dataset?.artboard === '1'

    if (drawEnabled && isLeft && overArtboard) {
      const svg = svgRef.current
      if (!svg) return
      const p = clientToSvg(svg, e.clientX, e.clientY)
      if (activeTool === 'brush') {
        const settingsSnapshot: BrushSettings = { ...brushSettings }
        const rand = mulberry32((Date.now() ^ e.pointerId * 2654435761) >>> 0)
        const firstStamp = makeBrushStamp(p, 1, 0, settingsSnapshot, rand)
        brushStrokeRef.current = {
          pointerId: e.pointerId,
          raw: [p],
          smooth: [p],
          stamps: [firstStamp],
          lastStampArc: 0,
          settings: settingsSnapshot,
          rand
        }
        setBrushPreview({ stamps: [firstStamp], settings: settingsSnapshot })
        ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
        return
      }
      if (activeTool === 'pen') {
        if (!penDraft) {
          setPenDraft({ points: [{ x: p.x, y: p.y, mode: 'corner' }], hover: p })
          penPointerRef.current = { pointerId: e.pointerId, idx: 0, origin: p }
          ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
          return
        }
        const first = penDraft.points[0]
        const closePath = penDraft.points.length >= 2 && Math.hypot(p.x - first.x, p.y - first.y) <= 6
        if (closePath) {
          commitPenPath(penDraft.points, true)
          setPenDraft(null)
          penPointerRef.current = null
          return
        }
        const nextIdx = penDraft.points.length
        setPenDraft({
          points: [...penDraft.points, { x: p.x, y: p.y, mode: 'corner' }],
          hover: p
        })
        penPointerRef.current = { pointerId: e.pointerId, idx: nextIdx, origin: p }
        ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
        return
      }
      if (activeTool === 'text') {
        addElement({
          id: nanoid(10),
          name: `Text ${project.elements.length + 1}`,
          type: 'text',
          attrs: {
            x: Number(p.x.toFixed(2)),
            y: Number(p.y.toFixed(2)),
            fill: '#111827',
            'font-size': 36,
            'font-family': 'Inter, sans-serif',
            'font-weight': 600,
            __textContent: 'Text'
          },
          transform: defaultTransform(),
          visible: true,
          locked: false
        })
        return
      }
      setDraft({
        tool: activeTool as Exclude<DrawTool, 'select' | 'text' | 'pen' | 'path-edit'>,
        start: p,
        current: p
      })
      ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
      return
    }

    if (e.button === 1 || spaceDown) {
      panning.current = { x: e.clientX, y: e.clientY }
      ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
      return
    }
    if (e.target === e.currentTarget || targetEl.dataset?.artboard === '1') {
      clearSelection()
    }
  }

  const onBgPointerMove = (e: React.PointerEvent) => {
    if (activeTool === 'brush' && brushStrokeRef.current && svgRef.current) {
      const stroke = brushStrokeRef.current
      if (stroke.pointerId === e.pointerId) {
        const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
        const prevRaw = stroke.raw[stroke.raw.length - 1]
        const moved = Math.hypot(p.x - prevRaw.x, p.y - prevRaw.y)
        if (moved >= 0.45) {
          stroke.raw.push(p)
          const lastSmooth = stroke.smooth[stroke.smooth.length - 1]
          const a = brushAlpha(stroke.settings.stability)
          const sm = {
            x: lastSmooth.x + (p.x - lastSmooth.x) * a,
            y: lastSmooth.y + (p.y - lastSmooth.y) * a
          }
          stroke.smooth.push(sm)
          appendBrushStampsAlongStroke(stroke)
          setBrushPreview({
            stamps: [...stroke.stamps],
            settings: stroke.settings
          })
        }
        return
      }
    }
    if (activeTool === 'pen' && penPointerRef.current && penDraft) {
      const s = penPointerRef.current
      if (s.pointerId === e.pointerId && svgRef.current) {
        const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
        const dx = p.x - s.origin.x
        const dy = p.y - s.origin.y
        const len = Math.hypot(dx, dy)
        if (len > 2) {
          setPenDraft((prev) => {
            if (!prev) return prev
            const nextPts = prev.points.map((pt, idx) =>
              idx === s.idx
                ? {
                    ...pt,
                    mode: 'symmetric' as const,
                    outX: pt.x + dx,
                    outY: pt.y + dy,
                    inX: pt.x - dx,
                    inY: pt.y - dy
                  }
                : pt
            )
            return { points: nextPts, hover: p }
          })
        }
      }
    }
    if (pathEditDragRef.current && selectedPath && svgRef.current) {
      const d = pathEditDragRef.current
      if (d.pointerId === e.pointerId) {
        const pSvg = clientToSvg(svgRef.current, e.clientX, e.clientY)
        const p =
          selectedPathNode && svgRef.current
            ? svgToLocal(svgRef.current, selectedPathNode, pSvg.x, pSvg.y)
            : pSvg
        const points = d.start.map((pt) => ({ ...pt }))
        const pt = points[d.idx]
        if (d.kind === 'anchor') {
          const ox = pt.x
          const oy = pt.y
          const dx = p.x - ox
          const dy = p.y - oy
          pt.x = p.x
          pt.y = p.y
          if (typeof pt.inX === 'number' && typeof pt.inY === 'number') {
            pt.inX += dx
            pt.inY += dy
          }
          if (typeof pt.outX === 'number' && typeof pt.outY === 'number') {
            pt.outX += dx
            pt.outY += dy
          }
        } else if (d.kind === 'in') {
          pt.inX = p.x
          pt.inY = p.y
          syncOppositeHandle(points, d.idx, 'in', pt.mode ?? 'corner', true)
        } else {
          pt.outX = p.x
          pt.outY = p.y
          syncOppositeHandle(points, d.idx, 'out', pt.mode ?? 'corner', true)
        }
        setElementAttrs(selectedPath.id, {
          __pathPoints: points,
          __pathClosed: selectedPath.closed,
          d: pathDFromPoints(points, selectedPath.closed)
        }, { skipHistory: true })
      }
    }
    if (penDraft && svgRef.current) {
      const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
      setPenDraft((d) => (d ? { ...d, hover: p } : d))
    }
    if (draft && svgRef.current) {
      const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
      setDraft((d) => (d ? { ...d, current: p } : d))
      return
    }
    if (!panning.current || !wrapRef.current) return
    const dx = e.clientX - panning.current.x
    const dy = e.clientY - panning.current.y
    panning.current = { x: e.clientX, y: e.clientY }
    const vb = useEditorStore.getState().viewBox
    const rect = wrapRef.current.getBoundingClientRect()
    const sx = (dx / rect.width) * vb.width
    const sy = (dy / rect.height) * vb.height
    panBy(sx, sy)
  }

  const onBgPointerUp = (e: React.PointerEvent) => {
    if (brushStrokeRef.current?.pointerId === e.pointerId) {
      const stroke = brushStrokeRef.current
      brushStrokeRef.current = null
      if (stroke) {
        commitBrushStroke(stroke)
      }
      setBrushPreview(null)
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }
    if (penPointerRef.current?.pointerId === e.pointerId) {
      penPointerRef.current = null
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    if (pathEditDragRef.current?.pointerId === e.pointerId) {
      pathEditDragRef.current = null
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    if (draft) {
      const d = draft
      setDraft(null)
      const sx = d.start.x
      const sy = d.start.y
      const cx = d.current.x
      const cy = d.current.y
      const minX = Math.min(sx, cx)
      const minY = Math.min(sy, cy)
      const w = Math.abs(cx - sx)
      const h = Math.abs(cy - sy)
      const tooSmall = w < 2 && h < 2

      if (!tooSmall) {
        if (d.tool === 'rect') {
          addElement({
            id: nanoid(10),
            name: `Rectangle ${project.elements.length + 1}`,
            type: 'rect',
            attrs: {
              x: Number(minX.toFixed(2)),
              y: Number(minY.toFixed(2)),
              width: Number(w.toFixed(2)),
              height: Number(h.toFixed(2)),
              fill: '#d1d5db',
              stroke: '#5b8def',
              'stroke-width': 2
            },
            transform: defaultTransform(),
            visible: true,
            locked: false
          })
        } else if (d.tool === 'circle') {
          const r = Math.max(Math.min(w, h) / 2, 1)
          addElement({
            id: nanoid(10),
            name: `Circle ${project.elements.length + 1}`,
            type: 'circle',
            attrs: {
              cx: Number((minX + r).toFixed(2)),
              cy: Number((minY + r).toFixed(2)),
              r: Number(r.toFixed(2)),
              fill: '#d1d5db',
              stroke: '#5b8def',
              'stroke-width': 2
            },
            transform: defaultTransform(),
            visible: true,
            locked: false
          })
        } else if (d.tool === 'ellipse') {
          addElement({
            id: nanoid(10),
            name: `Ellipse ${project.elements.length + 1}`,
            type: 'ellipse',
            attrs: {
              cx: Number((minX + w / 2).toFixed(2)),
              cy: Number((minY + h / 2).toFixed(2)),
              rx: Number((Math.max(w / 2, 1)).toFixed(2)),
              ry: Number((Math.max(h / 2, 1)).toFixed(2)),
              fill: '#d1d5db',
              stroke: '#5b8def',
              'stroke-width': 2
            },
            transform: defaultTransform(),
            visible: true,
            locked: false
          })
        } else if (d.tool === 'line') {
          addElement({
            id: nanoid(10),
            name: `Line ${project.elements.length + 1}`,
            type: 'line',
            attrs: {
              x1: Number(sx.toFixed(2)),
              y1: Number(sy.toFixed(2)),
              x2: Number(cx.toFixed(2)),
              y2: Number(cy.toFixed(2)),
              stroke: '#5b8def',
              'stroke-width': 2,
              'stroke-linecap': 'round'
            },
            transform: defaultTransform(),
            visible: true,
            locked: false
          })
        }
      }

      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }

    if (panning.current) {
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      panning.current = null
    }
  }

  const canvasCursor =
    mode === 'draw' && activeTool !== 'select'
      ? activeTool === 'text'
        ? 'text'
        : activeTool === 'path-edit'
          ? 'default'
          : 'crosshair'
      : 'default'

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.code === 'Space') setSpaceDown(true)
        if (activeTool === 'pen' && penDraft && (e.key === 'Enter' || e.code === 'Enter')) {
          e.preventDefault()
          commitPenPath(penDraft.points)
          setPenDraft(null)
          penPointerRef.current = null
        }
        if (activeTool === 'pen' && e.key === 'Escape') {
          e.preventDefault()
          setPenDraft(null)
          penPointerRef.current = null
        }
        if (activeTool === 'brush' && e.key === 'Escape') {
          e.preventDefault()
          brushStrokeRef.current = null
          setBrushPreview(null)
        }
      }}
      onKeyUp={(e) => {
        if (e.code === 'Space') setSpaceDown(false)
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        onWheel={onWheel}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerLeave={onBgPointerUp}
        onDoubleClick={() => {
          if (activeTool !== 'pen' || !penDraft) return
          commitPenPath(penDraft.points)
          setPenDraft(null)
        }}
        onContextMenu={(e) => {
          if (activeTool === 'path-edit' || activeTool === 'pen' || activeTool === 'brush') {
            e.preventDefault()
          }
        }}
        style={{ touchAction: 'none', cursor: canvasCursor }}
      >
        <rect
          data-artboard="1"
          x={0}
          y={0}
          width={project.width}
          height={project.height}
          fill="#f4f5f7"
          stroke="#d0d4dc"
        />
        <ElementRenderer
          elements={project.elements}
          tracks={tracks}
          currentTime={currentTime}
          onElementPointerDown={onElementPointerDown}
        />
        {activeTool === 'path-edit' && selectedPath && (
          <g pointerEvents="none">
            <path
              d={pathDFromPoints(selectedPath.points, selectedPath.closed)}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              pointerEvents="stroke"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                if (!svgRef.current || !selectedPathNode) return
                e.preventDefault()
                e.stopPropagation()
                pushHistory()
                const pSvg = clientToSvg(svgRef.current, e.clientX, e.clientY)
                const pLocal = svgToLocal(svgRef.current, selectedPathNode, pSvg.x, pSvg.y)
                insertPointOnSelectedPath(pLocal)
              }}
            />
            {selectedPath.points.map((pt, idx) => (
              <g key={`path-edit-${selectedPath.id}-${idx}`}>
                {(() => {
                  const anchor = selectedPathNode && svgRef.current
                    ? localToSvg(svgRef.current, selectedPathNode, pt.x, pt.y)
                    : { x: pt.x, y: pt.y }
                  const inPt =
                    typeof pt.inX === 'number' && typeof pt.inY === 'number'
                      ? selectedPathNode && svgRef.current
                        ? localToSvg(svgRef.current, selectedPathNode, pt.inX, pt.inY)
                        : { x: pt.inX, y: pt.inY }
                      : null
                  const outPt =
                    typeof pt.outX === 'number' && typeof pt.outY === 'number'
                      ? selectedPathNode && svgRef.current
                        ? localToSvg(svgRef.current, selectedPathNode, pt.outX, pt.outY)
                        : { x: pt.outX, y: pt.outY }
                      : null
                  return (
                    <>
                      {inPt && (
                  <>
                    <line
                      x1={anchor.x}
                      y1={anchor.y}
                      x2={inPt.x}
                      y2={inPt.y}
                      stroke="#8b5cf6"
                      strokeOpacity={0.8}
                      strokeWidth={1}
                    />
                    <circle
                      cx={inPt.x}
                      cy={inPt.y}
                      r={3}
                      fill="#fff"
                      stroke="#8b5cf6"
                      strokeWidth={1}
                      pointerEvents="auto"
                      cursor="grab"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        e.preventDefault()
                        e.stopPropagation()
                        pushHistory()
                        pathEditDragRef.current = {
                          kind: 'in',
                          pointerId: e.pointerId,
                          idx,
                          start: selectedPath.points.map((p) => ({ ...p }))
                        }
                        ;(e.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(e.pointerId)
                      }}
                    />
                  </>
                      )}
                      {outPt && (
                  <>
                    <line
                      x1={anchor.x}
                      y1={anchor.y}
                      x2={outPt.x}
                      y2={outPt.y}
                      stroke="#8b5cf6"
                      strokeOpacity={0.8}
                      strokeWidth={1}
                    />
                    <circle
                      cx={outPt.x}
                      cy={outPt.y}
                      r={3}
                      fill="#fff"
                      stroke="#8b5cf6"
                      strokeWidth={1}
                      pointerEvents="auto"
                      cursor="grab"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        e.preventDefault()
                        e.stopPropagation()
                        pushHistory()
                        pathEditDragRef.current = {
                          kind: 'out',
                          pointerId: e.pointerId,
                          idx,
                          start: selectedPath.points.map((p) => ({ ...p }))
                        }
                        ;(e.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(e.pointerId)
                      }}
                    />
                  </>
                      )}
                <circle
                  cx={anchor.x}
                  cy={anchor.y}
                  r={4}
                  fill="#5b8def"
                  stroke="#fff"
                  strokeWidth={1.5}
                  pointerEvents="auto"
                  cursor="move"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    pushHistory()
                    pathEditDragRef.current = {
                      kind: 'anchor',
                      pointerId: e.pointerId,
                      idx,
                      start: selectedPath.points.map((p) => ({ ...p }))
                    }
                    ;(e.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(e.pointerId)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const wrapRect = wrapRef.current?.getBoundingClientRect()
                    if (!wrapRect) return
                    setPathPointMenu({
                      pathId: selectedPath.id,
                      pointIdx: idx,
                      left: e.clientX - wrapRect.left + 4,
                      top: e.clientY - wrapRect.top + 4
                    })
                  }}
                />
                    </>
                  )
                })()}
              </g>
            ))}
          </g>
        )}
        {penDraft && penDraft.points.length > 0 && (
          <g pointerEvents="none" opacity={0.95}>
            <path
              d={pathDFromPoints([
                ...penDraft.points,
                ...(penDraft.hover ? [{ x: penDraft.hover.x, y: penDraft.hover.y, mode: 'corner' as const }] : [])
              ])}
              fill="none"
              stroke="#5b8def"
              strokeWidth={2}
              strokeDasharray="4 2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {penDraft.points.map((pt, idx) => (
              <circle
                key={`${pt.x}-${pt.y}-${idx}`}
                cx={pt.x}
                cy={pt.y}
                r={2.5}
                fill={idx === 0 ? '#8b5cf6' : '#5b8def'}
              />
            ))}
          </g>
        )}
        {brushPreview && brushPreview.stamps.length > 0 && (
          <g pointerEvents="none" opacity={0.95}>
            {brushPreview.stamps.map((st, i) => (
              <circle
                key={`brush-prev-${i}`}
                cx={st.cx}
                cy={st.cy}
                r={st.r}
                fill={brushPreview.settings.color}
                opacity={st.opacity}
                stroke="none"
              />
            ))}
          </g>
        )}
        {draft && (
          <g pointerEvents="none" opacity={0.9}>
            {(() => {
              const sx = draft.start.x
              const sy = draft.start.y
              const cx = draft.current.x
              const cy = draft.current.y
              const minX = Math.min(sx, cx)
              const minY = Math.min(sy, cy)
              const w = Math.abs(cx - sx)
              const h = Math.abs(cy - sy)
              if (draft.tool === 'rect') {
                return (
                  <rect
                    x={minX}
                    y={minY}
                    width={w}
                    height={h}
                    fill="rgba(91,141,239,0.18)"
                    stroke="#5b8def"
                    strokeDasharray="4 2"
                  />
                )
              }
              if (draft.tool === 'circle') {
                const r = Math.max(Math.min(w, h) / 2, 1)
                return (
                  <circle
                    cx={minX + r}
                    cy={minY + r}
                    r={r}
                    fill="rgba(91,141,239,0.18)"
                    stroke="#5b8def"
                    strokeDasharray="4 2"
                  />
                )
              }
              if (draft.tool === 'ellipse') {
                return (
                  <ellipse
                    cx={minX + w / 2}
                    cy={minY + h / 2}
                    rx={Math.max(w / 2, 1)}
                    ry={Math.max(h / 2, 1)}
                    fill="rgba(91,141,239,0.18)"
                    stroke="#5b8def"
                    strokeDasharray="4 2"
                  />
                )
              }
              return (
                <line
                  x1={sx}
                  y1={sy}
                  x2={cx}
                  y2={cy}
                  stroke="#5b8def"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  strokeLinecap="round"
                />
              )
            })()}
          </g>
        )}
      </svg>
      {mode === 'draw' && activeTool === 'brush' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            zIndex: 11,
            pointerEvents: 'auto'
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, auto)',
              gap: '10px 14px',
              alignItems: 'center',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 10px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)'
            }}
          >
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Type
              <select
                value={brushSettings.kind}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    kind: e.target.value as BrushKind
                  }))
                }
              >
                <option value="solid">Solid stamps</option>
                <option value="marker">Marker stamps</option>
                <option value="texture">Texture stamps</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Size
              <input
                type="range"
                min={1}
                max={64}
                step={1}
                value={brushSettings.size}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    size: Number(e.target.value)
                  }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Color
              <input
                type="color"
                value={brushSettings.color}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    color: e.target.value
                  }))
                }
                style={{ width: 44, height: 28, padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Stability
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={brushSettings.stability}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    stability: Number(e.target.value)
                  }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Spacing
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={brushSettings.spacing}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    spacing: Number(e.target.value)
                  }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Jitter
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={brushSettings.jitter}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    jitter: Number(e.target.value)
                  }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Noise
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={brushSettings.noise}
                onChange={(e) =>
                  setBrushSettings((s) => ({
                    ...s,
                    noise: Number(e.target.value)
                  }))
                }
              />
            </label>
          </div>
        </div>
      )}
      {activeTool === 'path-edit' && pathPointMenu && selectedPath && pathPointMenu.pathId === selectedPath.id && (
        <div
          ref={pathPointMenuRef}
          style={{
            position: 'absolute',
            left: pathPointMenu.left,
            top: pathPointMenu.top,
            zIndex: 12,
            pointerEvents: 'auto'
          }}
        >
          <div
            style={{
              minWidth: 170,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              padding: 4
            }}
          >
            {[
              { id: 'corner' as const, label: 'Corner' },
              { id: 'symmetric' as const, label: 'Symmetric curve' },
              { id: 'asymmetric' as const, label: 'Asymmetric curve' },
              { id: 'disconnected' as const, label: 'Disconnected curve' }
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: 12,
                  borderRadius: 4,
                  cursor: 'pointer'
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  applyPointMode(pathPointMenu.pointIdx, opt.id)
                  setPathPointMenu(null)
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode !== 'preview' &&
        mode !== 'export' &&
        !(activeTool === 'path-edit' && selectedPath) && (
        <SelectionOverlay svgRef={svgRef} wrapRef={wrapRef} />
      )}
    </div>
  )
}
