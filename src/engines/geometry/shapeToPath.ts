/** Convert primitive shapes to equivalent path `d` for booleans / editing. */

export function parsePointList(input: string) {
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

export function rectToPathD(x: number, y: number, w: number, h: number, rx = 0, ry = 0) {
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

export function elementShapeToPathD(type: string, attrs: Record<string, unknown>) {
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
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    return type === 'polygon' ? `${d} Z` : d
  }
  return null
}
