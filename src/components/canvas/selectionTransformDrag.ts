import type { Transform, VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { sampleMergedTransformForElement } from '@/engines/animation/gsapTrackCompiler'
import { flattenForLayers } from '@/engines/document/tree'
import { parentWorldMatrix } from '@/engines/geometry/svgWorldTransform'
import {
  type Mat2D,
  rotateAboutMat,
  scaleAboutMat,
  translateMat
} from '@/engines/geometry/transformGeometry'

/**
 * One drag target. We rotate / scale around a pivot expressed in the SVG root user
 * space, but the element's `x`/`y` live in the parent's *local* coordinate system,
 * so we precompute `parentWorldInv` to convert pivot -> parent-local once.
 */
export type TransformDragTarget = {
  id: string
  startTransform: Pick<Transform, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'skewX' | 'skewY'>
  /** Inverse of the parent's world matrix; used to convert a world-space pivot into parent-local. */
  parentWorldInv: DOMMatrix
}

export function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

export function inverseParentWorldMatrix(dom: SVGGraphicsElement): DOMMatrix {
  try {
    return parentWorldMatrix(dom).inverse()
  } catch {
    return new DOMMatrix()
  }
}

function transformPoint(m: DOMMatrix, x: number, y: number) {
  const px = m.a * x + m.c * y + m.e
  const py = m.b * x + m.d * y + m.f
  return { x: px, y: py }
}

function rotate2d(x: number, y: number, deg: number) {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: x * c - y * s, y: x * s + y * c }
}

function dragStartTransform(
  el: VectorElement,
  rootElements: VectorElement[],
  tracks: AnimationTrack[],
  timeSec: number,
  mergeAnimationTracks: boolean,
  gsapCanvasDriver: boolean
): Pick<Transform, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'skewX' | 'skewY'> {
  const tr = mergeAnimationTracks
    ? sampleMergedTransformForElement(el, rootElements, tracks, timeSec, gsapCanvasDriver)
    : el.transform
  return {
    x: tr.x,
    y: tr.y,
    scaleX: tr.scaleX,
    scaleY: tr.scaleY,
    rotation: tr.rotation,
    skewX: tr.skewX,
    skewY: tr.skewY
  }
}

export function buildTransformDragTargets(
  svg: SVGSVGElement,
  rootElements: VectorElement[],
  selectedIds: string[],
  tracks: AnimationTrack[],
  timeSec: number,
  mergeAnimationTracks: boolean,
  gsapCanvasDriver: boolean
): TransformDragTarget[] {
  const elementMap = new Map(flattenForLayers(rootElements).map((n) => [n.el.id, n.el]))
  const targets: TransformDragTarget[] = []

  for (const id of selectedIds) {
    const elStore = elementMap.get(id)
    if (!elStore || elStore.locked) continue
    const dom = svg.querySelector(`[data-el-id="${CSS.escape(id)}"]`) as SVGGraphicsElement | null
    const startTransform = dragStartTransform(
      elStore,
      rootElements,
      tracks,
      timeSec,
      mergeAnimationTracks,
      gsapCanvasDriver
    )
    targets.push({
      id,
      startTransform,
      parentWorldInv: dom ? inverseParentWorldMatrix(dom) : new DOMMatrix()
    })
  }

  return targets
}

/**
 * Compute partial transform updates for an in-progress drag.
 *
 * All math runs directly on (x, y, scaleX, scaleY, rotation) — no decomposition of a world
 * matrix — so we can't lose precision and rotation is guaranteed to happen *around* the pivot.
 */
/**
 * The same move / scale / rotate gesture expressed as a single affine matrix in
 * SVG-root space. Geometry baking (Tier A elements) applies this to the points;
 * the transform-partial variant below is kept for Tier B (group/text/image).
 */
export function computeDragMatrix(
  pivotSvg: { x: number; y: number },
  startSvg: { x: number; y: number },
  curSvg: { x: number; y: number },
  startDist: number,
  startAngle: number,
  kind: 'move' | 'scale' | 'rotate'
): Mat2D {
  if (kind === 'move') {
    return translateMat(curSvg.x - startSvg.x, curSvg.y - startSvg.y)
  }
  if (kind === 'scale') {
    const dist = Math.hypot(curSvg.x - pivotSvg.x, curSvg.y - pivotSvg.y) || 1
    const s = dist / startDist
    return scaleAboutMat(s, s, pivotSvg.x, pivotSvg.y)
  }
  const ang = (Math.atan2(curSvg.y - pivotSvg.y, curSvg.x - pivotSvg.x) * 180) / Math.PI
  return rotateAboutMat(ang - startAngle, pivotSvg.x, pivotSvg.y)
}

export function applyTransformDragMove(
  targets: TransformDragTarget[],
  pivotSvg: { x: number; y: number },
  startSvg: { x: number; y: number },
  curSvg: { x: number; y: number },
  startDist: number,
  startAngle: number,
  kind: 'move' | 'scale' | 'rotate'
): Array<{ id: string; partial: Partial<Transform> }> {
  const updates: Array<{ id: string; partial: Partial<Transform> }> = []

  if (kind === 'move') {
    const dx = curSvg.x - startSvg.x
    const dy = curSvg.y - startSvg.y
    for (const target of targets) {
      updates.push({
        id: target.id,
        partial: {
          x: target.startTransform.x + dx,
          y: target.startTransform.y + dy
        }
      })
    }
    return updates
  }

  if (kind === 'scale') {
    const dist = Math.hypot(curSvg.x - pivotSvg.x, curSvg.y - pivotSvg.y) || 1
    const s = dist / startDist
    for (const target of targets) {
      const st = target.startTransform
      // Pivot in parent-local coords (where x/y live).
      const pivotLocal = transformPoint(target.parentWorldInv, pivotSvg.x, pivotSvg.y)
      const vx = st.x - pivotLocal.x
      const vy = st.y - pivotLocal.y
      updates.push({
        id: target.id,
        partial: {
          x: pivotLocal.x + vx * s,
          y: pivotLocal.y + vy * s,
          scaleX: Math.max(0.05, st.scaleX * s),
          scaleY: Math.max(0.05, st.scaleY * s)
        }
      })
    }
    return updates
  }

  const ang = (Math.atan2(curSvg.y - pivotSvg.y, curSvg.x - pivotSvg.x) * 180) / Math.PI
  const delta = ang - startAngle
  for (const target of targets) {
    const st = target.startTransform
    const pivotLocal = transformPoint(target.parentWorldInv, pivotSvg.x, pivotSvg.y)
    const vx = st.x - pivotLocal.x
    const vy = st.y - pivotLocal.y
    const r = rotate2d(vx, vy, delta)
    updates.push({
      id: target.id,
      partial: {
        x: pivotLocal.x + r.x,
        y: pivotLocal.y + r.y,
        rotation: st.rotation + delta
      }
    })
  }
  return updates
}
