import clsx from 'clsx'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faEye,
  faEyeSlash,
  faGripVertical,
  faLock,
  faLockOpen,
  faTrashCan
} from '@fortawesome/free-solid-svg-icons'
import { flattenForLayers } from '@/engines/document/tree'
import { useEditorStore } from '@/store/editorStore'

export function LayersPanel({ expanded }: { expanded?: boolean }) {
  const elements = useEditorStore((s) => s.project.elements)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const select = useEditorStore((s) => s.select)
  const addToSelection = useEditorStore((s) => s.addToSelection)
  const setElementName = useEditorStore((s) => s.setElementName)
  const toggleVisible = useEditorStore((s) => s.toggleVisible)
  const toggleLock = useEditorStore((s) => s.toggleLock)
  const deleteLayerById = useEditorStore((s) => s.deleteLayerById)
  const reorderLayers = useEditorStore((s) => s.reorderLayers)

  const flat = flattenForLayers(elements)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; place: 'before' | 'after' } | null>(null)

  const onDropItem = (targetId: string) => {
    if (!dragId || dragId === targetId || !dropHint) return
    reorderLayers(dragId, targetId, dropHint.place)
  }

  return (
    <div
      style={{
        width: expanded ? undefined : 220,
        flex: expanded ? 1 : undefined,
        minWidth: 200,
        borderRight: '1px solid var(--border)',
        overflow: 'auto'
      }}
    >
      <div className="panel-section-title">Layers</div>
      <ul className="layers-tree">
        {flat.map(({ el, depth }) => (
          <li
            key={el.id}
            className={clsx(selectedIds.includes(el.id) && 'selected')}
            style={{
              paddingLeft: 12 + depth * 14,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
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
              const midpoint = rect.top + rect.height / 2
              setDropHint({ id: el.id, place: e.clientY < midpoint ? 'before' : 'after' })
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
            <span
              title="Drag to reorder"
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
            <button
              type="button"
              title="Visibility"
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
            <button
              type="button"
              title="Lock"
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
            <input
              type="text"
              value={el.name}
              style={{ flex: 1, minWidth: 0, fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setElementName(el.id, e.target.value)}
            />
            <button
              type="button"
              title="Delete Layer"
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
          </li>
        ))}
      </ul>
    </div>
  )
}
