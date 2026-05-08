import type { ReactElement } from 'react'
import type { CanvasGuideType, GuidePointNorm } from '@/types/canvasGuide'

type Props = {
  type: CanvasGuideType
  w: number
  h: number
  spacing: number
  opacity: number
  strokeColor: string
  vp1: GuidePointNorm
  vpLeft: GuidePointNorm
  vpRight: GuidePointNorm
  vpTop: GuidePointNorm
  fisheyeCenter: GuidePointNorm
}

function longLine(
  cx: number,
  cy: number,
  rad: number,
  extend: number
): { x1: number; y1: number; x2: number; y2: number } {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return {
    x1: cx - c * extend,
    y1: cy - s * extend,
    x2: cx + c * extend,
    y2: cy + s * extend
  }
}

function SquareGrid({
  w,
  h,
  spacing,
  opacity,
  stroke
}: {
  w: number
  h: number
  spacing: number
  opacity: number
  stroke: string
}) {
  const s = Math.max(8, spacing)
  const lines: ReactElement[] = []
  let k = 0
  for (let x = 0; x <= w; x += s) {
    lines.push(
      <line key={`v-${k++}`} x1={x} y1={0} x2={x} y2={h} stroke={stroke} strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
    )
  }
  for (let y = 0; y <= h; y += s) {
    lines.push(
      <line key={`h-${k++}`} x1={0} y1={y} x2={w} y2={y} stroke={stroke} strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
    )
  }
  return <g opacity={opacity}>{lines}</g>
}

function IsometricGrid({
  w,
  h,
  spacing,
  opacity,
  stroke
}: {
  w: number
  h: number
  spacing: number
  opacity: number
  stroke: string
}) {
  const s = Math.max(10, spacing)
  const extend = Math.hypot(w, h) * 1.5
  const θ = Math.PI / 6
  const nx = -Math.sin(θ)
  const ny = Math.cos(θ)
  const lines: ReactElement[] = []
  let k = 0

  for (let x = 0; x <= w; x += s) {
    const seg = longLine(x, 0, Math.PI / 2, extend)
    lines.push(
      <line
        key={`iso-v-${k++}`}
        x1={seg.x1}
        y1={seg.y1}
        x2={seg.x2}
        y2={seg.y2}
        stroke={stroke}
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
    )
  }

  const count = Math.ceil((w + h) / s) + 4
  for (let i = -count; i <= count; i += 1) {
    const ox = i * s * nx + w * 0.5
    const oy = i * s * ny + h * 0.5
    const segA = longLine(ox, oy, θ, extend)
    lines.push(
      <line
        key={`iso-a-${k++}`}
        x1={segA.x1}
        y1={segA.y1}
        x2={segA.x2}
        y2={segA.y2}
        stroke={stroke}
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
    )
    const segB = longLine(ox, oy, -θ, extend)
    lines.push(
      <line
        key={`iso-b-${k++}`}
        x1={segB.x1}
        y1={segB.y1}
        x2={segB.x2}
        y2={segB.y2}
        stroke={stroke}
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
    )
  }

  return <g opacity={opacity}>{lines}</g>
}

function Perspective1({
  w,
  h,
  spacing,
  vp,
  opacity,
  stroke
}: {
  w: number
  h: number
  spacing: number
  vp: { x: number; y: number }
  opacity: number
  stroke: string
}) {
  const hy = vp.y
  const extend = Math.hypot(w, h) * 2
  const lines: ReactElement[] = []
  let k = 0

  lines.push(
    <line key="hz" x1={0} y1={hy} x2={w} y2={hy} stroke={stroke} strokeWidth={1} opacity={0.9} vectorEffect="non-scaling-stroke" />
  )

  const rays = 24
  for (let i = 0; i < rays; i += 1) {
    const a = (-Math.PI * 0.48 + (Math.PI * 0.96 * i) / (rays - 1))
    const seg = longLine(vp.x, vp.y, a, extend)
    lines.push(
      <line key={`r-${k++}`} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={stroke} strokeWidth={0.65} vectorEffect="non-scaling-stroke" />
    )
  }

  const s = Math.max(12, spacing)
  for (let y = hy + s; y <= h + s; y += s) {
    lines.push(<line key={`hf-${k++}`} x1={0} y1={y} x2={w} y2={y} stroke={stroke} strokeWidth={0.55} vectorEffect="non-scaling-stroke" />)
  }
  for (let y = hy - s; y >= -s; y -= s) {
    lines.push(<line key={`ha-${k++}`} x1={0} y1={y} x2={w} y2={y} stroke={stroke} strokeWidth={0.55} vectorEffect="non-scaling-stroke" />)
  }

  return <g opacity={opacity}>{lines}</g>
}

