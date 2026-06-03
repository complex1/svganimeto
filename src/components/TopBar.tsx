import clsx from 'clsx'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCrosshairs,
  faFileArrowUp,
  faFloppyDisk,
  faHouse,
  faImage
} from '@fortawesome/free-solid-svg-icons'
import { SvgAnimetoLogo } from '@/components/brand/SvgAnimetoLogo'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'
import {
  applyImportedSvg,
  importRasterTraceFile,
  importSvgFile,
  openRasterVectorizeWizard,
  saveProjectFile
} from '@/ipc/fileActions'
import { returnToHome } from '@/ipc/projectActions'

const modes = [
  { id: 'draw' as const, label: 'Draw' },
  { id: 'animate' as const, label: 'Animate' },
  { id: 'preview' as const, label: 'Preview' },
  { id: 'export' as const, label: 'Export' }
]

const CANVAS_SIZE_PRESETS = [
  { width: 800, height: 600, label: '800 × 600' },
  { width: 1280, height: 720, label: '1280 × 720 (HD)' },
  { width: 1920, height: 1080, label: '1920 × 1080 (FHD)' },
  { width: 3840, height: 2160, label: '3840 × 2160 (4K)' },
  { width: 1080, height: 1080, label: '1080 × 1080 (square)' },
  { width: 1080, height: 1920, label: '1080 × 1920 (portrait)' },
  { width: 512, height: 512, label: '512 × 512' }
] as const

