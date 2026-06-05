import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAnglesDown,
  faAnglesUp,
  faChevronDown,
  faChevronRight,
  faClone,
  faCopy,
  faEye,
  faEyeSlash,
  faGripVertical,
  faLayerGroup,
  faLock,
  faLockOpen,
  faTrashCan
} from '@fortawesome/free-solid-svg-icons'
import { flattenForLayers } from '@/engines/document/tree'
import type { VectorElement } from '@/types/document'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'

function collectGroupIdsWithChildren(roots: VectorElement[]): string[] {
  const out: string[] = []
  const walk = (el: VectorElement) => {
    if (el.type === 'group' && el.children?.length) {
      out.push(el.id)
      for (const c of el.children) walk(c)
    } else if (el.children?.length) {
      for (const c of el.children) walk(c)
    }
  }
  roots.forEach(walk)
  return out
}

type DropPlace = 'before' | 'after' | 'inside'

function LayerNameField({
  id,
  name,
  disabled,
  onCommit
}: {
  id: string
  name: string
  disabled?: boolean
  onCommit: (id: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(name)
    setEditing(false)
  }, [id, name])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const commit = () => {
    const next = draft.trim() || name
    setDraft(next)
    setEditing(false)
    if (next !== name) onCommit(id, next)
  }

  const cancel = () => {
    setDraft(name)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        style={{ flex: 1, minWidth: 0, fontSize: 12 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            commit()
            return
          }
          if (e.key === 'Escape') cancel()
        }}
        onBlur={commit}
        onChange={(e) => setDraft(e.target.value)}
      />
    )
  }

  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'text'
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        setEditing(true)
      }}
    >
      {name}
    </span>
  )
}

