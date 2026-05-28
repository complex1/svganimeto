/**
 * Compute an element's *local* bbox center — i.e. where the shape lives inside
 * its own coordinate system, before its `transform` is applied. This is what we
 * need to know to anchor a layer's visible centre on a motion path (instead of
 * landing the element's local origin (0,0), which is usually off-shape and makes
 * the layer swing wide when it follows a curve).
 *
 * For attribute-based shapes (rect/circle/ellipse/line/image) the math is closed
 * form. For `path`/`polygon`/`polyline` we fall back to a DOM `getBBox()` measure
 * which is cached by the source `d` / `points` string — so playback samples don't
 * pay the cost on every frame.
 */
import type { VectorElement } from '@/types/document'

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

type BBox = { x: number; y: number; width: number; height: number }

/**
 * Memo for DOM-measured bboxes. Keys are `"path|<d>"` or `"poly|<points>"`. Capped
 * with a tiny LRU so long-running sessions can't leak.
 */
const BBOX_CACHE = new Map<string, BBox | null>()
const BBOX_CACHE_LIMIT = 256

function rememberBBox(key: string, value: BBox | null): BBox | null {
  if (BBOX_CACHE.size >= BBOX_CACHE_LIMIT) {
    /** Drop the oldest entry (Map preserves insertion order). */
    const firstKey = BBOX_CACHE.keys().next().value
    if (firstKey !== undefined) BBOX_CACHE.delete(firstKey)
  }
  BBOX_CACHE.set(key, value)
  return value
}

function measureGeometryBBox(tag: 'path' | 'polygon' | 'polyline', attr: 'd' | 'points', value: string): BBox | null {
  const key = `${tag}|${value}`
  if (BBOX_CACHE.has(key)) return BBOX_CACHE.get(key) ?? null
  if (typeof document === 'undefined') return rememberBBox(key, null)
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    /**
     * `getBBox()` requires the element to be in the live DOM in some engines.
     * Stash it in a hidden absolute container so it never affects layout.
     */
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.style.position = 'absolute'
    svg.style.left = '-99999px'
    svg.style.top = '-99999px'
    svg.style.visibility = 'hidden'
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    node.setAttribute(attr, value)
    svg.appendChild(node)
    document.body.appendChild(svg)
    const bb = node.getBBox()
    document.body.removeChild(svg)
    if (!Number.isFinite(bb.width) || !Number.isFinite(bb.height)) {
      return rememberBBox(key, null)
    }
    return rememberBBox(key, { x: bb.x, y: bb.y, width: bb.width, height: bb.height })
  } catch {
    return rememberBBox(key, null)
  }
}

/**
 * Best-effort local bbox of an element's own geometry (children are NOT included
 * — groups return null, callers should fall back to (0,0) anchoring).
 */
export function getLocalShapeBBox(el: VectorElement): BBox | null {
  const a = el.attrs
  switch (el.type) {
    case 'rect':
    case 'image': {
      const x = num(a.x)
      const y = num(a.y)
      const w = num(a.width)
      const h = num(a.height)
      if (w <= 0 || h <= 0) return null
      return { x, y, width: w, height: h }
    }
    case 'circle': {
      const cx = num(a.cx)
      const cy = num(a.cy)
      const r = num(a.r)
      if (r <= 0) return null
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 }
    }
    case 'ellipse': {
      const cx = num(a.cx)
      const cy = num(a.cy)
      const rx = num(a.rx)
      const ry = num(a.ry)
      if (rx <= 0 || ry <= 0) return null
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }
    }
    case 'line': {
      const x1 = num(a.x1)
      const y1 = num(a.y1)
      const x2 = num(a.x2)
      const y2 = num(a.y2)
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1)
      }
    }
    case 'path': {
      if (typeof a.d === 'string' && a.d.length > 0) {
        return measureGeometryBBox('path', 'd', a.d)
      }
      return null
    }
    case 'polygon':
    case 'polyline': {
      if (typeof a.points === 'string' && a.points.length > 0) {
        return measureGeometryBBox(el.type, 'points', a.points)
      }
      return null
    }
    default:
      return null
  }
}

export function getLocalShapeCenter(el: VectorElement): { x: number; y: number } | null {
  const bb = getLocalShapeBBox(el)
  if (!bb) return null
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }
}
