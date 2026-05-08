/** Visual axis-aligned bbox of `elem` mapped into root SVG coordinate space (`svg` viewport user units). */
export function bboxInSvgRootSpace(
  elem: SVGGraphicsElement,
  svg: SVGSVGElement
): { x: number; y: number; width: number; height: number } | null {
  try {
    const r = elem.getBoundingClientRect()
    if (r.width <= 0 && r.height <= 0) return null

    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const inv = ctm.inverse()
    const pt = svg.createSVGPoint()

    const corners = [
      { x: r.left, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: r.left, y: r.bottom }
    ]

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const c of corners) {
      pt.x = c.x
      pt.y = c.y
      const p = pt.matrixTransform(inv)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(maxX - minX, 0),
      height: Math.max(maxY - minY, 0)
    }
  } catch {
    return null
  }
}
