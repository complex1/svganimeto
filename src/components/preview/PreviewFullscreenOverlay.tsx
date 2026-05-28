import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPause, faPlay, faRepeat, faRotateRight, faStop, faXmark } from '@fortawesome/free-solid-svg-icons'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'
import { pickFrameIndex, usePreRenderedFrames } from '@/components/preview/usePreRenderedFrames'

function formatTime(t: number) {
  return `${t.toFixed(2)}s`
}

/**
 * Full-screen animation preview.
 *
 * Previously this re-mounted a live `<svg>` scene each frame using
 * `ElementRenderer`, which paid the full sample/diff cost every tick — fine
 * for simple scenes, jittery for ones with texture brushes / noise / many
 * keyframes. We now pre-render every frame to an `ImageBitmap` ahead of
 * playback, then `drawImage` the right bitmap on each tick. The transport
 * (play/pause/loop/speed) still drives `currentTime` through the existing
 * `usePlaybackLoop`, so frames stay in lockstep with the rest of the editor.
 */
export function PreviewFullscreenOverlay() {
  const setMode = useEditorStore((s) => s.setMode)
  const project = useEditorStore((s) => s.project)
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const duration = useEditorStore((s) => s.duration)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const loop = useEditorStore((s) => s.loop)
  const setLoop = useEditorStore((s) => s.setLoop)
  const playbackSpeed = useEditorStore((s) => s.playbackSpeed)
  const setPlaybackSpeed = useEditorStore((s) => s.setPlaybackSpeed)
  const projectFps = useEditorStore((s) => s.fps)

  /** Manual re-bake counter — bumps `enabled`'s identity so the hook restarts. */
  const [reBakeNonce, setReBakeNonce] = useState(0)
  const bake = usePreRenderedFrames({
    project,
    tracks,
    durationSec: duration,
    fps: projectFps,
    enabled: true
  })

  /** Pause and rewind whenever we enter (or re-enter) a bake — playback against
   * an in-flight cache is jumpy and would surprise the user. */
  useEffect(() => {
    if (bake.status === 'rendering') {
      setIsPlaying(false)
      setCurrentTime(0)
    }
  }, [bake.status, reBakeNonce, setIsPlaying, setCurrentTime])

  /**
   * Auto-start playback once the bake completes. Feels more like "press play
   * → here's the video" than dropping the user into a paused state.
   */
  useEffect(() => {
    if (bake.status === 'ready') {
      setIsPlaying(true)
    }
  }, [bake.status, setIsPlaying])

  /** Display canvas — same DPR-aware sizing as the project canvas. */
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (bake.status !== 'ready') return
    const cv = canvasRef.current
    if (!cv) return
    cv.width = bake.width
    cv.height = bake.height
  }, [bake])

  /**
   * Paint the matching cached frame each time the playhead moves. We pull from
   * the existing `usePlaybackLoop` clock (no extra RAF here) so play/pause/
   * speed/loop wiring continues to behave the same as the editor's timeline.
   */
  useEffect(() => {
    if (bake.status !== 'ready') return
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const idx = pickFrameIndex(currentTime, bake.fps, bake.frames.length)
    const frame = bake.frames[idx]
    if (!frame) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(frame, 0, 0, cv.width, cv.height)
  }, [bake, currentTime])

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
        /** Block play if the bake isn't ready — there's nothing to show yet. */
        if (useEditorStore.getState().mode !== 'preview') return
        setIsPlaying(!useEditorStore.getState().isPlaying)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode, setIsPlaying])

  /** Cleanup: when leaving preview, stop playback so the next entry starts fresh. */
  useEffect(() => {
    return () => {
      setIsPlaying(false)
    }
  }, [setIsPlaying])

  const baking = bake.status === 'rendering'
  const ready = bake.status === 'ready'
  const errored = bake.status === 'error'
  const progressPct =
    bake.status === 'rendering' ? Math.round((bake.current / Math.max(1, bake.total)) * 100) : 0

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
          {ready && (
            <>
              {' · '}
              {bake.frames.length} frames @ {bake.fps.toFixed(1)} fps
            </>
          )}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <Tooltip content="Re-render frames (use after switching FPS or re-opening)">
            <button
              type="button"
              disabled={baking}
              onClick={() => setReBakeNonce((n) => n + 1)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: 'var(--bg-elevated, #2a2f38)',
                borderRadius: 'var(--radius, 6px)',
                border: '1px solid var(--border, #3d4450)',
                color: 'var(--text, #e8eaed)',
                opacity: baking ? 0.5 : 1
              }}
            >
              <FontAwesomeIcon icon={faRotateRight} />
              Re-render
            </button>
          </Tooltip>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          position: 'relative'
        }}
      >
        {/** The display canvas is always present so we don't tear the layout
         * during bake; it just sits invisible until frames are ready. */}
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            background: '#f4f5f7',
            border: '1px solid #d0d4dc',
            visibility: ready ? 'visible' : 'hidden',
            /** Preserve aspect — sized in CSS, internal pixels set by the hook. */
            aspectRatio: `${project.width} / ${project.height}`,
            objectFit: 'contain'
          }}
        />

        {baking && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'absolute',
              inset: 16,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              color: 'var(--text, #e8eaed)',
              background: 'rgba(20, 24, 32, 0.65)',
              borderRadius: 8
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>Rendering preview frames…</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted, #9aa0a6)' }}>
              {bake.status === 'rendering'
                ? `Frame ${bake.current} / ${bake.total}`
                : ''}
            </div>
            <div
              style={{
                width: 240,
                height: 6,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.08)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: 'var(--accent, #5b8def)',
                  transition: 'width 80ms linear'
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #9aa0a6)' }}>
              Frames are cached at the project FPS — playback won't sample the scene again.
            </div>
          </div>
        )}

        {errored && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              inset: 16,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--danger, #e5484d)'
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>Couldn't render preview</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted, #9aa0a6)' }}>
              {bake.status === 'error' ? bake.error : ''}
            </div>
            <button
              type="button"
              onClick={() => setReBakeNonce((n) => n + 1)}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--border, #3d4450)',
                background: 'var(--bg-elevated, #2a2f38)',
                color: 'var(--text, #e8eaed)'
              }}
            >
              Retry
            </button>
          </div>
        )}
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
        <button
          type="button"
          className="primary"
          disabled={!ready}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} style={{ marginRight: 6 }} />
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            setIsPlaying(false)
            setCurrentTime(0)
          }}
        >
          <FontAwesomeIcon icon={faStop} style={{ marginRight: 6 }} />
          Stop
        </button>
        {/** Scrub slider — uses the cached frames as the seek target. Cheap because
         *  every tick is just a `drawImage`. */}
        <input
          type="range"
          min={0}
          max={Math.max(0.001, duration)}
          step={1 / Math.max(1, ready ? bake.fps : projectFps)}
          value={Math.min(currentTime, duration)}
          disabled={!ready}
          onChange={(e) => {
            const t = Number(e.target.value)
            if (Number.isFinite(t)) {
              setIsPlaying(false)
              setCurrentTime(Math.max(0, Math.min(duration, t)))
            }
          }}
          style={{ flex: '1 1 220px', maxWidth: 360 }}
        />
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
            style={{
              fontSize: 12,
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--bg-app)',
              border: '1px solid var(--border)'
            }}
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
