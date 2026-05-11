import { nanoid } from 'nanoid'
import type { VectorAttrValue, VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { findAncestorChain, findElement, flattenForLayers, insertElement } from '@/engines/document/tree'

function cloneAttrs(attrs: Record<string, VectorAttrValue>) {
  return JSON.parse(JSON.stringify(attrs)) as Record<string, VectorAttrValue>
}

/** Subtree clone with fresh element ids (names get a " copy" suffix on the root only). */
export function cloneSubtreeNewIds(root: VectorElement): { node: VectorElement; oldToNew: Map<string, string> } {
  const oldToNew = new Map<string, string>()
  function walk(el: VectorElement, isRoot: boolean): VectorElement {
    const newId = nanoid(10)
    oldToNew.set(el.id, newId)
    const name = isRoot ? `${el.name} copy` : el.name
    return {
      ...el,
      id: newId,
      name,
      attrs: cloneAttrs(el.attrs),
      transform: { ...el.transform },
      children: el.children?.map((c) => walk(c, false)),
      locked: el.locked,
      visible: el.visible !== false
    }
  }
  return { node: walk(root, true), oldToNew }
}

/** Remap `__motionPathId` when it pointed to another node in the same duplicated subtree. */
export function remapMotionPathIdsForClone(root: VectorElement, oldToNew: Map<string, string>): VectorElement {
  const walk = (el: VectorElement): VectorElement => {
    const nextAttrs = { ...el.attrs }
    const mp = nextAttrs.__motionPathId
    if (typeof mp === 'string' && oldToNew.has(mp)) {
      nextAttrs.__motionPathId = oldToNew.get(mp)! as VectorAttrValue
    }
    return {
      ...el,
      attrs: nextAttrs,
      children: el.children?.map(walk)
    }
  }
  return walk(root)
}

/** Selected ids that are not under another selected ancestor (depth-first order). */
export function selectionDuplicateRoots(roots: VectorElement[], selectedIds: string[]): string[] {
  const set = new Set(selectedIds)
  const ordered = flattenForLayers(roots)
    .map(({ el }) => el.id)
    .filter((id) => set.has(id))
  return ordered.filter((id) => {
    const chain = findAncestorChain(roots, id)
    if (!chain) return false
    for (let i = 0; i < chain.length - 1; i++) {
      if (set.has(chain[i]!.id)) return false
    }
    return true
  })
}

function cloneTracksForIdMap(tracks: AnimationTrack[], oldToNew: Map<string, string>): AnimationTrack[] {
  const out: AnimationTrack[] = []
  for (const tr of tracks) {
    const newEl = oldToNew.get(tr.elementId)
    if (!newEl) continue
    out.push({
      ...tr,
      id: nanoid(8),
      elementId: newEl,
      keyframes: tr.keyframes.map((k) => ({ ...k, id: nanoid(8) }))
    })
  }
  return out
}

export type DuplicateSelectionResult = {
  roots: VectorElement[]
  tracks: AnimationTrack[]
  newSelectedIds: string[]
}

/**
 * Duplicates each selected root subtree immediately after its original sibling index.
 * Clones animation tracks for duplicated element ids; remaps internal motion-path refs.
 */
export function duplicateSelectedInDocument(
  roots: VectorElement[],
  selectedIds: string[],
  tracks: AnimationTrack[]
): DuplicateSelectionResult | null {
  const rootIds = selectionDuplicateRoots(roots, selectedIds)
  if (rootIds.length === 0) return null

  type Op = { parentId: string | null; at: number; node: VectorElement }
  const ops: Op[] = []
  const mergedOldToNew = new Map<string, string>()
  const newSelectedIds: string[] = []

  for (const id of rootIds) {
    const loc = findElement(roots, id)
    if (!loc) continue
    let { node, oldToNew } = cloneSubtreeNewIds(loc.node)
    node = remapMotionPathIdsForClone(node, oldToNew)
    for (const [k, v] of oldToNew) mergedOldToNew.set(k, v)
    const parentId = loc.parent?.id ?? null
    const at = loc.index + 1
    ops.push({ parentId, at, node })
    newSelectedIds.push(node.id)
  }

  ops.sort((a, b) => {
    const pa = a.parentId ?? '\0'
    const pb = b.parentId ?? '\0'
    if (pa !== pb) return pa.localeCompare(pb)
    return b.at - a.at
  })

  let nextRoots = roots
  for (const op of ops) {
    nextRoots = insertElement(nextRoots, op.parentId, op.at, op.node)
  }

  const newTracks = cloneTracksForIdMap(tracks, mergedOldToNew)
  return {
    roots: nextRoots,
    tracks: [...tracks, ...newTracks],
    newSelectedIds
  }
}
