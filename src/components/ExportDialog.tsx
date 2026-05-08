import { useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { dialogAlert } from '@/store/dialogStore'
import { exportAnimatedSvg } from '@/engines/export/exportSvg'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project)
  const tracks = useEditorStore((s) => s.tracks)
  const duration = useEditorStore((s) => s.duration)
  const [loop, setLoop] = useState(false)
  const [minify, setMinify] = useState(true)
  const [text, setText] = useState('')

  const generate = () => {
    const svg = exportAnimatedSvg(project, tracks, duration, { loop, minify })
    setText(svg)
  }

  const saveFile = async () => {
    const svg = text || exportAnimatedSvg(project, tracks, duration, { loop, minify })
    const api = window.api
    if (!api?.exportSvg) {
      await navigator.clipboard.writeText(svg)
      await dialogAlert('Copied to clipboard (desktop export unavailable).')
      return
    }
    const path = await api.exportSvg(svg, `${project.name || 'export'}.svg`)
    if (path) await dialogAlert(`Saved to ${path}`)
  }

  const copy = async () => {
    const svg = text || exportAnimatedSvg(project, tracks, duration, { loop, minify })
    await navigator.clipboard.writeText(svg)
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 'min(900px, 92vw)',
          maxHeight: '85vh',
          background: 'var(--bg-panel)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0 }}>Export animated SVG</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} />
            Minify whitespace
          </label>
          <button type="button" className="primary" onClick={generate}>
            Generate
          </button>
          <button type="button" onClick={copy}>
            Copy
          </button>
          <button type="button" onClick={saveFile}>
            Save to file…
          </button>
          <button type="button" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>
        <textarea
          readOnly
          value={text}
          placeholder="Click Generate to build SVG + CSS…"
          style={{
            flex: 1,
            minHeight: 240,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
            resize: 'vertical'
          }}
        />
      </div>
    </div>
  )
}
