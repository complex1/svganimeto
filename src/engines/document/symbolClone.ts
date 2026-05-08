import { nanoid } from 'nanoid'
import type { VectorElement } from '@/types/document'

function cloneAttrs(attrs: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(attrs)) as typeof attrs
}

/** Store a fresh template tree (new ids) when creating / updating a symbol. */
export function deepCloneElementNewIds(el: VectorElement): VectorElement {
  return {
    ...el,
    id: nanoid(10),
    name: el.name,
    type: el.type,
    attrs: cloneAttrs(el.attrs as Record<string, unknown>) as VectorElement['attrs'],
    transform: { ...el.transform },
    children: el.children?.map(deepCloneElementNewIds),
    locked: el.locked,
    visible: el.visible !== false
  }
}

/** Clear lock flags on a subtree (e.g. detached symbol instances should be editable). */
export function unlockElementTree(el: VectorElement): VectorElement {
  return {
    ...el,
    locked: false,
    children: el.children?.map(unlockElementTree)
  }
}

/**
 * Instance render clone: stable ids derived from instance + template ids so React keys stay stable.
 */
export function cloneSymbolTemplateForInstance(template: VectorElement, instanceId: string): VectorElement {
  const p = `${instanceId}_sym_`
  function walk(e: VectorElement): VectorElement {
    return {
      ...e,
      id: `${p}${e.id}`,
      name: e.name,
      type: e.type,
      attrs: cloneAttrs(e.attrs as Record<string, unknown>) as VectorElement['attrs'],
      transform: { ...e.transform },
      children: e.children?.map(walk),
      locked: true,
      visible: e.visible !== false
    }
  }
  return walk(template)
}
