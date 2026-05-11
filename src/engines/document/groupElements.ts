import { nanoid } from 'nanoid'
import type { VectorElement } from '@/types/document'
import { defaultTransform } from '@/types/document'
import { findElement } from '@/engines/document/tree'

/** Index in the filtered sibling list where the first selected node was (before removal). */
function filteredInsertIndex(siblings: VectorElement[], firstOriginalIndex: number, removeIds: Set<string>): number {
  let c = 0
  for (let i = 0; i < firstOriginalIndex; i++) {
    if (!removeIds.has(siblings[i]!.id)) c++
  }
  return c
}

function insertGroupUnderParent(
  roots: VectorElement[],
  parentId: string,
  insertAt: number,
  group: VectorElement,
  removeIds: Set<string>
): VectorElement[] {
  const walk = (list: VectorElement[]): VectorElement[] => {
    return list.map((el) => {
      if (el.id === parentId && el.children) {
        const filtered = el.children.filter((c) => !removeIds.has(c.id))
        const nextChildren = [...filtered]
        nextChildren.splice(Math.max(0, Math.min(insertAt, nextChildren.length)), 0, group)
        return { ...el, children: nextChildren }
      }
      if (el.children?.length) {
        return { ...el, children: walk(el.children) }
      }
      return el
    })
  }
  return walk(roots)
}

/**
 * Wraps the selected sibling nodes in a new group at the position of the first selected item.
 * Preserves element ids (and existing tracks) on children.
 */
export function groupSelectedElements(
  roots: VectorElement[],
  selectedIds: string[],
  opts?: { name?: string }
): { roots: VectorElement[]; groupId: string } | null {
  const ids = [...new Set(selectedIds)]
  if (ids.length < 2) return null

  const locs = ids.map((id) => findElement(roots, id))
  if (locs.some((l) => !l)) return null

  const parent = locs[0]!.parent
  if (!locs.every((l) => l!.parent === parent)) return null
  if (locs.some((l) => l!.node.type === 'symbolInstance')) return null
  if (locs.some((l) => l!.node.locked)) return null

  const sorted = [...locs] as NonNullable<(typeof locs)[number]>[]
  sorted.sort((a, b) => a.index - b.index)
  const firstOriginalIndex = sorted[0]!.index
  const removeIds = new Set(ids)
  const children: VectorElement[] = sorted.map((l) => l.node)

  const groupId = nanoid(10)
  const group: VectorElement = {
    id: groupId,
    name: opts?.name ?? 'Group',
    type: 'group',
    attrs: {},
    transform: defaultTransform(),
    visible: true,
    locked: false,
    children
  }

  if (parent === null) {
    const insertAt = filteredInsertIndex(roots, firstOriginalIndex, removeIds)
    const filtered = roots.filter((el) => !removeIds.has(el.id))
    const next = [...filtered]
    next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, group)
    return { roots: next, groupId }
  }

  const siblingList = parent.children ?? []
  const insertAt = filteredInsertIndex(siblingList, firstOriginalIndex, removeIds)
  return {
    roots: insertGroupUnderParent(roots, parent.id, insertAt, group, removeIds),
    groupId
  }
}
