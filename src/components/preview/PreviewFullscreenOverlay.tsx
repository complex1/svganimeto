import { useEffect, useMemo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPause, faPlay, faRepeat, faStop, faXmark } from '@fortawesome/free-solid-svg-icons'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'
import { ElementRenderer } from '@/components/canvas/ElementRenderer'
import {
  disposeGsapTrackTimeline,
  rebuildGsapTrackTimeline,
  syncGsapTrackTimelineTime
} from '@/engines/animation/gsapTrackCompiler'

function formatTime(t: number) {
  return `${t.toFixed(2)}s`
}

/**
 * Full-screen animation preview: artboard + transport (play / stop / speed / loop) and exit.
 */
export function PreviewFullscreenOverlay() {
  const setMode = useEditorStore((s) => s.setMode)
  const project = useEditorStore((s) => s.project)
  const tracks = useEditorStore((s) => s.tracks)
  const symbols = useEditorStore((s) => s.project.symbols)
  const currentTime = useEditorStore((s) => s.currentTime)
  const duration = useEditorStore((s) => s.duration)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const loop = useEditorStore((s) => s.loop)
  const setLoop = useEditorStore((s) => s.setLoop)
  const playbackSpeed = useEditorStore((s) => s.playbackSpeed)
  const setPlaybackSpeed = useEditorStore((s) => s.setPlaybackSpeed)
  const gsapCanvasDriver = useEditorStore((s) => s.gsapCanvasDriver)

  useMemo(() => {
    if (!gsapCanvasDriver) {
      disposeGsapTrackTimeline()
      return
    }
    rebuildGsapTrackTimeline(project.elements, tracks, duration)
  }, [gsapCanvasDriver, project.elements, tracks, duration])

  useEffect(() => {
    return () => disposeGsapTrackTimeline()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMode('animate')
      }
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying(!useEditorStore.getState().isPlaying)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode, setIsPlaying])

  const noopPointer = () => {}

  if (gsapCanvasDriver) syncGsapTrackTimelineTime(currentTime)

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Animation preview"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-app, #1a1d23)',
        fontFamily: 'var(--font-ui, system-ui, sans-serif)'
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border, #3d4450)',
          background: 'var(--bg-panel, #22262e)'
        }}
      >
        <Tooltip content="Back to editor (Esc)">
        <button
          type="button"
          onClick={() => setMode('animate')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            background: 'var(--bg-elevated, #2a2f38)',
            borderRadius: 'var(--radius, 6px)',
            border: '1px solid var(--border, #3d4450)',
            color: 'var(--text, #e8eaed)'
          }}
        >
          <FontAwesomeIcon icon={faXmark} />
          Exit preview
        </button>
        </Tooltip>
        <span style={{ fontSize: 12, color: 'var(--text-muted, #9aa0a6)' }}>
          {project.name} · {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${project.width} ${project.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ maxWidth: '100%', maxHeight: '100%', touchAction: 'none' }}
        >
          <rect x={0} y={0} width={project.width} height={project.height} fill="#f4f5f7" stroke="#d0d4dc" />
          <defs>
            {project.gradients.map((g) =>
              g.kind === 'linear' ? (
                <linearGradient
                  key={g.id}
                  id={g.id}
                  x1={g.x1}
                  y1={g.y1}
                  x2={g.x2}
                  y2={g.y2}
                  gradientUnits={g.gradientUnits}
                >
                  {g.stops.map((s, i) => (
                    <stop
                      key={`${g.id}-${i}`}
                      offset={`${Math.round(Math.max(0, Math.min(1, s.offset)) * 100)}%`}
                      stopColor={s.color}
                      stopOpacity={s.opacity ?? 1}
                    />
                  ))}
                </linearGradient>
              ) : (
                <radialGradient
                  key={g.id}
                  id={g.id}
                  cx={g.cx}
                  cy={g.cy}
                  r={g.r}
                  fx={g.fx}
                  fy={g.fy}
                  gradientUnits={g.gradientUnits}
                >
                  {g.stops.map((s, i) => (
                    <stop
                      key={`${g.id}-${i}`}
                      offset={`${Math.round(Math.max(0, Math.min(1, s.offset)) * 100)}%`}
                      stopColor={s.color}
                      stopOpacity={s.opacity ?? 1}
                    />
                  ))}
                </radialGradient>
              )
            )}
          </defs>
          <ElementRenderer
            elements={project.elements}
            symbols={symbols}
            tracks={tracks}
            currentTime={currentTime}
            gsapCanvasDriver={gsapCanvasDriver}
            onElementPointerDown={noopPointer}
          />
        </svg>
      </div>

      <footer
        style={{
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderTop: '1px solid var(--border, #3d4450)',
          background: 'var(--bg-panel, #22262e)'
        }}
      >
        <button type="button" className="primary" onClick={() => setIsPlaying(!isPlaying)}>
          <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} style={{ marginRight: 6 }} />
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsPlaying(false)
            setCurrentTime(0)
          }}
        >
          <FontAwesomeIcon icon={faStop} style={{ marginRight: 6 }} />
          Stop
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <FontAwesomeIcon icon={faRepeat} />
          Loop
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Speed
          <select
            value={String(playbackSpeed)}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-app)', border: '1px solid var(--border)' }}
          >
            {[0.25, 0.5, 1, 2, 4, 8].map((sp) => (
              <option key={sp} value={sp}>
                {sp}x
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Space: play/pause · Esc: exit</span>
      </footer>
    </div>
  )
}