export function TopBar() {
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const projectName = useEditorStore((s) => s.project.name)
  const setProjectMeta = useEditorStore((s) => s.setProjectMeta)
  const projectWidth = useEditorStore((s) => s.project.width)
  const projectHeight = useEditorStore((s) => s.project.height)
  const setCanvasSize = useEditorStore((s) => s.setCanvasSize)
  const symbolEditing = useEditorStore((s) => !!s.symbolEditBackup)
  const showPivots = useEditorStore((s) => s.showPivots)
  const toggleShowPivots = useEditorStore((s) => s.toggleShowPivots)
  const showPivotToggle = mode === 'draw' || mode === 'animate'
  const canvasSizeLocked = symbolEditing || mode === 'preview' || mode === 'export'
  const canvasSizeSelectValue = useMemo(() => {
    const match = CANVAS_SIZE_PRESETS.find(
      (preset) => preset.width === projectWidth && preset.height === projectHeight
    )
    return match ? `${match.width}x${match.height}` : 'custom'
  }, [projectWidth, projectHeight])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rasterInputRef = useRef<HTMLInputElement>(null)
  const projectNameInputRef = useRef<HTMLInputElement>(null)
  const [editingProjectName, setEditingProjectName] = useState(false)
  const [draftProjectName, setDraftProjectName] = useState(projectName)

  useEffect(() => {
    setDraftProjectName(projectName)
    setEditingProjectName(false)
  }, [projectName])

  useEffect(() => {
    if (!editingProjectName) return
    projectNameInputRef.current?.focus()
    projectNameInputRef.current?.select()
  }, [editingProjectName])

  function beginProjectNameEdit() {
    setDraftProjectName(projectName)
    setEditingProjectName(true)
  }

  function commitProjectName() {
    const next = draftProjectName.trim() || 'Untitled'
    setDraftProjectName(next)
    setEditingProjectName(false)
    if (next !== projectName) {
      setProjectMeta({ name: next })
    }
  }

  function cancelProjectNameEdit() {
    setDraftProjectName(projectName)
    setEditingProjectName(false)
  }

  function onProjectNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commitProjectName()
      return
    }
    if (e.key === 'Escape') {
      cancelProjectNameEdit()
    }
  }

  const hasElectronImport = typeof window.api?.importSvg === 'function'
  const hasElectronRasterImport = typeof window.api?.importRaster === 'function'

  async function onPickSvgFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    applyImportedSvg(text, file.name)
  }

  async function onPickRasterFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    openRasterVectorizeWizard(file, file.name)
  }

  return (
    <header className="top-bar">
      <Tooltip content="Back to projects">
        <button type="button" className="top-bar-home" onClick={() => returnToHome()}>
          <FontAwesomeIcon icon={faHouse} />
        </button>
      </Tooltip>
      <SvgAnimetoLogo size={22} className="top-bar-logo" />
      {editingProjectName ? (
        <input
          ref={projectNameInputRef}
          type="text"
          className="top-bar-project-name"
          value={draftProjectName}
          aria-label="Project name"
          spellCheck={false}
          onChange={(e) => setDraftProjectName(e.target.value)}
          onBlur={commitProjectName}
          onKeyDown={(e) => {
            /**
             * Stop the keystroke from bubbling out to the editor's global
             * shortcuts. Without this, typing letters like "z" or "v"
             * (especially while holding Cmd/Ctrl) could trigger undo, tool
             * switches, or playback toggles instead of just editing the name.
             */
            e.stopPropagation()
            onProjectNameKeyDown(e)
          }}
        />
      ) : (
        <Tooltip content="Double-click to rename project">
          <span
            className="top-bar-project-name top-bar-project-name--display"
            role="button"
            tabIndex={0}
            aria-label={`Project name: ${projectName}`}
            onDoubleClick={beginProjectNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') beginProjectNameEdit()
            }}
          >
            {projectName}
          </span>
        </Tooltip>
      )}
      <div className="mode-toggle">
        {modes.map((m) => {
          /**
           * While editing a symbol the user may want to switch between Draw and
           * Animate to author the symbol's own timeline. Only Export is blocked —
           * exporting from inside a symbol-edit scope would render the symbol's
           * template instead of the main document.
           */
          const blocked = symbolEditing && m.id === 'export'
          const tooltip = blocked ? 'Finish symbol editing first' : undefined
          return (
            <Tooltip key={m.id} content={tooltip}>
              <button
                type="button"
                disabled={blocked}
                className={clsx(mode === m.id && 'active')}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            </Tooltip>
          )
        })}
      </div>
      <Tooltip
        content={
          canvasSizeLocked
            ? symbolEditing
              ? 'Finish symbol editing first'
              : 'Switch to Draw or Animate to change canvas size'
            : 'Artboard dimensions'
        }
        anchorClassName="top-bar-canvas-size"
        anchorStyle={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 12 }}
      >
        <label className="top-bar-canvas-size" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Canvas
          <select
          value={canvasSizeSelectValue}
          disabled={canvasSizeLocked}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'custom') return
            const [w, h] = value.split('x').map((n) => Number(n))
            if (Number.isFinite(w) && Number.isFinite(h)) setCanvasSize(w, h)
          }}
        >
          {CANVAS_SIZE_PRESETS.map((preset) => (
            <option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
              {preset.label}
            </option>
          ))}
          {canvasSizeSelectValue === 'custom' && (
            <option value="custom">
              {projectWidth} × {projectHeight} (current)
            </option>
          )}
          </select>
        </label>
      </Tooltip>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {showPivotToggle && (
          <Tooltip content={showPivots ? 'Hide pivot points' : 'Show pivot points'}>
            <button
              type="button"
              className={clsx(showPivots && 'active')}
              aria-pressed={showPivots}
              onClick={() => toggleShowPivots()}
            >
              <FontAwesomeIcon icon={faCrosshairs} style={{ marginRight: 6 }} />
              Pivot
            </button>
          </Tooltip>
        )}
        <Tooltip
          content={
            symbolEditing ? 'Finish symbol editing first' : 'Save project (⌘S / Ctrl+S)'
          }
        >
          <button
            type="button"
            disabled={symbolEditing}
            onClick={() => {
              if (symbolEditing) return
              void saveProjectFile()
            }}
          >
            <FontAwesomeIcon icon={faFloppyDisk} style={{ marginRight: 6 }} />
            Save
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          style={{ display: 'none' }}
          onChange={onPickSvgFile}
        />
        <input
          ref={rasterInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={onPickRasterFile}
        />
        <Tooltip
          content={
            symbolEditing
              ? 'Finish symbol editing first'
              : hasElectronImport
                ? 'Import SVG (native dialog)'
                : 'Import SVG from disk (browser)'
          }
        >
          <button
            type="button"
            disabled={symbolEditing}
            onClick={() => {
              if (symbolEditing) return
              if (hasElectronImport) void importSvgFile()
              else fileInputRef.current?.click()
            }}
          >
            <FontAwesomeIcon icon={faFileArrowUp} style={{ marginRight: 6 }} />
            Import SVG…
          </button>
        </Tooltip>
        <Tooltip
          content={
            symbolEditing
              ? 'Finish symbol editing first'
              : hasElectronRasterImport
                ? 'PNG / JPG / WebP → vector paths (native dialog)'
                : 'PNG / JPG / WebP → vector paths (browser)'
          }
        >
          <button
            type="button"
            disabled={symbolEditing}
            onClick={() => {
              if (symbolEditing) return
              if (hasElectronRasterImport) void importRasterTraceFile()
              else rasterInputRef.current?.click()
            }}
          >
            <FontAwesomeIcon icon={faImage} style={{ marginRight: 6 }} />
            Trace raster…
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