export function LayersPanel() {
  const elements = useEditorStore((s) => s.project.elements)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const select = useEditorStore((s) => s.select)
  const addToSelection = useEditorStore((s) => s.addToSelection)
  const setElementName = useEditorStore((s) => s.setElementName)
  const toggleVisible = useEditorStore((s) => s.toggleVisible)
  const toggleLock = useEditorStore((s) => s.toggleLock)
  const deleteLayerById = useEditorStore((s) => s.deleteLayerById)
  const reorderLayers = useEditorStore((s) => s.reorderLayers)
  const groupSelection = useEditorStore((s) => s.groupSelection)
  const duplicateSelection = useEditorStore((s) => s.duplicateSelection)
  const mode = useEditorStore((s) => s.mode)

  const [collapsedIds, setCollapsedIds] = useState(() => new Set<string>())
  /**
   * Render siblings top-front-first (Photoshop / Figma convention). Drop hints stay
   * authored in visual terms ('before' = above the target in the panel); we flip
   * them to document order at the very edge before calling `reorderLayers`.
   */
  const flat = useMemo(
    () => flattenForLayers(elements, 0, collapsedIds, true),
    [elements, collapsedIds]
  )
  const collapsibleGroupIds = useMemo(() => collectGroupIdsWithChildren(elements), [elements])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; place: DropPlace } | null>(null)

  const onDropItem = (targetId: string) => {
    if (!dragId || dragId === targetId || !dropHint) return
    if (dropHint.place === 'inside') {
      reorderLayers(dragId, targetId, 'inside')
      return
    }
    /** Visual "before" (above in panel) maps to document "after" (higher in z-order). */
    const docPlace = dropHint.place === 'before' ? 'after' : 'before'
    reorderLayers(dragId, targetId, docPlace)
  }

  const resolveDropPlace = (
    el: VectorElement,
    clientY: number,
    rect: DOMRect
  ): DropPlace => {
    const relY = (clientY - rect.top) / rect.height
    if (el.type === 'group') {
      if (relY > 0.28 && relY < 0.72) return 'inside'
      return relY < 0.5 ? 'before' : 'after'
    }
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  return (
    <div className="dock-panel-inner">
      <div className="panel-section-title">Layers</div>
      <div style={{ padding: '0 8px 8px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tooltip content="Group selected sibling layers (⌘⇧G)">
          <button
            type="button"
            disabled={
              selectedIds.length < 2 || mode === 'preview' || mode === 'export'
            }
            onClick={() => groupSelection()}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <FontAwesomeIcon icon={faLayerGroup} />
            Group
          </button>
        </Tooltip>
        <Tooltip content="Duplicate selected layers (⌘D)">
          <button
            type="button"
            disabled={selectedIds.length === 0 || mode === 'preview' || mode === 'export'}
            onClick={() => duplicateSelection()}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <FontAwesomeIcon icon={faClone} />
            Duplicate
          </button>
        </Tooltip>
        <Tooltip content="Expand all groups in the list">
          <button
            type="button"
            disabled={collapsibleGroupIds.length === 0}
            onClick={() => setCollapsedIds(new Set())}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <FontAwesomeIcon icon={faAnglesDown} />
          </button>
        </Tooltip>
        <Tooltip content="Collapse all groups in the list">
          <button
            type="button"
            disabled={collapsibleGroupIds.length === 0}
            onClick={() => setCollapsedIds(new Set(collapsibleGroupIds))}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <FontAwesomeIcon icon={faAnglesUp} />
          </button>
        </Tooltip>
      </div>
      <ul className="layers-tree">
        {flat.map(({ el, depth }) => (
          <Tooltip
            key={el.id}
            content={`${el.type} · id: ${el.id}`}
            anchorClassName="tooltip-anchor--block"
            anchorStyle={{ display: 'block', width: '100%' }}
          >
            <li
            className={clsx(selectedIds.includes(el.id) && 'selected')}
            style={{
              paddingLeft: 12 + depth * 14,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background:
                dropHint?.id === el.id && dropHint.place === 'inside'
                  ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                  : undefined,
              borderTop:
                dropHint?.id === el.id && dropHint.place === 'before'
                  ? '1px solid var(--accent)'
                  : '1px solid transparent',
              borderBottom:
                dropHint?.id === el.id && dropHint.place === 'after'
                  ? '1px solid var(--accent)'
                  : '1px solid transparent'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              const rect = (e.currentTarget as HTMLLIElement).getBoundingClientRect()
              setDropHint({ id: el.id, place: resolveDropPlace(el, e.clientY, rect) })
            }}
            onDrop={(e) => {
              e.preventDefault()
              onDropItem(el.id)
              setDragId(null)
              setDropHint(null)
            }}
            onClick={(e) => {
              if (e.shiftKey) addToSelection(el.id)
              else select([el.id])
            }}
          >
            <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
              {el.type === 'group' && el.children?.length ? (
                <Tooltip content={collapsedIds.has(el.id) ? 'Expand children' : 'Collapse children'}>
                <button
                  type="button"
                  style={{
                    width: 18,
                    height: 18,
                    padding: 0,
                    background: 'transparent',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollapsedIds((prev) => {
                      const n = new Set(prev)
                      if (n.has(el.id)) n.delete(el.id)
                      else n.add(el.id)
                      return n
                    })
                  }}
                >
                  <FontAwesomeIcon icon={collapsedIds.has(el.id) ? faChevronRight : faChevronDown} />
                </button>
                </Tooltip>
              ) : null}
            </span>
            <Tooltip content="Drag to reorder">
            <span
              style={{
                width: 14,
                color: 'var(--text-muted)',
                display: 'inline-flex',
                justifyContent: 'center',
                cursor: 'grab'
              }}
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                setDragId(el.id)
              }}
              onDragEnd={(e) => {
                e.stopPropagation()
                setDragId(null)
                setDropHint(null)
              }}
            >
              <FontAwesomeIcon icon={faGripVertical} />
            </span>
            </Tooltip>
            <Tooltip content="Visibility">
            <button
              type="button"
              style={{
                width: 18,
                height: 18,
                padding: 0,
                background: 'transparent',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={(e) => {
                e.stopPropagation()
                toggleVisible(el.id)
              }}
            >
              <FontAwesomeIcon icon={el.visible === false ? faEyeSlash : faEye} />
            </button>
            </Tooltip>
            <Tooltip content="Lock">
            <button
              type="button"
              style={{
                width: 18,
                height: 18,
                padding: 0,
                background: 'transparent',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={(e) => {
                e.stopPropagation()
                toggleLock(el.id)
              }}
            >
              <FontAwesomeIcon icon={el.locked ? faLock : faLockOpen} />
            </button>
            </Tooltip>
            <LayerNameField
              id={el.id}
              name={el.name}
              disabled={mode === 'preview' || mode === 'export'}
              onCommit={setElementName}
            />
            <Tooltip content={`Copy layer id (${el.id})`}>
            <button
              type="button"
              style={{
                width: 18,
                height: 18,
                padding: 0,
                background: 'transparent',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)'
              }}
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard?.writeText(el.id)
              }}
            >
              <FontAwesomeIcon icon={faCopy} />
            </button>
            </Tooltip>
            <Tooltip content="Delete Layer">
            <button
              type="button"
              style={{
                width: 18,
                height: 18,
                padding: 0,
                background: 'transparent',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--danger)'
              }}
              onClick={(e) => {
                e.stopPropagation()
                deleteLayerById(el.id)
              }}
            >
              <FontAwesomeIcon icon={faTrashCan} />
            </button>
            </Tooltip>
          </li>
          </Tooltip>
        ))}
      </ul>
    </div>
  )
}
