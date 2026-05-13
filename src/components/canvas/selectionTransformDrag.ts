import type { Transform, VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { sampleMergedTransformForElement } from '@/engines/animation/gsapTrackCompiler'
import { flattenForLayers } from '@/engines/document/tree'
import {
  affineAroundPivot,
  composeSvgTransformMatrix,
  decomposeSvgTransformMatrix,
  parentWorldMatrix
} from '@/engines/geometry/svgWorldTransform'

export type TransformDragTarget = {
  id: string
  startTransform: Pick<Transform, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'skewX' | 'skewY'>
  worldStart: DOMMatrix
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

export function elementWorldMatrix(dom: SVGGraphicsElement, transform: Transform): DOMMatrix {
  const fromDom = dom.getCTM()
  if (fromDom) return DOMMatrix.fromMatrix(fromDom)
  return parentWorldMatrix(dom).multiply(composeSvgTransformMatrix(transform))
}

export function inverseParentWorldMatrix(dom: SVGGraphicsElement): DOMMatrix {
  try {
    return parentWorldMatrix(dom).inverse()
  } catch {
    return new DOMMatrix()
  }
}

function approxZero(n: number) {
  return Math.abs(n) < 1e-6
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
    if (!dom) {
      targets.push({
        id,
        startTransform,
        worldStart: composeSvgTransformMatrix(startTransform as Transform),
        parentWorldInv: new DOMMatrix()
      })
      continue
    }
    targets.push({
      id,
      startTransform,
      worldStart: elementWorldMatrix(dom, startTransform as Transform),
      parentWorldInv: inverseParentWorldMatrix(dom)
    })
  }

  return targets
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
      if (approxZero(st.rotation) && approxZero(st.skewX) && approxZero(st.skewY)) {
        const v0x = st.x - pivotSvg.x
        const v0y = st.y - pivotSvg.y
        updates.push({
          id: target.id,
          partial: {
            x: pivotSvg.x + v0x * s,
            y: pivotSvg.y + v0y * s,
            scaleX: Math.max(0.05, st.scaleX * s),
            scaleY: Math.max(0.05, st.scaleY * s)
          }
        })
        continue
      }
      const scaleOp = new DOMMatrix().scaleSelf(s, s)
      const worldNew = affineAroundPivot(target.worldStart, pivotSvg, scaleOp)
      const localNew = target.parentWorldInv.multiply(worldNew)
      const next = decomposeSvgTransformMatrix(localNew)
      updates.push({
        id: target.id,
        partial: {
          ...next,
          skewX: st.skewX,
          skewY: st.skewY
        }
      })
    }
    return updates
  }

  const ang = (Math.atan2(curSvg.y - pivotSvg.y, curSvg.x - pivotSvg.x) * 180) / Math.PI
  const delta = ang - startAngle
  const rotateOp = new DOMMatrix().rotateSelf(delta)
  for (const target of targets) {
    const worldNew = affineAroundPivot(target.worldStart, pivotSvg, rotateOp)
    const localNew = target.parentWorldInv.multiply(worldNew)
    const next = decomposeSvgTransformMatrix(localNew)
    updates.push({
      id: target.id,
      partial: {
        ...next,
        skewX: target.startTransform.skewX,
        skewY: target.startTransform.skewY
      }
    })
  }
  return updates
}
