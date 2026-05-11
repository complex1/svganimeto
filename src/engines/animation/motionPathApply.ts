import type { AnimationTrack } from '@/types/animation'
import type { Transform, VectorAttrValue, VectorElement } from '@/types/document'
import { sampleTrack } from '@/engines/animation/interpolate'
import { getPointOnPathAt } from '@/engines/geometry/svgPathMotion'
import { flattenForLayers } from '@/engines/document/tree'

/**
 * After mergeTransformFromTracks, apply motion path so the layer rides along
 * another path layer's curve.
 *
 * Anchor semantics (matches "follow this path" intuition in most editors):
 *   output.x = pathOwnerTransform.x + pointOnPath.x + tr.x
 *   output.y = pathOwnerTransform.y + pointOnPath.y + tr.y
 *
 * - At motionPathOffset = 0 the follower sits at the path's start point
 *   (plus any user-authored x/y, which now act as a constant offset).
 * - As the offset advances 0 -> 1 the follower travels along the path itself,
 *   so it visually overlaps the visible curve, not just its shape.
 * - Dragging the follower in the canvas writes into tr.x/tr.y and shifts the
 *   whole motion-path trajectory by that delta, so users can fine-tune the
 *   alignment.
 *
 * Rotation: when "Rotate to path tangent" is on, the follower's rotation is
 * replaced with the local path tangent angle (so it always faces forward).
 */
export function applyMotionPathToTransform(
  tr: Transform,
  ownAttrs: Record<string, VectorAttrValue>,
  roots: VectorElement[],
  tracks: AnimationTrack[],
  elementId: string,
  time: number
): Transform {
  const targetId = typeof ownAttrs.__motionPathId === 'string' ? ownAttrs.__motionPathId : ''
  if (!targetId) return tr

  let offset = 0
  for (const track of tracks) {
    if (
      track.elementId !== elementId ||
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

  // Anchor in document space: the visible path is rendered at
  // `pathEl.transform.translate + pt`, so the follower needs to land there.
  const anchorX = (pathEl.transform?.x ?? 0) + pt.x
  const anchorY = (pathEl.transform?.y ?? 0) + pt.y

  const rotateWithPath =
    ownAttrs.__motionPathRotate === true || ownAttrs.__motionPathRotate === 1

  return {
    ...tr,
    x: anchorX + tr.x,
    y: anchorY + tr.y,
    rotation: rotateWithPath ? pt.angle : tr.rotation
  }
}
