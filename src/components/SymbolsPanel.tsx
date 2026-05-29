import clsx from 'clsx'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCube,
  faPen,
  faPenToSquare,
  faPlus,
  faStamp,
  faTrashCan
} from '@fortawesome/free-solid-svg-icons'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'
import { dialogPrompt } from '@/store/dialogStore'

export function SymbolsPanel() {
  const symbols = useEditorStore((s) => s.project.symbols)
  const symbolEditing = useEditorStore((s) => !!s.symbolEditBackup)
  const createSymbolFromSelection = useEditorStore((s) => s.createSymbolFromSelection)
  const updateSymbolTemplateFromSelection = useEditorStore((s) => s.updateSymbolTemplateFromSelection)
  const deleteSymbol = useEditorStore((s) => s.deleteSymbol)
  const placeSymbolInstance = useEditorStore((s) => s.placeSymbolInstance)
  const beginSymbolEdit = useEditorStore((s) => s.beginSymbolEdit)

  const [activeId, setActiveId] = useState<string | null>(null)

  const onCreate = async () => {
    const name = await dialogPrompt({
      title: 'Create symbol',
      message: 'Optional name for the symbol.',
      defaultValue: '',
      placeholder: 'Symbol name',
      confirmLabel: 'Create',
      cancelLabel: 'Cancel'
    })
    if (name === null) return
    createSymbolFromSelection(name.trim() || undefined)
  }

  return (
    <div className="dock-panel-inner dock-panel-inner--column">
      <div className="panel-section-title">Symbols</div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <Tooltip content={symbolEditing ? 'Finish symbol editing on the banner first' : undefined}>
          <button
            type="button"
            className="toolbar-btn"
            disabled={symbolEditing}
            style={{ width: '100%', justifyContent: 'center', gap: 6 }}
            onClick={onCreate}
          >
            <FontAwesomeIcon icon={faPlus} />
            Create from selection
          </button>
        </Tooltip>
      </div>
      <ul className="layers-tree" style={{ flex: 1 }}>
        {symbolEditing && (
          <li style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
            You are editing a symbol master. Use <strong>Done</strong> or <strong>Cancel</strong> in the bar
            above to return to the main document.
          </li>
        )}
        {symbols.length === 0 && !symbolEditing && (
          <li style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
            Select top-level layers, then create a symbol. Original layers move into the master (removed from
            the canvas); place instances with the clone button.
          </li>
        )}
        {symbols.map((sym) => (
          <li
            key={sym.id}
            className={clsx(activeId === sym.id && 'selected')}
            style={{
              paddingLeft: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer'
            }}
            onClick={() => setActiveId(sym.id)}
          >
            <span style={{ width: 14, color: 'var(--text-muted)', display: 'inline-flex', justifyContent: 'center' }}>
              <FontAwesomeIcon icon={faCube} />
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sym.name}
            </span>
            <Tooltip content={symbolEditing ? 'Finish symbol editing first' : 'Place instance on canvas'}>
            <button
              type="button"
              disabled={symbolEditing}
              style={{
                width: 22,
                height: 22,
                padding: 0,
                background: 'transparent',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={(e) => {
                e.stopPropagation()
                placeSymbolInstance(sym.id)
              }}
            >
              {/*
               * Stamp icon reads as "place / drop this onto the canvas",
               * whereas the previous `faClone` looked like the layer-panel
               * Duplicate button and confused new users.
               */}
              <FontAwesomeIcon icon={faStamp} />
            </button>
            </Tooltip>
            <Tooltip content={symbolEditing ? 'Finish symbol editing first' : 'Edit symbol master on isolated canvas'}>
            <button
              type="button"
              disabled={symbolEditing}
              style={{
                width: 22,
                height: 22,
                padding: 0,
                background: 'transparent',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={(e) => {
                e.stopPropagation()
                beginSymbolEdit(sym.id)
              }}
            >
              <FontAwesomeIcon icon={faPen} />
            </button>
            </Tooltip>
            <Tooltip
              content={symbolEditing ? 'Finish symbol editing first' : 'Replace master from top-level selection'}
            >
            <button
              type="button"
              disabled={symbolEditing}
              style={{
                width: 22,
                height: 22,
                padding: 0,
                background: 'transparent',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={(e) => {
                e.stopPropagation()
                updateSymbolTemplateFromSelection(sym.id)
              }}
            >
              <FontAwesomeIcon icon={faPenToSquare} />
            </button>
            </Tooltip>
            <Tooltip content={symbolEditing ? 'Finish symbol editing first' : 'Delete symbol (removes instances)'}>
            <button
              type="button"
              disabled={symbolEditing}
              style={{
                width: 22,
                height: 22,
                padding: 0,
                background: 'transparent',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--danger)'
              }}
              onClick={(e) => {
                e.stopPropagation()
                deleteSymbol(sym.id)
                if (activeId === sym.id) setActiveId(null)
              }}
            >
              <FontAwesomeIcon icon={faTrashCan} />
            </button>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  )
}