function Perspective2({
  w,
  h,
  spacing,
  vpL,
  vpR,
  opacity,
  stroke
}: {
  w: number
  h: number
  spacing: number
  vpL: { x: number; y: number }
  vpR: { x: number; y: number }
  opacity: number
  stroke: string
}) {
  const hy = (vpL.y + vpR.y) / 2
  const extend = Math.hypot(w, h) * 2.5
  const lines: ReactElement[] = []
  let k = 0

  lines.push(
    <line key="hz" x1={0} y1={hy} x2={w} y2={hy} stroke={stroke} strokeWidth={1} opacity={0.85} vectorEffect="non-scaling-stroke" />
  )

  const s = Math.max(12, spacing)
  for (let x = 0; x <= w; x += s) {
    lines.push(
      <line key={`v-${k++}`} x1={x} y1={0} x2={x} y2={h} stroke={stroke} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    )
  }

  const steps = Math.ceil(h / s) + 2
  for (let i = 0; i <= steps; i += 1) {
    const y = i * s
    const segL = longLine(vpL.x, vpL.y, Math.atan2(y - vpL.y, w - vpL.x), extend)
    lines.push(<line key={`fl-${k++}`} x1={segL.x1} y1={segL.y1} x2={segL.x2} y2={segL.y2} stroke={stroke} strokeWidth={0.55} vectorEffect="non-scaling-stroke" />)
    const segR = longLine(vpR.x, vpR.y, Math.atan2(y - vpR.y, 0 - vpR.x), extend)
    lines.push(<line key={`fr-${k++}`} x1={segR.x1} y1={segR.y1} x2={segR.x2} y2={segR.y2} stroke={stroke} strokeWidth={0.55} vectorEffect="non-scaling-stroke" />)
  }

  return <g opacity={opacity}>{lines}</g>
}

function Perspective3({
  w,
  h,
  spacing,
  vpL,
  vpR,
  vpT,
  opacity,
  stroke
}: {
  w: number
  h: number
  spacing: number
  vpL: { x: number; y: number }
  vpR: { x: number; y: number }
  vpT: { x: number; y: number }
  opacity: number
  stroke: string
}) {
  const hy = (vpL.y + vpR.y) / 2
  const extend = Math.hypot(w, h) * 2.8
  const lines: ReactElement[] = []
  let k = 0

  lines.push(
    <line key="hz" x1={0} y1={hy} x2={w} y2={hy} stroke={stroke} strokeWidth={1} opacity={0.85} vectorEffect="non-scaling-stroke" />
  )

  const s = Math.max(12, spacing)
  for (let x = 0; x <= w; x += s) {
    lines.push(
      <line key={`v-${k++}`} x1={x} y1={0} x2={x} y2={h} stroke={stroke} strokeWidth={0.55} vectorEffect="non-scaling-stroke" />
    )
  }

  const steps = Math.ceil(h / s) + 2
  for (let i = 0; i <= steps; i += 1) {
    const y = i * s
    const segL = longLine(vpL.x, vpL.y, Math.atan2(y - vpL.y, w - vpL.x), extend)
    lines.push(<line key={`fl-${k++}`} x1={segL.x1} y1={segL.y1} x2={segL.x2} y2={segL.y2} stroke={stroke} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />)
    const segR = longLine(vpR.x, vpR.y, Math.atan2(y - vpR.y, 0 - vpR.x), extend)
    lines.push(<line key={`fr-${k++}`} x1={segR.x1} y1={segR.y1} x2={segR.x2} y2={segR.y2} stroke={stroke} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />)
  }

  const bottomSteps = Math.ceil(w / s) + 2
  for (let j = 0; j <= bottomSteps; j += 1) {
    const x = j * s
    const segD = longLine(vpT.x, vpT.y, Math.atan2(h - vpT.y, x - vpT.x), extend)
    lines.push(<line key={`fd-${k++}`} x1={segD.x1} y1={segD.y1} x2={segD.x2} y2={segD.y2} stroke={stroke} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />)
  }

  return <g opacity={opacity}>{lines}</g>
}

