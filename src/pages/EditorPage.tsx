import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '@/components/TopBar'
import { LeftToolbar } from '@/components/LeftToolbar'
import { Canvas } from '@/components/canvas/Canvas'
import { RightInspector } from '@/components/RightInspector'
import { LayersPanel } from '@/components/LayersPanel'
import { SymbolsPanel } from '@/components/SymbolsPanel'
import { TimelinePanel } from '@/components/Timeline/TimelinePanel'
import { ExportDialog } from '@/components/ExportDialog'
import { DialogHost } from '@/components/DialogHost'
import { TraceOverlay } from '@/components/TraceOverlay'
import { SymbolEditBanner } from '@/components/SymbolEditBanner'
import { useEditorStore } from '@/store/editorStore'
import { usePlaybackLoop } from '@/hooks/usePlaybackLoop'
import { GsapTimelineDevPanel } from '@/components/dev/GsapTimelineDevPanel'
import { RasterImportModal } from '@/components/RasterImportModal'
import { PreviewFullscreenOverlay } from '@/components/preview/PreviewFullscreenOverlay'
import { ResizeHandle } from '@/components/ResizeHandle'
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout'
import {
  applyImportedSvg,
  importSvgFile,
  newProjectFile,
  openProjectFile,
  openRasterVectorizeWizard,
  saveProjectFile
} from '@/ipc/fileActions'
import { loadProjectForEditor } from '@/ipc/projectActions'
import { routesHome } from '@/navigation'

export function EditorPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [loadState, setLoadState] = useState<'loading' | 'ready'>('loading')
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const [exportOpen, setExportOpen] = useState(false)
  const { layout, resizeInspector, resizeBottom, resizeLayers } = useWorkspaceLayout()

  usePlaybackLoop()

  useEffect(() => {
    if (!projectId) {
      navigate(routesHome, { replace: true })
      return
    }

    let cancelled = false
    void (async () => {
      setLoadState('loading')
      const loaded = await loadProjectForEditor(projectId)
      if (cancelled) return
      if (!loaded) {
        navigate(routesHome, { replace: true })
        return
      }
      setLoadState('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, navigate])

  useEffect(() => {
    if (mode === 'export') setExportOpen(true)
    else setExportOpen(false)
  }, [mode])

  useEffect(() => {
    const api = window.api
    if (!api?.onMenuAction) return
    return api.onMenuAction((action) => {
      if (action === 'file:new') void newProjectFile()
      if (action === 'file:open') void openProjectFile()
      if (action === 'file:save') void saveProjectFile()
    })
  }, [])

  useEffect(() => {
    const api = window.api
    if (!api?.onImportSvgData) return
    return api.onImportSvgData((data) => {
      applyImportedSvg(data.content, data.path.split(/[/\\]/).pop() ?? 'Imported')
    })
  }, [])

  useEffect(() => {
    const api = window.api
    if (!api?.onImportRasterData) return
    return api.onImportRasterData((data) => {
      openRasterVectorizeWizard(data.dataUrl, data.path.split(/[/\\]/).pop() ?? 'Image')
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
      if (!window.api?.importSvg && meta && (e.code === 'KeyI' || e.key.toLowerCase() === 'i')) {
        e.preventDefault()
        void importSvgFile()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (mode === 'preview') return
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        e.preventDefault()
        deleteSelected()
      }
      if (
        meta &&
        e.shiftKey &&
        e.key.toLowerCase() === 'g' &&
        (mode === 'draw' || mode === 'animate')
      ) {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        e.preventDefault()
        useEditorStore.getState().groupSelection()
        return
      }
      if (
        meta &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'd' &&
        (mode === 'draw' || mode === 'animate')
      ) {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        e.preventDefault()
        useEditorStore.getState().duplicateSelection()
        return
      }
      if (mode === 'draw') {
        const key = e.key.toLowerCase()
        if (key === 'v') setActiveTool('select')
        if (key === 'h') setActiveTool('hand')
        if (key === 'g') setActiveTool('shape-builder')
        if (key === 'r') setActiveTool('rect')
        if (key === 'o') setActiveTool('circle')
        if (key === 'e') setActiveTool('ellipse')
        if (key === 'l') setActiveTool('line')
        if (key === 'p') setActiveTool('pen')
        if (key === 'i') setActiveTool('pencil')
        if (key === 'n') setActiveTool('path-edit')
        if (key === 'b') setActiveTool('brush')
        if (key === 'x') setActiveTool('eraser')
        if (key === 'f') setActiveTool('fill')
        if (key === 't') setActiveTool('text')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, deleteSelected, mode, setActiveTool])

  if (loadState !== 'ready') {
    return (
      <div className="app-root app-root--loading">
        <DialogHost />
        <p className="editor-loading">Loading project…</p>
      </div>
    )
  }

  return (
    <div className="app-root">
      <GsapTimelineDevPanel />
      <DialogHost />
      <TraceOverlay />
      <RasterImportModal />
      {mode === 'preview' ? (
        <PreviewFullscreenOverlay />
      ) : (
        <>
          <TopBar />
          <SymbolEditBanner />
          <div
            className="app-layout"
            style={{
              gridTemplateColumns: `48px 1fr ${layout.inspectorWidth}px`,
              gridTemplateRows: `1fr ${layout.bottomHeight}px`
            }}
          >
            <LeftToolbar />
            <main className="area-center">
              <div className="area-center-stage">
                <Canvas />
              </div>
              <ResizeHandle
                axis="vertical"
                ariaLabel="Resize layers and timeline"
                className="resize-handle-bottom"
                onResize={resizeBottom}
              />
            </main>
            <div className="area-inspector-shell">
              <ResizeHandle
                axis="horizontal"
                ariaLabel="Resize inspector"
                className="resize-handle-inspector"
                onResize={resizeInspector}
              />
              <RightInspector />
            </div>
            <div className="area-bottom">
              <div className="area-bottom-content">
                <div className="dock-panel dock-panel-layers" style={{ width: layout.layersWidth }}>
                  <LayersPanel />
                </div>
                <ResizeHandle
                  axis="horizontal"
                  ariaLabel="Resize layers panel"
                  className="resize-handle-layers"
                  onResize={resizeLayers}
                />
                {mode === 'draw' && (
                  <div className="dock-panel dock-panel-fill">
                    <SymbolsPanel />
                  </div>
                )}
                {mode === 'animate' && (
                  <div className="dock-panel dock-panel-fill">
                    <TimelinePanel />
                  </div>
                )}
                {mode === 'export' && (
                  <div className="dock-panel dock-panel-fill dock-panel-message">
                    Use the export dialog.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
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
