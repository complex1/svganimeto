import type { VectorElement } from '@/types/document'

export function findElement(
  roots: VectorElement[],
  id: string
): { node: VectorElement; parent: VectorElement | null; index: number; siblings: VectorElement[] } | null {
  for (let i = 0; i < roots.length; i++) {
    const hit = findInSubtree(roots[i], null, i, roots, id)
    if (hit) return hit
  }
  return null
}

function findInSubtree(
  node: VectorElement,
  parent: VectorElement | null,
  index: number,
  siblings: VectorElement[],
  id: string
): { node: VectorElement; parent: VectorElement | null; index: number; siblings: VectorElement[] } | null {
  if (node.id === id) return { node, parent, index, siblings }
  if (!node.children) return null
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i]
    const hit = findInSubtree(c, node, i, node.children, id)
    if (hit) return hit
  }
  return null
}

export function mapElements(
  roots: VectorElement[],
  fn: (el: VectorElement) => VectorElement
): VectorElement[] {
  const walk = (el: VectorElement): VectorElement => {
    const next = fn(el)
    return {
      ...next,
      children: next.children?.map(walk)
    }
  }
  return roots.map(walk)
}

export function updateElementById(
  roots: VectorElement[],
  id: string,
  updater: (el: VectorElement) => VectorElement
): VectorElement[] {
  const walk = (el: VectorElement): VectorElement => {
    if (el.id === id) return updater(el)
    if (el.children?.length) {
      return { ...el, children: el.children.map(walk) }
    }
    return el
  }
  return roots.map(walk)
}

export function removeElementById(roots: VectorElement[], id: string): VectorElement[] {
  const filterWalk = (list: VectorElement[]): VectorElement[] => {
    return list
      .filter((el) => el.id !== id)
      .map((el) => {
        if (el.children?.length) {
          return { ...el, children: filterWalk(el.children) }
        }
        return el
      })
  }
  return filterWalk(roots)
}

export function flattenForLayers(
  roots: VectorElement[],
  depth = 0,
  /** When set, group ids in this set are shown collapsed (children omitted from the list). */
  collapsedGroupIds?: ReadonlySet<string> | null,
  /**
   * When true, siblings are emitted in reverse document order (Photoshop/Figma layout —
   * top of the panel = front of the canvas). Parent headers are still emitted before
   * their children so groups visually contain their kids.
   */
  reverseSiblings = false
): { el: VectorElement; depth: number }[] {
  const out: { el: VectorElement; depth: number }[] = []
  const iter = reverseSiblings ? [...roots].slice().reverse() : roots
  for (const el of iter) {
    out.push({ el, depth })
    const collapsed = collapsedGroupIds?.has(el.id)
    if (el.children?.length && !collapsed) {
      out.push(...flattenForLayers(el.children, depth + 1, collapsedGroupIds, reverseSiblings))
    }
  }
  return out
}

/** Insert node at index within parent's children, or root if parentId null. */
export function insertElement(
  roots: VectorElement[],
  parentId: string | null,
  index: number,
  node: VectorElement
): VectorElement[] {
  if (parentId === null) {
    const next = [...roots]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node)
    return next
  }
  return mapElements(roots, (el) => {
    if (el.id !== parentId || !el.children) return el
    const children = [...el.children]
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node)
    return { ...el, children }
  })
}

/** True when `candidateId` lives anywhere under `ancestorId` (not including ancestor itself). */
export function isDescendantOf(
  roots: VectorElement[],
  ancestorId: string,
  candidateId: string
): boolean {
  const loc = findElement(roots, ancestorId)
  if (!loc?.node.children?.length) return false
  const walk = (nodes: VectorElement[]): boolean => {
    for (const n of nodes) {
      if (n.id === candidateId) return true
      if (n.children?.length && walk(n.children)) return true
    }
    return false
  }
  return walk(loc.node.children)
}

/**
 * Move `dragId` relative to `targetId`, optionally into a group (`inside`).
 * Supports cross-parent moves (e.g. out of a group to root, or into an existing group).
 */
export function moveElementRelative(
  roots: VectorElement[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after' | 'inside'
): VectorElement[] {
  if (dragId === targetId) return roots
  if (isDescendantOf(roots, dragId, targetId)) return roots

  const dragLoc = findElement(roots, dragId)
  const targetLoc = findElement(roots, targetId)
  if (!dragLoc || !targetLoc) return roots

  const removed = dragLoc.node
  const next = removeElementById(roots, dragId)

  if (place === 'inside') {
    if (targetLoc.node.type !== 'group') return roots
    return updateElementById(next, targetId, (g) => ({
      ...g,
      children: [...(g.children ?? []), removed]
    }))
  }

  const targetLoc2 = findElement(next, targetId)
  if (!targetLoc2) return roots

  const parentId = targetLoc2.parent?.id ?? null
  const list = [...targetLoc2.siblings]
  const targetIdx = list.findIndex((e) => e.id === targetId)
  if (targetIdx < 0) return roots
  const insertAt = place === 'before' ? targetIdx : targetIdx + 1
  list.splice(insertAt, 0, removed)

  if (parentId === null) return list
  return updateElementById(next, parentId, (p) => ({ ...p, children: list }))
}

/** Move dragId before/after targetId within the same parent (or both root). */
export function reorderSiblings(
  roots: VectorElement[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after'
): VectorElement[] {
  return moveElementRelative(roots, dragId, targetId, place)
}

/** Chain from root to target (inclusive), for accumulating SVG transforms. */
const BUCKET_DRAW_TYPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline'
])

/**
 * Document paint order (first = bottom, last = top) for drawable leaves (no groups / text / images).
 */
export function collectDrawableLeavesPaintOrder(roots: VectorElement[]): VectorElement[] {
  const out: VectorElement[] = []
  const walk = (el: VectorElement) => {
    if (el.type === 'group') {
      for (const c of el.children ?? []) walk(c)
    } else if (BUCKET_DRAW_TYPES.has(el.type) && el.visible !== false) {
      out.push(el)
    }
  }
  for (const r of roots) walk(r)
  return out
}

export function findAncestorChain(roots: VectorElement[], id: string): VectorElement[] | null {
  function walk(nodes: VectorElement[], stack: VectorElement[]): VectorElement[] | null {
    for (const n of nodes) {
      if (n.id === id) return [...stack, n]
      if (n.children?.length) {
        const hit = walk(n.children, [...stack, n])
        if (hit) return hit
      }
    }
    return null
  }
  return walk(roots, [])
}

/** Remove elements matching ids anywhere in the tree (does not remove empty groups). */
export function purgeElementsByIds(roots: VectorElement[], ids: Set<string>): VectorElement[] {
  return roots
    .filter((el) => !ids.has(el.id))
    .map((el) =>
      el.children?.length ? { ...el, children: purgeElementsByIds(el.children, ids) } : el
    )
}

/** Remove all symbol instances that reference a deleted master; returns removed instance ids (for track cleanup). */
export function stripSymbolInstancesByMasterId(
  roots: VectorElement[],
  symbolId: string
): { roots: VectorElement[]; removedIds: string[] } {
  const removedIds: string[] = []
  const walk = (list: VectorElement[]): VectorElement[] => {
    return list
      .filter((el) => {
        if (el.type === 'symbolInstance' && String(el.attrs.__symbolId ?? '') === symbolId) {
          removedIds.push(el.id)
          return false
        }
        return true
      })
      .map((el) =>
        el.children?.length ? { ...el, children: walk(el.children) } : el
      )
  }
  return { roots: walk(roots), removedIds }
}