/** Curved radial grid — denser rings near center for a fisheye construction helper. */
function FisheyeGrid({
  w,
  h,
  spacing,
  center,
  opacity,
  stroke
}: {
  w: number
  h: number
  spacing: number
  center: { x: number; y: number }
  opacity: number
  stroke: string
}) {
  const maxR = Math.hypot(w, h) * 0.72
  const radials = Math.max(12, Math.min(48, Math.round(360 / Math.max(8, spacing * 0.35))))
  const rings = Math.max(8, Math.min(40, Math.round(maxR / Math.max(10, spacing * 0.45))))
  const lines: ReactElement[] = []
  let k = 0

  for (let i = 0; i < radials; i += 1) {
    const a = (i / radials) * Math.PI * 2
    const seg = longLine(center.x, center.y, a, maxR)
    lines.push(
      <line key={`rad-${k++}`} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={stroke} strokeWidth={0.65} vectorEffect="non-scaling-stroke" />
    )
  }

  for (let i = 1; i <= rings; i += 1) {
    const t = i / rings
    const r = maxR * Math.pow(t, 0.52)
    lines.push(
      <circle
        key={`ring-${k++}`}
        cx={center.x}
        cy={center.y}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={0.55}
        vectorEffect="non-scaling-stroke"
      />
    )
  }

  return <g opacity={opacity}>{lines}</g>
}

/** Construction guides clipped to artboard; not exported with artwork. */
export function CanvasGuideOverlay({
  type,
  w,
  h,
  spacing,
  opacity,
  strokeColor,
  vp1,
  vpLeft,
  vpRight,
  vpTop,
  fisheyeCenter
}: Props) {
  if (type === 'none' || w <= 0 || h <= 0) return null
  const o = Math.max(0.06, Math.min(0.55, opacity))
  const stroke = strokeColor.trim() || '#94a3b8'

  const p1 = { x: vp1.nx * w, y: vp1.ny * h }
  const pL = { x: vpLeft.nx * w, y: vpLeft.ny * h }
  const pR = { x: vpRight.nx * w, y: vpRight.ny * h }
  const pT = { x: vpTop.nx * w, y: vpTop.ny * h }
  const fc = { x: fisheyeCenter.nx * w, y: fisheyeCenter.ny * h }

  switch (type) {
    case 'square':
      return <SquareGrid w={w} h={h} spacing={spacing} opacity={o} stroke={stroke} />
    case 'isometric':
      return <IsometricGrid w={w} h={h} spacing={spacing} opacity={o} stroke={stroke} />
    case 'perspective1':
      return <Perspective1 w={w} h={h} spacing={spacing} vp={p1} opacity={o} stroke={stroke} />
    case 'perspective2':
      return <Perspective2 w={w} h={h} spacing={spacing} vpL={pL} vpR={pR} opacity={o} stroke={stroke} />
    case 'perspective3':
      return <Perspective3 w={w} h={h} spacing={spacing} vpL={pL} vpR={pR} vpT={pT} opacity={o} stroke={stroke} />
    case 'fisheye':
      return <FisheyeGrid w={w} h={h} spacing={spacing} center={fc} opacity={o} stroke={stroke} />
    default:
      return null
  }
}
