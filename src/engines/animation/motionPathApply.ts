import type { AnimationTrack } from '@/types/animation'
import type { Transform, VectorElement } from '@/types/document'
import { sampleTrack } from '@/engines/animation/interpolate'
import { getPointOnPathAt } from '@/engines/geometry/svgPathMotion'
import { flattenForLayers } from '@/engines/document/tree'
import { getLocalShapeCenter } from '@/engines/geometry/localShapeBounds'

/**
 * After mergeTransformFromTracks, apply motion path so the layer rides along
 * another path layer's curve.
 *
 * Anchor semantics (matches "follow this path" intuition in most editors):
 *   - The follower's *visible centre* (local bbox center) is placed at the path
 *     sample point.
 *   - `tr.x`, `tr.y` continue to act as a *user* offset, so dragging the layer
 *     after assignment nudges the trajectory by the same delta.
 *   - When "Rotate to path tangent" is on, the follower's rotation is replaced
 *     with the path tangent angle AND the position is compensated so the visible
 *     centre stays on the path (the layer pivots about its centre, not about its
 *     local origin — that's the bug this addresses).
 *
 * Math: we want `applyTransform(localCenter) = (anchor + userOffset)` where the
 * outer transform string is `translate(x,y) rotate(r) scale(sx,sy)`. Solving for
 * `(x, y)` gives:
 *     x = anchor.x + tr.x - (cx*sx*cos(r) - cy*sy*sin(r))
 *     y = anchor.y + tr.y - (cx*sx*sin(r) + cy*sy*cos(r))
 * where `(cx, cy)` is the local bbox centre. If we can't measure the centre
 * (e.g. unknown shape) we fall back to the legacy behaviour: anchor at local
 * origin.
 */
export function applyMotionPathToTransform(
  tr: Transform,
  el: VectorElement,
  roots: VectorElement[],
  tracks: AnimationTrack[],
  time: number
): Transform {
  const ownAttrs = el.attrs
  const targetId = typeof ownAttrs.__motionPathId === 'string' ? ownAttrs.__motionPathId : ''
  if (!targetId) return tr

  let offset = 0
  for (const track of tracks) {
    if (
      track.elementId !== el.id ||
      track.property !== 'motionPathOffset' ||
      track.keyframes.length === 0
    )
      continue
    const v = sampleTrack(track, time)
    if (v !== undefined) offset = Math.max(0, Math.min(1, v))
  }

  const loc = flattenForLayers(roots).find((x) => x.el.id === targetId)
  const pathEl = loc?.el
  const d =
    pathEl?.type === 'path' && typeof pathEl.attrs.d === 'string'
      ? pathEl.attrs.d
      : typeof pathEl?.attrs?.d === 'string'
        ? pathEl.attrs.d
        : ''
  if (!d || !pathEl) return tr

  const pt = getPointOnPathAt(d, offset)
  if (!pt) return tr

  /**
   * Anchor in document space: the visible path is rendered at
   * `pathEl.transform.translate + pt`, so the follower needs to land there.
   */
  const anchorX = (pathEl.transform?.x ?? 0) + pt.x
  const anchorY = (pathEl.transform?.y ?? 0) + pt.y

  const rotateWithPath =
    ownAttrs.__motionPathRotate === true || ownAttrs.__motionPathRotate === 1
  const finalRotation = rotateWithPath ? pt.angle : tr.rotation

  const center = getLocalShapeCenter(el)
  if (!center) {
    /** Unknown geometry → legacy origin-on-path. */
    return {
      ...tr,
      x: anchorX + tr.x,
      y: anchorY + tr.y,
      rotation: finalRotation
    }
  }

  const rad = (finalRotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cxs = center.x * tr.scaleX
  const cys = center.y * tr.scaleY
  /** How far the local centre is offset from the local origin AFTER scale+rotate. */
  const dxFromOrigin = cxs * cos - cys * sin
  const dyFromOrigin = cxs * sin + cys * cos

  return {
    ...tr,
    x: anchorX + tr.x - dxFromOrigin,
    y: anchorY + tr.y - dyFromOrigin,
    rotation: finalRotation
  }
}
