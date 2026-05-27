import { nanoid } from 'nanoid'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faChevronRight, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons'
import { useEditorStore } from '@/store/editorStore'
import { dialogAlert, dialogConfirm } from '@/store/dialogStore'
import { ElementRenderer } from '@/components/canvas/ElementRenderer'
import { Tooltip } from '@/components/Tooltip'
import { pathDragLiveDRef } from '@/components/canvas/pathDragLivePreview'
import { SelectionOverlay } from '@/components/canvas/SelectionOverlay'
import {
  applyTransformDragMove,
  buildTransformDragTargets,
  clientToSvg
} from '@/components/canvas/selectionTransformDrag'
import {
  disposeGsapTrackTimeline,
  rebuildGsapTrackTimeline,
  sampleMergedAttrsForElement,
  syncGsapTrackTimelineTime
} from '@/engines/animation/gsapTrackCompiler'
import { defaultTransform, type VectorElement } from '@/types/document'
import { flattenForLayers, updateElementById } from '@/engines/document/tree'
import type { DrawTool } from '@/store/editorStore'
import type { PathPoint, PathPointMode } from '@/types/document'
import { buildFillPathFromRasterSample } from '@/engines/geometry/rasterBucketFill'
import { elementShapeToPathD } from '@/engines/geometry/shapeToPath'
import { buildPencilPathD } from '@/engines/geometry/pencilPath'
import { CanvasGuideOverlay } from '@/components/canvas/CanvasGuideOverlay'
import { bboxInSvgRootSpace } from '@/components/canvas/svgBounds'
import type { CanvasGuideType } from '@/types/canvasGuide'

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
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const gsapCanvasDriver = useEditorStore((s) => s.gsapCanvasDriver)
  const duration = useEditorStore((s) => s.duration)
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
  const upsertKeyframe = useEditorStore((s) => s.upsertKeyframe)
  const applyEraserStroke = useEditorStore((s) => s.applyEraserStroke)
  const canvasGuideType = useEditorStore((s) => s.canvasGuideType)
  const canvasGuideSpacing = useEditorStore((s) => s.canvasGuideSpacing)
  const canvasGuideOpacity = useEditorStore((s) => s.canvasGuideOpacity)
  const canvasGuideHorizon = useEditorStore((s) => s.canvasGuideHorizon)
  const canvasGuideColor = useEditorStore((s) => s.canvasGuideColor)
  const canvasGuideOverlayVisible = useEditorStore((s) => s.canvasGuideOverlayVisible)
  const canvasGuidePanelCollapsed = useEditorStore((s) => s.canvasGuidePanelCollapsed)
  const canvasGuideVp1 = useEditorStore((s) => s.canvasGuideVp1)
  const canvasGuideVpLeft = useEditorStore((s) => s.canvasGuideVpLeft)
  const canvasGuideVpRight = useEditorStore((s) => s.canvasGuideVpRight)
  const canvasGuideVpTop = useEditorStore((s) => s.canvasGuideVpTop)
  const canvasGuideFisheyeCenter = useEditorStore((s) => s.canvasGuideFisheyeCenter)
  const setCanvasGuideType = useEditorStore((s) => s.setCanvasGuideType)
  const setCanvasGuideSpacing = useEditorStore((s) => s.setCanvasGuideSpacing)
  const setCanvasGuideOpacity = useEditorStore((s) => s.setCanvasGuideOpacity)
  const setCanvasGuideHorizon = useEditorStore((s) => s.setCanvasGuideHorizon)
  const setCanvasGuideColor = useEditorStore((s) => s.setCanvasGuideColor)
  const setCanvasGuideOverlayVisible = useEditorStore((s) => s.setCanvasGuideOverlayVisible)
  const setCanvasGuidePanelCollapsed = useEditorStore((s) => s.setCanvasGuidePanelCollapsed)

  const guideVpDragRef = useRef<{ kind: 'vp1' | 'vpL' | 'vpR' | 'vpT' | 'fish'; pointerId: number } | null>(
    null
  )

  useMemo(() => {
    if (!gsapCanvasDriver) {
      disposeGsapTrackTimeline()
      return
    }
    rebuildGsapTrackTimeline(project.elements, tracks, duration)
  }, [gsapCanvasDriver, tracks, project.elements, duration])

  useEffect(() => {
    return () => disposeGsapTrackTimeline()
  }, [])

  const [spaceDown, setSpaceDown] = useState(false)
  const [marquee, setMarquee] = useState<{
    pointerId: number
    start: { x: number; y: number }
    current: { x: number; y: number }
    additive: boolean
  } | null>(null)
  const [draft, setDraft] = useState<{
    tool: Exclude<
      DrawTool,
      | 'select'
      | 'hand'
      | 'shape-builder'
      | 'text'
      | 'pen'
      | 'path-edit'
      | 'pencil'
      | 'eraser'
      | 'brush'
      | 'fill'
    >
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
  const [pencilSettings, setPencilSettings] = useState({
    smoothing: 0.42,
    strokeWidth: 2.5,
    color: '#111827'
  })
  const [rasterFillOpts, setRasterFillOpts] = useState({
    /** Stop expanding when neighbor RGBA is farther than this (per-channel scale). */
    tolerance: 42,
    /** Path simplification in SVG units after tracing. */
    simplifyEpsilon: 1.4
  })
  const rasterFillBusyRef = useRef(false)
  const [pencilPreview, setPencilPreview] = useState<Vec2[] | null>(null)
  const pencilStrokeRef = useRef<{ pointerId: number; raw: Vec2[] } | null>(null)
  const lastPencilCommitRef = useRef<{ d: string; at: number } | null>(null)
  const [eraserSettings, setEraserSettings] = useState({ width: 22 })
  const [eraserPreview, setEraserPreview] = useState<Vec2[] | null>(null)
  const eraserStrokeRef = useRef<{ pointerId: number; raw: Vec2[] } | null>(null)
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

  const commitPencilStroke = useCallback(
    (raw: Vec2[]) => {
      const d = buildPencilPathD(raw, pencilSettings.smoothing)
      if (!d) return
      const now = Date.now()
      const last = lastPencilCommitRef.current
      if (last && last.d === d && now - last.at < 250) return
      lastPencilCommitRef.current = { d, at: now }
      addElement({
        id: nanoid(10),
        name: `Pencil ${project.elements.length + 1}`,
        type: 'path',
        attrs: {
          d,
          fill: 'none',
          stroke: pencilSettings.color,
          'stroke-width': pencilSettings.strokeWidth,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        },
        transform: defaultTransform(),
        visible: true,
        locked: false
      })
    },
    [addElement, pencilSettings.smoothing, pencilSettings.color, pencilSettings.strokeWidth, project.elements.length]
  )

  const selectedPath = useMemo(() => {
    if (selectedIds.length !== 1) return null
    const id = selectedIds[0]!
    const el = flattenForLayers(project.elements).find((x) => x.el.id === id)?.el
    if (!el || el.type !== 'path') return null
    const animUi = mode === 'animate' || mode === 'preview'
    const attrs = animUi
      ? sampleMergedAttrsForElement(el, tracks, currentTime, gsapCanvasDriver)
      : el.attrs
    const points = Array.isArray(attrs.__pathPoints)
      ? (attrs.__pathPoints as PathPoint[])
      : typeof attrs.d === 'string'
        ? parsePathDToPoints(attrs.d)?.points ?? null
        : null
    if (!points || points.length === 0) return null
    const closed =
      typeof attrs.__pathClosed === 'boolean'
        ? attrs.__pathClosed
        : typeof attrs.d === 'string'
          ? Boolean(parsePathDToPoints(attrs.d)?.closed)
          : false
    return { id: el.id, points, closed }
  }, [selectedIds, project.elements, tracks, currentTime, mode, gsapCanvasDriver])
  const selectedPathNode =
    selectedPath && svgRef.current
      ? (svgRef.current.querySelector(
          `[data-el-id="${CSS.escape(selectedPath.id)}"]`
        ) as SVGGraphicsElement | null)
      : null

  useEffect(() => {
    pathDragLiveDRef.current = null
  }, [selectedIds, mode, activeTool])

  const marqueeRect =
    marquee
      ? {
          x: Math.min(marquee.start.x, marquee.current.x),
          y: Math.min(marquee.start.y, marquee.current.y),
          width: Math.abs(marquee.current.x - marquee.start.x),
          height: Math.abs(marquee.current.y - marquee.start.y)
        }
      : null

  const applyMarqueeSelection = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, additive: boolean) => {
      const svg = svgRef.current
      if (!svg) return
      const rx2 = rect.x + rect.width
      const ry2 = rect.y + rect.height
      const overlaps = (b: { x: number; y: number; width: number; height: number }) => {
        const bx2 = b.x + b.width
        const by2 = b.y + b.height
        return b.x <= rx2 && bx2 >= rect.x && b.y <= ry2 && by2 >= rect.y
      }

      const flat = flattenForLayers(project.elements)
      const hits = flat
        .filter((n) => !n.el.locked && n.el.visible !== false)
        .map((n) => {
          const node = svg.querySelector(`[data-el-id="${CSS.escape(n.el.id)}"]`) as SVGGraphicsElement | null
          if (!node) return null
          const b = bboxInSvgRootSpace(node, svg)
          if (!b || !overlaps(b)) return null
          return n.el.id
        })
        .filter((id): id is string => Boolean(id))

      if (additive) {
        const merged = [...new Set([...selectedIds, ...hits])]
        select(merged)
      } else {
        select(hits)
      }
    },
    [project.elements, select, selectedIds]
  )

  useEffect(() => {
    if (activeTool !== 'pen') setPenDraft(null)
  }, [activeTool])

  useEffect(() => {
    if (activeTool !== 'select' || mode !== 'draw') setMarquee(null)
  }, [activeTool, mode])

  useEffect(() => {
    if (activeTool !== 'brush') {
      setBrushPreview(null)
      brushStrokeRef.current = null
    }
  }, [activeTool])

  useEffect(() => {
    if (activeTool !== 'pencil') {
      setPencilPreview(null)
      pencilStrokeRef.current = null
    }
  }, [activeTool])

  useEffect(() => {
    if (activeTool !== 'eraser') {
      setEraserPreview(null)
      eraserStrokeRef.current = null
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
    const bestHit = best as {
      segIdx: number
      t: number
      x: number
      y: number
      cubic: boolean
      dist2: number
    }

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

  const tryApplyBucketFill = useCallback(
    async (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg || rasterFillBusyRef.current) return
      rasterFillBusyRef.current = true
      try {
        const p = clientToSvg(svg, clientX, clientY)
        const st = useEditorStore.getState()
        const d = await buildFillPathFromRasterSample(
          st.project,
          st.tracks,
          st.currentTime,
          p.x,
          p.y,
          {
            tolerance: rasterFillOpts.tolerance,
            simplifyEpsilon: rasterFillOpts.simplifyEpsilon
          }
        )
        if (!d) {
          void dialogAlert(
            'Could not create a fill here. Try another spot, increase tolerance, or click closer to the artboard.'
          )
          return
        }
        const id = nanoid(10)
        const n = st.project.elements.length
        addElement(
          {
            id,
            name: `Fill ${n + 1}`,
            type: 'path',
            attrs: {
              d,
              fill: pencilSettings.color,
              stroke: 'none'
            },
            transform: defaultTransform(),
            visible: true,
            locked: false
          },
          { select: true }
        )
      } catch (e) {
        console.error('[raster fill]', e)
        void dialogAlert(e instanceof Error ? e.message : 'Raster fill failed.')
      } finally {
        rasterFillBusyRef.current = false
      }
    },
    [addElement, pencilSettings.color, rasterFillOpts.simplifyEpsilon, rasterFillOpts.tolerance]
  )

  const onElementPointerDown = useCallback(
    (id: string, shiftKey: boolean, clientX: number, clientY: number, button: number) => {
      if (activeTool === 'hand') return
      const clicked = flattenForLayers(useEditorStore.getState().project.elements).find((x) => x.el.id === id)?.el
      if (
        mode === 'draw' &&
        activeTool === 'fill' &&
        button === 0
      ) {
        tryApplyBucketFill(clientX, clientY)
        return
      }
      if (
        mode === 'draw' &&
        activeTool === 'path-edit' &&
        clicked &&
        clicked.type !== 'path' &&
        ['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline'].includes(clicked.type)
      ) {
        void dialogConfirm({
          message: `Convert "${clicked.name}" (${clicked.type}) to editable path?`,
          confirmLabel: 'Convert',
          cancelLabel: 'Cancel'
        }).then((shouldConvert) => {
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
          if (shiftKey) addToSelection(id)
          else select([id])
        })
        return
      }
      if (shiftKey) addToSelection(id)
      else select([id])

      if (
        button === 0 &&
        (mode === 'draw' || mode === 'animate') &&
        activeTool === 'select' &&
        clicked &&
        !clicked.locked
      ) {
        const svgEl = svgRef.current
        if (!svgEl) return
        const stNow = useEditorStore.getState()
        const dragIds = stNow.selectedIds
        if (!dragIds.includes(id)) return
        const inAnim = stNow.mode === 'animate' || stNow.mode === 'preview'
        const dragTargets = buildTransformDragTargets(
          svgEl,
          stNow.project.elements,
          dragIds,
          stNow.tracks,
          inAnim ? stNow.currentTime : 0,
          inAnim,
          stNow.gsapCanvasDriver
        )
        if (dragTargets.length === 0) return
        const startSvg = clientToSvg(svgEl, clientX, clientY)
        stNow.pushHistory()

        const onMove = (ev: PointerEvent) => {
          const cur = clientToSvg(svgEl, ev.clientX, ev.clientY)
          const updates = applyTransformDragMove(
            dragTargets,
            { x: 0, y: 0 },
            startSvg,
            cur,
            1,
            0,
            'move'
          )
          for (const update of updates) {
            useEditorStore.getState().updateTransform(update.id, update.partial, { skipHistory: true })
          }
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }
    },
    [
      activeTool,
      mode,
      addToSelection,
      select,
      setElements,
      tryApplyBucketFill
    ]
  )

  /** React's onWheel is passive in many browsers → preventDefault ignored. Use capture + non-passive native listener. */
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const wheelOpts: AddEventListenerOptions = { passive: false }
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const vb = useEditorStore.getState().viewBox
      const p = clientToSvg(svg, e.clientX, e.clientY)
      const factor = Math.exp(-e.deltaY * 0.001)
      const nw = Math.max(50, vb.width / factor)
      const nh = Math.max(50, vb.height / factor)
      const rx = (p.x - vb.x) / vb.width
      const ry = (p.y - vb.y) / vb.height
      const nx = p.x - nw * rx
      const ny = p.y - nh * ry
      setViewBox({ x: nx, y: ny, width: nw, height: nh })
    }

    svg.addEventListener('wheel', handleWheel, wheelOpts)
    return () => svg.removeEventListener('wheel', handleWheel, wheelOpts)
  }, [setViewBox])

  const onBgPointerDown = (e: React.PointerEvent) => {
    const isLeft = e.button === 0
    const drawEnabled =
      mode === 'draw' &&
      ['rect', 'circle', 'ellipse', 'line', 'pen', 'pencil', 'eraser', 'brush', 'text', 'fill'].includes(
        activeTool
      )
    const targetEl = e.target as HTMLElement
    /**
     * For drawing tools, accept the click anywhere on the SVG (including over
     * existing artwork) so the user can add points / start a stroke on top of
     * existing elements. For select / marquee, require the artboard itself.
     */
    const overArtboard = e.target === e.currentTarget || targetEl.dataset?.artboard === '1'
    const overDrawSurface = drawEnabled || overArtboard

    if (mode === 'draw' && activeTool === 'select' && isLeft && overArtboard && !spaceDown) {
      const svg = svgRef.current
      if (!svg) return
      const p = clientToSvg(svg, e.clientX, e.clientY)
      setMarquee({
        pointerId: e.pointerId,
        start: p,
        current: p,
        additive: e.shiftKey
      })
      if (!e.shiftKey) {
        clearSelection()
      }
      ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
      return
    }

    if (drawEnabled && isLeft && overDrawSurface) {
      const svg = svgRef.current
      if (!svg) return
      const p = clientToSvg(svg, e.clientX, e.clientY)
      if (activeTool === 'fill') {
        tryApplyBucketFill(e.clientX, e.clientY)
        return
      }
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
      if (activeTool === 'pencil') {
        pencilStrokeRef.current = { pointerId: e.pointerId, raw: [p] }
        setPencilPreview([p])
        ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
        return
      }
      if (activeTool === 'eraser') {
        eraserStrokeRef.current = { pointerId: e.pointerId, raw: [p] }
        setEraserPreview([p])
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
        tool: activeTool as Exclude<
          DrawTool,
          | 'select'
          | 'hand'
          | 'shape-builder'
          | 'text'
          | 'pen'
          | 'path-edit'
          | 'pencil'
          | 'eraser'
          | 'brush'
          | 'fill'
        >,
        start: p,
        current: p
      })
      ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
      return
    }

    if (e.button === 1 || spaceDown || (activeTool === 'hand' && isLeft)) {
      panning.current = { x: e.clientX, y: e.clientY }
      ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
      return
    }
    if (e.target === e.currentTarget || targetEl.dataset?.artboard === '1') {
      clearSelection()
    }
  }

  const onBgPointerMove = (e: React.PointerEvent) => {
    const gv = guideVpDragRef.current
    if (gv && gv.pointerId === e.pointerId && svgRef.current && mode !== 'export') {
      const st = useEditorStore.getState()
      const pw = st.project.width
      const ph = st.project.height
      if (pw > 0 && ph > 0) {
        const pt = clientToSvg(svgRef.current, e.clientX, e.clientY)
        const nx = pt.x / pw
        const ny = pt.y / ph
        if (gv.kind === 'vp1') st.setCanvasGuideVp1({ nx, ny })
        else if (gv.kind === 'vpL') st.setCanvasGuideVpLeft({ nx, ny })
        else if (gv.kind === 'vpR') st.setCanvasGuideVpRight({ nx, ny })
        else if (gv.kind === 'vpT') st.setCanvasGuideVpTop({ nx, ny })
        else if (gv.kind === 'fish') st.setCanvasGuideFisheyeCenter({ nx, ny })
      }
      return
    }

    if (marquee && marquee.pointerId === e.pointerId && svgRef.current) {
      const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
      setMarquee((m) => (m ? { ...m, current: p } : m))
      return
    }

    if (activeTool === 'pencil' && pencilStrokeRef.current && svgRef.current) {
      const stroke = pencilStrokeRef.current
      if (stroke.pointerId === e.pointerId) {
        const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
        const prev = stroke.raw[stroke.raw.length - 1]
        if (Math.hypot(p.x - prev.x, p.y - prev.y) >= 0.35) {
          stroke.raw.push(p)
          setPencilPreview([...stroke.raw])
        }
        return
      }
    }
    if (activeTool === 'eraser' && eraserStrokeRef.current && svgRef.current) {
      const stroke = eraserStrokeRef.current
      if (stroke.pointerId === e.pointerId) {
        const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
        const prev = stroke.raw[stroke.raw.length - 1]
        if (Math.hypot(p.x - prev.x, p.y - prev.y) >= 0.35) {
          stroke.raw.push(p)
          setEraserPreview([...stroke.raw])
        }
        return
      }
    }
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
        const dStr = pathDFromPoints(points, selectedPath.closed)
        if (mode === 'animate' || mode === 'preview') {
          pathDragLiveDRef.current = { elementId: selectedPath.id, d: dStr }
        }
        setElementAttrs(selectedPath.id, {
          __pathPoints: points,
          __pathClosed: selectedPath.closed,
          d: dStr
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
    if (guideVpDragRef.current?.pointerId === e.pointerId) {
      guideVpDragRef.current = null
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }

    if (marquee?.pointerId === e.pointerId) {
      const done = marquee
      const rect = {
        x: Math.min(done.start.x, done.current.x),
        y: Math.min(done.start.y, done.current.y),
        width: Math.abs(done.current.x - done.start.x),
        height: Math.abs(done.current.y - done.start.y)
      }
      setMarquee(null)
      if (rect.width >= 2 || rect.height >= 2) {
        applyMarqueeSelection(rect, done.additive)
      } else if (!done.additive) {
        clearSelection()
      }
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }

    if (pencilStrokeRef.current?.pointerId === e.pointerId) {
      const raw = pencilStrokeRef.current.raw
      pencilStrokeRef.current = null
      setPencilPreview(null)
      if (raw.length >= 2) {
        commitPencilStroke(raw)
      }
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }
    if (eraserStrokeRef.current?.pointerId === e.pointerId) {
      const raw = eraserStrokeRef.current.raw
      eraserStrokeRef.current = null
      setEraserPreview(null)
      if (raw.length >= 2) {
        applyEraserStroke(raw, eraserSettings.width)
      }
      try {
        ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }
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
      const st = useEditorStore.getState()
      if (
        (st.mode === 'animate' || st.mode === 'preview') &&
        !st.isPlaying &&
        st.selectedIds.length === 1
      ) {
        const pid = st.selectedIds[0]!
        const node = flattenForLayers(st.project.elements).find((x) => x.el.id === pid)?.el
        if (node?.type === 'path' && !node.locked) {
          const d = typeof node.attrs.d === 'string' ? node.attrs.d : ''
          if (d.length > 0) {
            upsertKeyframe(pid, 'pathD', st.currentTime, 0, undefined, { valueText: d })
          }
        }
      }
      pathDragLiveDRef.current = null
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
    activeTool === 'hand'
      ? panning.current
        ? 'grabbing'
        : 'grab'
      : (mode === 'draw' || activeTool === 'path-edit') &&
          activeTool !== 'select' &&
          activeTool !== 'shape-builder'
        ? activeTool === 'text'
          ? 'text'
          : activeTool === 'path-edit'
            ? 'default'
            : activeTool === 'eraser'
              ? 'cell'
              : 'crosshair'
        : 'default'

  if (gsapCanvasDriver) syncGsapTrackTimelineTime(currentTime)

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={(e) => {
        const typingUi = Boolean(
          (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
        )

        if (!typingUi) {
          const st = useEditorStore.getState()
          const animUi = st.mode === 'animate' || st.mode === 'preview'

          if (e.code === 'Space') {
            if (animUi) {
              e.preventDefault()
              st.setIsPlaying(!st.isPlaying)
            } else {
              setSpaceDown(true)
            }
          }

          if (animUi) {
            if (e.code === 'Comma' || e.code === 'Period') {
              e.preventDefault()
              const dt = 1 / st.fps
              if (e.code === 'Comma') {
                st.setCurrentTime(Math.max(0, st.currentTime - dt))
              } else {
                st.setCurrentTime(Math.min(st.duration, st.currentTime + dt))
              }
            }
            if (e.code === 'BracketLeft') {
              e.preventDefault()
              st.jumpToPrevKeyframe()
            }
            if (e.code === 'BracketRight') {
              e.preventDefault()
              st.jumpToNextKeyframe()
            }
            if (e.code === 'Home') {
              e.preventDefault()
              st.setCurrentTime(0)
            }
            if (e.code === 'End') {
              e.preventDefault()
              st.setCurrentTime(st.duration)
            }
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC' && st.selectedKeyframes.length > 0) {
              e.preventDefault()
              st.copySelectedKeyframes()
            }
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyV' && (st.keyframeClipboard?.length ?? 0) > 0) {
              e.preventDefault()
              st.pasteKeyframesAtTime()
            }
            if (
              st.mode === 'animate' &&
              (e.code === 'Delete' || e.code === 'Backspace') &&
              st.selectedKeyframes.length > 0
            ) {
              e.preventDefault()
              st.deleteSelectedKeyframes()
            }
            if (
              st.mode === 'animate' &&
              (e.code === 'ArrowLeft' || e.code === 'ArrowRight') &&
              st.selectedKeyframes.length > 0
            ) {
              e.preventDefault()
              const frames = e.shiftKey ? 10 : 1
              const dir = e.code === 'ArrowLeft' ? -1 : 1
              st.nudgeSelectedKeyframes((frames / st.fps) * dir)
            }
          }
        }

        if (!typingUi && activeTool === 'pen' && penDraft && (e.key === 'Enter' || e.code === 'Enter')) {
          e.preventDefault()
          commitPenPath(penDraft.points)
          setPenDraft(null)
          penPointerRef.current = null
        }
        if (!typingUi && activeTool === 'pen' && e.key === 'Escape') {
          e.preventDefault()
          setPenDraft(null)
          penPointerRef.current = null
        }
        if (!typingUi && activeTool === 'brush' && e.key === 'Escape') {
          e.preventDefault()
          brushStrokeRef.current = null
          setBrushPreview(null)
        }
        if (!typingUi && activeTool === 'pencil' && e.key === 'Escape') {
          e.preventDefault()
          pencilStrokeRef.current = null
          setPencilPreview(null)
        }
        if (!typingUi && activeTool === 'eraser' && e.key === 'Escape') {
          e.preventDefault()
          eraserStrokeRef.current = null
          setEraserPreview(null)
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
          if (
            activeTool === 'path-edit' ||
            activeTool === 'pen' ||
            activeTool === 'brush' ||
            activeTool === 'pencil' ||
            activeTool === 'eraser' ||
            activeTool === 'fill'
          ) {
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
        <defs>
          <clipPath id="canvas-guide-clip">
            <rect x={0} y={0} width={project.width} height={project.height} />
          </clipPath>
          {project.gradients.map((g) =>
            g.kind === 'linear' ? (
              <linearGradient
                key={g.id}
                id={g.id}
                x1={g.x1}
                y1={g.y1}
                x2={g.x2}
                y2={g.y2}
                gradientUnits={g.gradientUnits}
              >
                {g.stops.map((s, i) => (
                  <stop
                    key={`${g.id}-${i}`}
                    offset={`${Math.round(Math.max(0, Math.min(1, s.offset)) * 100)}%`}
                    stopColor={s.color}
                    stopOpacity={s.opacity ?? 1}
                  />
                ))}
              </linearGradient>
            ) : (
              <radialGradient
                key={g.id}
                id={g.id}
                cx={g.cx}
                cy={g.cy}
                r={g.r}
                fx={g.fx}
                fy={g.fy}
                gradientUnits={g.gradientUnits}
              >
                {g.stops.map((s, i) => (
                  <stop
                    key={`${g.id}-${i}`}
                    offset={`${Math.round(Math.max(0, Math.min(1, s.offset)) * 100)}%`}
                    stopColor={s.color}
                    stopOpacity={s.opacity ?? 1}
                  />
                ))}
              </radialGradient>
            )
          )}
        </defs>
        {canvasGuideType !== 'none' &&
          canvasGuideOverlayVisible &&
          mode !== 'export' && (
          <>
            {/* Clip grid lines to artboard only; VP handles can sit outside and stay visible. */}
            <g clipPath="url(#canvas-guide-clip)" pointerEvents="none" aria-hidden>
              <CanvasGuideOverlay
                type={canvasGuideType}
                w={project.width}
                h={project.height}
                spacing={canvasGuideSpacing}
                opacity={canvasGuideOpacity}
                strokeColor={canvasGuideColor}
                vp1={canvasGuideVp1}
                vpLeft={canvasGuideVpLeft}
                vpRight={canvasGuideVpRight}
                vpTop={canvasGuideVpTop}
                fisheyeCenter={canvasGuideFisheyeCenter}
              />
            </g>
            <g pointerEvents="auto" aria-hidden>
              {canvasGuideType === 'perspective1' && (
                <circle
                  cx={canvasGuideVp1.nx * project.width}
                  cy={canvasGuideVp1.ny * project.height}
                  r={9}
                  fill="var(--accent, #5b8def)"
                  fillOpacity={0.85}
                  stroke="#fff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(ev) => {
                    ev.stopPropagation()
                    ev.preventDefault()
                    guideVpDragRef.current = { kind: 'vp1', pointerId: ev.pointerId }
                    ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                  }}
                >
                  <title>Drag vanishing point</title>
                </circle>
              )}
              {canvasGuideType === 'perspective2' && (
                <>
                  <circle
                    cx={canvasGuideVpLeft.nx * project.width}
                    cy={canvasGuideVpLeft.ny * project.height}
                    r={9}
                    fill="#8b5cf6"
                    fillOpacity={0.9}
                    stroke="#fff"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      guideVpDragRef.current = { kind: 'vpL', pointerId: ev.pointerId }
                      ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                    }}
                  >
                    <title>Drag left vanishing point</title>
                  </circle>
                  <circle
                    cx={canvasGuideVpRight.nx * project.width}
                    cy={canvasGuideVpRight.ny * project.height}
                    r={9}
                    fill="#06b6d4"
                    fillOpacity={0.9}
                    stroke="#fff"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      guideVpDragRef.current = { kind: 'vpR', pointerId: ev.pointerId }
                      ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                    }}
                  >
                    <title>Drag right vanishing point</title>
                  </circle>
                </>
              )}
              {canvasGuideType === 'perspective3' && (
                <>
                  <circle
                    cx={canvasGuideVpLeft.nx * project.width}
                    cy={canvasGuideVpLeft.ny * project.height}
                    r={9}
                    fill="#8b5cf6"
                    fillOpacity={0.9}
                    stroke="#fff"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      guideVpDragRef.current = { kind: 'vpL', pointerId: ev.pointerId }
                      ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                    }}
                  >
                    <title>Drag left vanishing point</title>
                  </circle>
                  <circle
                    cx={canvasGuideVpRight.nx * project.width}
                    cy={canvasGuideVpRight.ny * project.height}
                    r={9}
                    fill="#06b6d4"
                    fillOpacity={0.9}
                    stroke="#fff"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      guideVpDragRef.current = { kind: 'vpR', pointerId: ev.pointerId }
                      ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                    }}
                  >
                    <title>Drag right vanishing point</title>
                  </circle>
                  <circle
                    cx={canvasGuideVpTop.nx * project.width}
                    cy={canvasGuideVpTop.ny * project.height}
                    r={9}
                    fill="#f59e0b"
                    fillOpacity={0.9}
                    stroke="#fff"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      guideVpDragRef.current = { kind: 'vpT', pointerId: ev.pointerId }
                      ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                    }}
                  >
                    <title>Drag top vanishing point</title>
                  </circle>
                </>
              )}
              {canvasGuideType === 'fisheye' && (
                <circle
                  cx={canvasGuideFisheyeCenter.nx * project.width}
                  cy={canvasGuideFisheyeCenter.ny * project.height}
                  r={10}
                  fill="#ec4899"
                  fillOpacity={0.85}
                  stroke="#fff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(ev) => {
                    ev.stopPropagation()
                    ev.preventDefault()
                    guideVpDragRef.current = { kind: 'fish', pointerId: ev.pointerId }
                    ;(ev.currentTarget.ownerSVGElement as SVGSVGElement)?.setPointerCapture(ev.pointerId)
                  }}
                >
                  <title>Drag fisheye center</title>
                </circle>
              )}
            </g>
          </>
        )}
        <ElementRenderer
          elements={project.elements}
          symbols={project.symbols}
          tracks={tracks}
          currentTime={currentTime}
          gsapCanvasDriver={gsapCanvasDriver}
          activeTool={activeTool}
          onElementPointerDown={onElementPointerDown}
        />
        {marqueeRect && (
          <rect
            pointerEvents="none"
            x={marqueeRect.x}
            y={marqueeRect.y}
            width={marqueeRect.width}
            height={marqueeRect.height}
            fill="rgba(91,141,239,0.14)"
            stroke="#5b8def"
            strokeDasharray="4 3"
          />
        )}
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
        {pencilPreview && pencilPreview.length > 1 && (
          <polyline
            pointerEvents="none"
            fill="none"
            stroke={pencilSettings.color}
            strokeWidth={pencilSettings.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
            points={pencilPreview.map((q) => `${q.x},${q.y}`).join(' ')}
          />
        )}
        {eraserPreview && eraserPreview.length > 1 && (
          <polyline
            pointerEvents="none"
            fill="none"
            stroke="rgba(239,68,68,0.55)"
            strokeWidth={eraserSettings.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 4"
            points={eraserPreview.map((q) => `${q.x},${q.y}`).join(' ')}
          />
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
      {mode === 'draw' && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 11,
            pointerEvents: 'auto',
            maxWidth: canvasGuidePanelCollapsed ? 200 : 288
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: canvasGuidePanelCollapsed ? 0 : 10,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: canvasGuidePanelCollapsed ? '8px 10px' : '10px 12px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.22)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Tooltip content={canvasGuidePanelCollapsed ? 'Expand guides panel' : 'Collapse panel'}>
              <button
                type="button"
                onClick={() => setCanvasGuidePanelCollapsed(!canvasGuidePanelCollapsed)}
                style={{
                  width: 32,
                  height: 32,
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-app)',
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                <FontAwesomeIcon icon={canvasGuidePanelCollapsed ? faChevronRight : faChevronDown} />
              </button>
              </Tooltip>
              <Tooltip content={canvasGuideOverlayVisible ? 'Hide grid overlay' : 'Show grid overlay'}>
              <button
                type="button"
                onClick={() => setCanvasGuideOverlayVisible(!canvasGuideOverlayVisible)}
                style={{
                  width: 32,
                  height: 32,
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: canvasGuideOverlayVisible ? 'var(--bg-app)' : 'var(--accent-muted, rgba(91,141,239,0.15))',
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                <FontAwesomeIcon icon={canvasGuideOverlayVisible ? faEye : faEyeSlash} />
              </button>
              </Tooltip>
              <Tooltip content="Grid line color">
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginLeft: 'auto',
                  cursor: 'pointer'
                }}
              >
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Color</span>
                <input
                  type="color"
                  value={canvasGuideColor.startsWith('#') ? canvasGuideColor : '#94a3b8'}
                  onChange={(e) => setCanvasGuideColor(e.target.value)}
                  style={{ width: 32, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 6 }}
                />
              </label>
              </Tooltip>
            </div>

            {!canvasGuidePanelCollapsed && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                  CANVAS GUIDES
                </div>
                <p style={{ margin: '-6px 0 0', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  Overlay only — not exported. Drag colored handles to move vanishing points / fisheye center.
                </p>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  Type
                  <select
                    value={canvasGuideType}
                    onChange={(e) => setCanvasGuideType(e.target.value as CanvasGuideType)}
                  >
                    <option value="none">Off</option>
                    <option value="square">Square grid</option>
                    <option value="isometric">Isometric grid</option>
                    <option value="perspective1">1-point perspective</option>
                    <option value="perspective2">2-point perspective</option>
                    <option value="perspective3">3-point perspective</option>
                    <option value="fisheye">Fisheye grid</option>
                  </select>
                </label>
                {canvasGuideType !== 'none' && (
                  <>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      Spacing
                      <input
                        type="range"
                        min={8}
                        max={120}
                        step={2}
                        value={canvasGuideSpacing}
                        onChange={(e) => setCanvasGuideSpacing(Number(e.target.value))}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      Opacity
                      <input
                        type="range"
                        min={0.06}
                        max={0.55}
                        step={0.02}
                        value={canvasGuideOpacity}
                        onChange={(e) => setCanvasGuideOpacity(Number(e.target.value))}
                      />
                    </label>
                    {(canvasGuideType === 'perspective1' ||
                      canvasGuideType === 'perspective2' ||
                      canvasGuideType === 'perspective3') && (
                      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                        Horizon line (syncs side VPs)
                        <input
                          type="range"
                          min={0.08}
                          max={0.92}
                          step={0.01}
                          value={canvasGuideHorizon}
                          onChange={(e) => setCanvasGuideHorizon(Number(e.target.value))}
                        />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {mode === 'draw' && activeTool === 'pencil' && (
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
              gridTemplateColumns: 'repeat(3, auto)',
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
              Smoothing
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={pencilSettings.smoothing}
                onChange={(e) =>
                  setPencilSettings((s) => ({
                    ...s,
                    smoothing: Number(e.target.value)
                  }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Stroke
              <input
                type="range"
                min={0.5}
                max={16}
                step={0.5}
                value={pencilSettings.strokeWidth}
                onChange={(e) =>
                  setPencilSettings((s) => ({
                    ...s,
                    strokeWidth: Number(e.target.value)
                  }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Color
              <input
                type="color"
                value={pencilSettings.color}
                onChange={(e) =>
                  setPencilSettings((s) => ({
                    ...s,
                    color: e.target.value
                  }))
                }
                style={{ width: 44, height: 28, padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </label>
          </div>
        </div>
      )}
      {mode === 'draw' && activeTool === 'fill' && (
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
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 14px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              fontSize: 11,
              color: 'var(--text-muted)'
            }}
          >
            <span style={{ maxWidth: 220, lineHeight: 1.35 }}>
              Samples the canvas as an image, flood-fills similar color from the click, then traces the region into a path.
            </span>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Color tolerance
              <input
                type="range"
                min={8}
                max={120}
                value={rasterFillOpts.tolerance}
                onChange={(e) =>
                  setRasterFillOpts((o) => ({ ...o, tolerance: Number(e.target.value) }))
                }
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Curve simplify
              <input
                type="range"
                min={0.2}
                max={6}
                step={0.1}
                value={rasterFillOpts.simplifyEpsilon}
                onChange={(e) =>
                  setRasterFillOpts((o) => ({ ...o, simplifyEpsilon: Number(e.target.value) }))
                }
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Fill
              <input
                type="color"
                value={pencilSettings.color}
                onChange={(e) =>
                  setPencilSettings((s) => ({
                    ...s,
                    color: e.target.value
                  }))
                }
                style={{ width: 44, height: 28, padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </label>
          </div>
        </div>
      )}
      {mode === 'draw' && activeTool === 'eraser' && (
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
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 10px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)'
            }}
          >
            <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              Width
              <input
                type="range"
                min={4}
                max={120}
                step={2}
                value={eraserSettings.width}
                onChange={(e) =>
                  setEraserSettings((s) => ({
                    ...s,
                    width: Number(e.target.value)
                  }))
                }
              />
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Drag on canvas to subtract areas.</span>
          </div>
        </div>
      )}
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
