import clsx from 'clsx'
import type { ChangeEvent } from 'react'
import { useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileArrowUp } from '@fortawesome/free-solid-svg-icons'
import { useEditorStore } from '@/store/editorStore'
import { applyImportedSvg, importSvgFile } from '@/ipc/fileActions'

const modes = [
  { id: 'draw' as const, label: 'Draw' },
  { id: 'animate' as const, label: 'Animate' },
  { id: 'preview' as const, label: 'Preview' },
  { id: 'export' as const, label: 'Export' }
]

export function TopBar() {
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const projectName = useEditorStore((s) => s.project.name)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasElectronImport = typeof window.api?.importSvg === 'function'

  async function onPickSvgFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    applyImportedSvg(text, file.name)
  }

  return (
    <header className="top-bar">
      <strong style={{ marginRight: 12 }}>{projectName}</strong>
      <div className="mode-toggle">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            className={clsx(mode === m.id && 'active')}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          style={{ display: 'none' }}
          onChange={onPickSvgFile}
        />
        <button
          type="button"
          title={
            hasElectronImport
              ? 'Import SVG (native dialog)'
              : 'Import SVG from disk (browser)'
          }
          onClick={() => {
            if (hasElectronImport) void importSvgFile()
            else fileInputRef.current?.click()
          }}
        >
          <FontAwesomeIcon icon={faFileArrowUp} style={{ marginRight: 6 }} />
          Import SVG…
        </button>
      </div>
    </header>
  )
}
