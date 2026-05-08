import { useEffect, useState } from 'react'
import { TopBar } from '@/components/TopBar'
import { LeftToolbar } from '@/components/LeftToolbar'
import { Canvas } from '@/components/canvas/Canvas'
import { RightInspector } from '@/components/RightInspector'
import { LayersPanel } from '@/components/LayersPanel'
import { TimelinePanel } from '@/components/Timeline/TimelinePanel'
import { ExportDialog } from '@/components/ExportDialog'
import { useEditorStore } from '@/store/editorStore'
import { usePlaybackLoop } from '@/hooks/usePlaybackLoop'
import { applyImportedSvg, importSvgFile, openProjectFile, saveProjectFile } from '@/ipc/fileActions'

export default function App() {
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const newProject = useEditorStore((s) => s.newProject)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const [exportOpen, setExportOpen] = useState(false)

  usePlaybackLoop()

  useEffect(() => {
    if (mode === 'export') setExportOpen(true)
    else setExportOpen(false)
  }, [mode])

  useEffect(() => {
    const api = window.api
    if (!api?.onMenuAction) return
    return api.onMenuAction((action) => {
      if (action === 'file:new') newProject()
      if (action === 'file:open') void openProjectFile()
      if (action === 'file:save') void saveProjectFile()
    })
  }, [newProject])

  useEffect(() => {
    const api = window.api
    if (!api?.onImportSvgData) return
    return api.onImportSvgData((data) => {
      applyImportedSvg(data.content, data.path.split(/[/\\]/).pop() ?? 'Imported')
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveProjectFile()
      }
      if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void openProjectFile()
      }
      // In Electron, Import is handled in main via before-input-event (Cmd+I often does not bubble here).
      if (!window.api?.importSvg && meta && (e.code === 'KeyI' || e.key.toLowerCase() === 'i')) {
        e.preventDefault()
        void importSvgFile()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        e.preventDefault()
        deleteSelected()
      }
      if (mode === 'draw') {
        const key = e.key.toLowerCase()
        if (key === 'v') setActiveTool('select')
        if (key === 'r') setActiveTool('rect')
        if (key === 'o') setActiveTool('circle')
        if (key === 'e') setActiveTool('ellipse')
        if (key === 'l') setActiveTool('line')
        if (key === 'p') setActiveTool('pen')
        if (key === 'n') setActiveTool('path-edit')
        if (key === 'b') setActiveTool('brush')
        if (key === 't') setActiveTool('text')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, deleteSelected, mode, setActiveTool])

  return (
    <div className="app-root">
      <TopBar />
      <div className="app-layout">
        <LeftToolbar />
        <main className="area-center">
          <Canvas />
        </main>
        <RightInspector />
        <div
          className="area-bottom"
          style={{ display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0 }}
        >
          <LayersPanel expanded={mode === 'draw'} />
          {(mode === 'animate' || mode === 'preview') && (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <TimelinePanel />
            </div>
          )}
          {mode === 'export' && (
            <div style={{ flex: 1, padding: 12, color: 'var(--text-muted)' }}>Use the export dialog.</div>
          )}
        </div>
      </div>
      {exportOpen && (
        <ExportDialog
          onClose={() => {
            setExportOpen(false)
            setMode('animate')
          }}
        />
      )}
    </div>
  )
}
