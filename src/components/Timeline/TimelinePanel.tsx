import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPause, faPlay, faRepeat, faStop } from '@fortawesome/free-solid-svg-icons'
import { useEditorStore } from '@/store/editorStore'
import type { AnimationTrack } from '@/types/animation'

function formatTime(t: number) {
  return `${t.toFixed(2)}s`
}

type Row = { track: AnimationTrack; label: string }
const TRACK_LABEL_WIDTH = 140

export function TimelinePanel() {
  const duration = useEditorStore((s) => s.duration)
  const currentTime = useEditorStore((s) => s.currentTime)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying)
  const loop = useEditorStore((s) => s.loop)
  const setLoop = useEditorStore((s) => s.setLoop)
  const setDuration = useEditorStore((s) => s.setDuration)
  const tracks = useEditorStore((s) => s.tracks)
  const elements = useEditorStore((s) => s.project.elements)
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe)
  const moveKeyframe = useEditorStore((s) => s.moveKeyframe)
  const upsertKeyframe = useEditorStore((s) => s.upsertKeyframe)
  const autoKeyframe = useEditorStore((s) => s.autoKeyframe)
  const setAutoKeyframe = useEditorStore((s) => s.setAutoKeyframe)
  const mode = useEditorStore((s) => s.mode)
  const [timelineZoom, setTimelineZoom] = useState(1)

  const rulerRef = useRef<HTMLDivElement>(null)
  const [keyframeMenu, setKeyframeMenu] = useState<{
    left: number
    top: number
    trackId: string
    elementId: string
    property: AnimationTrack['property']
    keyframeId: string
    time: number
    value: number
    easing?: AnimationTrack['keyframes'][number]['easing']
  } | null>(null)

  useEffect(() => {
    if (!keyframeMenu) return
    const onPointerDown = () => setKeyframeMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setKeyframeMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [keyframeMenu])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    const walk = (list: typeof elements) => {
      for (const e of list) {
        m.set(e.id, e.name)
        if (e.children) walk(e.children)
      }
    }
    walk(elements)
    return m
  }, [elements])

  const rows: Row[] = useMemo(() => {
    return tracks.map((tr) => ({
      track: tr,
      label: `${nameById.get(tr.elementId) ?? tr.elementId} · ${tr.property}`
    }))
  }, [tracks, nameById])

  const pxPerSec = 120 * timelineZoom

  const resolveDuplicateTime = (trackId: string, baseTime: number) => {
    const track = tracks.find((t) => t.id === trackId)
    if (!track) return Math.min(duration, baseTime + 0.1)
    const hasAt = (time: number) => track.keyframes.some((k) => Math.abs(k.time - time) < 1e-4)
    let t = Math.min(duration, baseTime + 0.1)
    while (t < duration && hasAt(t)) t = Math.min(duration, t + 0.1)
    if (hasAt(t)) t = Math.max(0, baseTime - 0.1)
    while (t > 0 && hasAt(t)) t = Math.max(0, t - 0.1)
    return t
  }

  const onRulerPointer = (e: React.PointerEvent) => {
    if (!rulerRef.current) return
    const rect = rulerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + rulerRef.current.scrollLeft - TRACK_LABEL_WIDTH
    const t = Math.max(0, Math.min(duration, x / pxPerSec))
    setCurrentTime(t)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" className="primary" onClick={() => setIsPlaying(!isPlaying)}>
          <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} style={{ marginRight: 6 }} />
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => { setIsPlaying(false); setCurrentTime(0) }}>
          <FontAwesomeIcon icon={faStop} style={{ marginRight: 6 }} />
          Stop
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <FontAwesomeIcon icon={faRepeat} />
          Loop
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={autoKeyframe} onChange={(e) => setAutoKeyframe(e.target.checked)} disabled={mode !== 'animate'} />
          Auto keyframe
        </label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>t = {formatTime(currentTime)}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 8 }}>
          Timeline Zoom
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.1}
            value={timelineZoom}
            onChange={(e) => setTimelineZoom(Number(e.target.value))}
            style={{ width: 110 }}
          />
          <span style={{ width: 28, textAlign: 'right', color: 'var(--text-muted)' }}>
            {timelineZoom.toFixed(1)}x
          </span>
        </label>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Duration
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={duration}
            style={{ width: 72 }}
            onChange={(e) => setDuration(Number(e.target.value) || 0.1)}
          />
        </label>
      </div>
      <div
        ref={rulerRef}
        className="timeline-ruler"
        style={{ overflowX: 'auto', position: 'relative', minHeight: 28 }}
        onPointerDown={(e) => {
          onRulerPointer(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) onRulerPointer(e)
        }}
      >
        <div
          style={{
            width: TRACK_LABEL_WIDTH + duration * pxPerSec,
            height: '100%',
            position: 'relative'
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: TRACK_LABEL_WIDTH,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--border)'
            }}
          />
          {(() => {
            const minorStep = timelineZoom >= 2 ? 0.1 : timelineZoom >= 1 ? 0.25 : 0.5
            const ticks = Math.floor(duration / minorStep)
            return Array.from({ length: ticks + 1 }).map((_, i) => {
              const t = i * minorStep
              const x = TRACK_LABEL_WIDTH + t * pxPerSec
              const isMajor = Math.abs(t - Math.round(t)) < 1e-6
              const isHalf = !isMajor && Math.abs((t * 2) - Math.round(t * 2)) < 1e-6
              const tickHeight = isMajor ? 18 : isHalf ? 12 : 8
              return (
                <div key={`${t.toFixed(4)}`}>
                  <div
                    style={{
                      position: 'absolute',
                      left: x,
                      top: 0,
                      width: 1,
                      height: tickHeight,
                      background: isMajor ? 'var(--text-muted)' : 'var(--border)'
                    }}
                  />
                  {isMajor && (
                    <span
                      style={{
                        position: 'absolute',
                        left: x + 4,
                        top: 2,
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        userSelect: 'none'
                      }}
                    >
                      {t}s
                    </span>
                  )}
                </div>
              )
            })
          })()}
          <div
            className="playhead"
            style={{ left: TRACK_LABEL_WIDTH + currentTime * pxPerSec }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>Add motion in Animate mode — keyframes appear here.</p>
        ) : (
          rows.map(({ track, label }) => (
            <div key={track.id} className="track-row">
              <div className="track-label" title={label}>
                {label}
              </div>
              <div
                className="track-lane"
                style={{ position: 'relative', minWidth: duration * pxPerSec }}
              >
                {track.keyframes.map((k) => (
                  <div
                    key={k.id}
                    className="keyframe-dot"
                    style={{ left: k.time * pxPerSec }}
                    title={`${k.time}s — ${k.value}`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      const startX = e.clientX
                      const lane = e.currentTarget.parentElement
                      const onMove = (ev: PointerEvent) => {
                        if (!lane) return
                        const rect = lane.getBoundingClientRect()
                        const x = ev.clientX - rect.left + (lane.parentElement?.scrollLeft ?? 0)
                        const nt = Math.max(0, Math.min(duration, x / pxPerSec))
                        moveKeyframe(track.id, k.id, nt)
                      }
                      const onUp = (ev: PointerEvent) => {
                        window.removeEventListener('pointermove', onMove)
                        window.removeEventListener('pointerup', onUp)
                        if (Math.abs(ev.clientX - startX) < 3 && ev.altKey) {
                          removeKeyframe(track.id, k.id)
                        }
                      }
                      window.addEventListener('pointermove', onMove)
                      window.addEventListener('pointerup', onUp)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setKeyframeMenu({
                        left: e.clientX,
                        top: e.clientY,
                        trackId: track.id,
                        elementId: track.elementId,
                        property: track.property,
                        keyframeId: k.id,
                        time: k.time,
                        value: k.value,
                        easing: k.easing
                      })
                    }}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {keyframeMenu && (
        <div
          style={{
            position: 'fixed',
            left: keyframeMenu.left,
            top: keyframeMenu.top,
            minWidth: 140,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
            padding: 4,
            zIndex: 60
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: 4
            }}
            onClick={() => {
              removeKeyframe(keyframeMenu.trackId, keyframeMenu.keyframeId)
              setKeyframeMenu(null)
            }}
          >
            Delete
          </button>
          <button
            type="button"
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: 4
            }}
            onClick={() => {
              const nt = resolveDuplicateTime(keyframeMenu.trackId, keyframeMenu.time)
              upsertKeyframe(
                keyframeMenu.elementId,
                keyframeMenu.property,
                nt,
                keyframeMenu.value,
                keyframeMenu.easing
              )
              setKeyframeMenu(null)
            }}
          >
            Duplicate
          </button>
        </div>
      )}
    </div>
  )
}
