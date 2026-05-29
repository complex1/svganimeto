import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPause, faPlay, faRepeat, faStop, faTrash } from '@fortawesome/free-solid-svg-icons'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'
import type { AnimatableProperty, AnimationTrack, EasingId } from '@/types/animation'

function formatTime(t: number) {
  return `${t.toFixed(2)}s`
}

const ANIMATABLE_PROPS: AnimatableProperty[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'skewX',
  'skewY',
  'fill',
  'stroke',
  'strokeWidth',
  'pathD',
  'fxBlur',
  'fxShadowX',
  'fxShadowY',
  'fxShadowBlur',
  'fxShadowColor',
  'motionPathOffset',
  'mask',
  'clipPath',
  'svgFilter'
]

/**
 * Easing presets exposed on the inline keyframe inspector in the timeline
 * header. The right-click context menu intentionally stays focused on
 * destructive actions (delete / duplicate) — easing lives in the inspector
 * row where the user can preview the change without dismissing the menu.
 */
const EASING_OPTIONS: { id: EasingId; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in (quad)' },
  { id: 'easeOut', label: 'Ease out (quad)' },
  { id: 'easeInOut', label: 'Ease in-out (quad)' },
  { id: 'easeInCubic', label: 'Ease in (cubic)' },
  { id: 'easeOutCubic', label: 'Ease out (cubic)' },
  { id: 'easeInOutCubic', label: 'Ease in-out (cubic)' },
  { id: 'easeInBack', label: 'Ease in (back)' },
  { id: 'easeOutBack', label: 'Ease out (back)' },
  { id: 'easeInOutBack', label: 'Ease in-out (back)' }
]

type Row = { track: AnimationTrack; label: string }
const TRACK_LABEL_WIDTH = 140

function snapTime(t: number, snap: boolean, fps: number, duration: number): number {
  const clamped = Math.max(0, Math.min(duration, t))
  if (!snap || fps <= 0) return clamped
  return Math.max(0, Math.min(duration, Math.round(clamped * fps) / fps))
}

function selectionKey(trackId: string, keyframeId: string) {
  return `${trackId}\t${keyframeId}`
}

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
  const setTracks = useEditorStore((s) => s.setTracks)
  const elements = useEditorStore((s) => s.project.elements)
  const fps = useEditorStore((s) => s.fps)
  const playbackSpeed = useEditorStore((s) => s.playbackSpeed)
  const setPlaybackSpeed = useEditorStore((s) => s.setPlaybackSpeed)
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe)
  const upsertKeyframe = useEditorStore((s) => s.upsertKeyframe)
  const setKeyframeEasing = useEditorStore((s) => s.setKeyframeEasing)
  const mode = useEditorStore((s) => s.mode)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const addKeyframeAtPlayhead = useEditorStore((s) => s.addKeyframeAtPlayhead)
  const selectedKeyframes = useEditorStore((s) => s.selectedKeyframes)

  const [timelineZoom, setTimelineZoom] = useState(1)
  const [snapToFrame, setSnapToFrame] = useState(false)
  const snapToFrameRef = useRef(false)
  useEffect(() => {
    snapToFrameRef.current = snapToFrame
  }, [snapToFrame])
  const [rulerMode, setRulerMode] = useState<'seconds' | 'frames'>('seconds')
  const [addKfProperty, setAddKfProperty] = useState<AnimatableProperty>('x')

  const scrollRef = useRef<HTMLDivElement>(null)
  const laneMarqueeRef = useRef<{
    trackId: string
    shiftKey: boolean
    startX: number
    endX: number
    pointerId: number
  } | null>(null)
  const [laneMarqueeUi, setLaneMarqueeUi] = useState<{
    trackId: string
    startX: number
    endX: number
  } | null>(null)

  const kfDragRef = useRef<{
    pointerId: number
    originClientX: number
    /** trackId -> keyframeId -> time at drag start */
    starts: Map<string, Map<string, number>>
  } | null>(null)

  const [keyframeMenu, setKeyframeMenu] = useState<{
    left: number
    top: number
    trackId: string
    elementId: string
    property: AnimationTrack['property']
    keyframeId: string
    time: number
    value: number
    valueText?: string
    easing?: AnimationTrack['keyframes'][number]['easing']
  } | null>(null)

  const selectedKfSet = useMemo(() => {
    const s = new Set<string>()
    for (const e of selectedKeyframes) {
      s.add(selectionKey(e.trackId, e.keyframeId))
    }
    return s
  }, [selectedKeyframes])

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

  const timeFromClientX = (clientX: number, laneLeft: number) => {
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const x = clientX - laneLeft + scrollLeft
    return Math.max(0, Math.min(duration, x / pxPerSec))
  }

  const onRulerPointer = (e: React.PointerEvent) => {
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const raw = timeFromClientX(e.clientX, rect.left)
    setCurrentTime(snapTime(raw, snapToFrame, fps, duration))
  }

  const soleSelectedKeyframe =
    selectedKeyframes.length === 1
      ? (() => {
          const one = selectedKeyframes[0]!
          const tr = tracks.find((t) => t.id === one.trackId)
          const k = tr?.keyframes.find((x) => x.id === one.keyframeId)
          if (!tr || !k) return null
          return { trackId: tr.id, keyframeId: k.id, easing: k.easing ?? ('linear' as EasingId) }
        })()
      : null

  const beginKeyframeDrag = (
    e: React.PointerEvent,
    track: AnimationTrack,
    k: { id: string; time: number }
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useEditorStore.getState()
    const sel = st.selectedKeyframes
    const idx = sel.findIndex((s) => s.trackId === track.id && s.keyframeId === k.id)

    let nextSel = sel
    if (e.shiftKey) {
      if (idx >= 0) {
        nextSel = sel.filter((_, i) => i !== idx)
      } else {
        nextSel = [...sel, { trackId: track.id, keyframeId: k.id }]
      }
      st.setSelectedKeyframes(nextSel)
    } else {
      if (idx >= 0 && sel.length > 1) {
        nextSel = sel
      } else {
        nextSel = [{ trackId: track.id, keyframeId: k.id }]
        st.setSelectedKeyframes(nextSel)
      }
    }

    const active = useEditorStore.getState().selectedKeyframes
    if (active.length === 0) return

    const starts = new Map<string, Map<string, number>>()
    for (const s of active) {
      const tr = useEditorStore.getState().tracks.find((t) => t.id === s.trackId)
      const kk = tr?.keyframes.find((x) => x.id === s.keyframeId)
      if (!tr || !kk) continue
      if (!starts.has(tr.id)) starts.set(tr.id, new Map())
      starts.get(tr.id)!.set(kk.id, kk.time)
    }
    if (starts.size === 0) return

    useEditorStore.getState().pushHistory()
    kfDragRef.current = {
      pointerId: e.pointerId,
      originClientX: e.clientX,
      starts
    }

    const onMove = (ev: PointerEvent) => {
      const d = kfDragRef.current
      if (!d || ev.pointerId !== d.pointerId) return
      const sNow = useEditorStore.getState()
      const dur = sNow.duration
      const f = sNow.fps
      const snap = snapToFrameRef.current
      const dt = (ev.clientX - d.originClientX) / pxPerSec
      for (const [tid, inner] of d.starts) {
        for (const [kid, t0] of inner) {
          let nt = t0 + dt
          nt = snapTime(nt, snap, f, dur)
          sNow.moveKeyframe(tid, kid, nt, { skipHistory: true })
        }
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      kfDragRef.current = null
      if (Math.abs(ev.clientX - e.clientX) < 3 && ev.altKey) {
        useEditorStore.getState().removeKeyframe(track.id, k.id)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onLaneBackgroundPointerDown = (
    e: React.PointerEvent,
    track: AnimationTrack,
    laneEl: HTMLDivElement
  ) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.keyframe-dot, .keyframe-dot-anchor')) return
    const rect = laneEl.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    laneMarqueeRef.current = {
      trackId: track.id,
      shiftKey: e.shiftKey,
      startX: x,
      endX: x,
      pointerId: e.pointerId
    }
    setLaneMarqueeUi({ trackId: track.id, startX: x, endX: x })

    const onMove = (ev: PointerEvent) => {
      const m = laneMarqueeRef.current
      if (!m || ev.pointerId !== m.pointerId) return
      const r = laneEl.getBoundingClientRect()
      const nx = ev.clientX - r.left + (scrollRef.current?.scrollLeft ?? 0)
      m.endX = nx
      setLaneMarqueeUi({ trackId: m.trackId, startX: m.startX, endX: nx })
    }

    const onUp = (ev: PointerEvent) => {
      const m = laneMarqueeRef.current
      if (!m || ev.pointerId !== m.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      laneMarqueeRef.current = null
      setLaneMarqueeUi(null)

      const tMin = Math.min(m.startX, m.endX) / pxPerSec
      const tMax = Math.max(m.startX, m.endX) / pxPerSec
      const tr = useEditorStore.getState().tracks.find((t) => t.id === m.trackId)
      if (!tr) return
      if (Math.abs(m.endX - m.startX) < 3) {
        if (!m.shiftKey) useEditorStore.getState().clearKeyframeSelection()
        return
      }
      const hits = tr.keyframes
        .filter((kf) => kf.time >= tMin - 1e-6 && kf.time <= tMax + 1e-6)
        .map((kf) => ({ trackId: tr.id, keyframeId: kf.id }))
      if (m.shiftKey) {
        const prev = useEditorStore.getState().selectedKeyframes
        const seen = new Set(prev.map((p) => selectionKey(p.trackId, p.keyframeId)))
        const merged = [...prev]
        for (const h of hits) {
          const key = selectionKey(h.trackId, h.keyframeId)
          if (!seen.has(key)) {
            seen.add(key)
            merged.push(h)
          }
        }
        useEditorStore.getState().setSelectedKeyframes(merged)
      } else {
        useEditorStore.getState().setSelectedKeyframes(hits)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
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
          <input type="checkbox" checked={snapToFrame} onChange={(e) => setSnapToFrame(e.target.checked)} />
          Snap
        </label>
        <Tooltip content="Toggle ruler: seconds vs frames">
          <button
            type="button"
            onClick={() => setRulerMode((m) => (m === 'seconds' ? 'frames' : 'seconds'))}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            Ruler: {rulerMode === 'seconds' ? 's' : 'f'}
          </button>
        </Tooltip>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          Speed
          <select
            value={String(playbackSpeed)}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            style={{ fontSize: 12 }}
          >
            {[0.25, 0.5, 1, 2, 4].map((sp) => (
              <option key={sp} value={sp}>
                {sp}x
              </option>
            ))}
          </select>
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
        {selectedIds.length === 1 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            + KF
            <select
              value={addKfProperty}
              onChange={(e) => setAddKfProperty(e.target.value as AnimatableProperty)}
              style={{ fontSize: 12 }}
            >
              {ANIMATABLE_PROPS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={mode !== 'animate' && mode !== 'preview'}
              onClick={() => addKeyframeAtPlayhead(selectedIds[0]!, addKfProperty)}
            >
              Add at playhead
            </button>
          </label>
        )}
        {soleSelectedKeyframe && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            Easing
            <select
              value={soleSelectedKeyframe.easing}
              onChange={(e) =>
                setKeyframeEasing(soleSelectedKeyframe.trackId, soleSelectedKeyframe.keyframeId, e.target.value as EasingId)
              }
              style={{ fontSize: 12, maxWidth: 160 }}
            >
              {EASING_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
      <div className="timeline-body">
        <div className="timeline-label-column" style={{ width: TRACK_LABEL_WIDTH }}>
          <div className="timeline-ruler-gutter" aria-hidden />
          {rows.map(({ track, label }) => (
            <div
              key={track.id}
              className="track-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingRight: 4,
                minWidth: 0
              }}
            >
              <Tooltip
                content={label}
                anchorClassName="tooltip-anchor--block"
                anchorStyle={{ flex: 1, minWidth: 0 }}
              >
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {label}
                </span>
              </Tooltip>
              <Tooltip content="Remove this property's animation">
                <button
                  type="button"
                  aria-label={`Remove animation for ${label}`}
                  onClick={() =>
                    /**
                     * Drop just this one track from the timeline. setTracks routes
                     * through history so the user can undo if they didn't mean to.
                     */
                    setTracks(tracks.filter((t) => t.id !== track.id))
                  }
                  style={{
                    flex: 'none',
                    width: 22,
                    height: 22,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontSize: 11
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
        <div ref={scrollRef} className="timeline-scroll">
          <div className="timeline-time-inner" style={{ width: duration * pxPerSec, minWidth: '100%' }}>
            <div
              className="timeline-ruler"
              onPointerDown={onRulerPointer}
              onPointerMove={(e) => {
                if (e.buttons === 1) onRulerPointer(e)
              }}
            >
              {(() => {
                const minorStep = timelineZoom >= 2 ? 0.1 : timelineZoom >= 1 ? 0.25 : 0.5
                const ticks = Math.floor(duration / minorStep)
                return Array.from({ length: ticks + 1 }).map((_, i) => {
                  const t = i * minorStep
                  const x = t * pxPerSec
                  const isMajor = Math.abs(t - Math.round(t)) < 1e-6
                  const isHalf = !isMajor && Math.abs(t * 2 - Math.round(t * 2)) < 1e-6
                  const tickHeight = isMajor ? 18 : isHalf ? 12 : 8
                  const majorLabel =
                    rulerMode === 'frames' && isMajor ? `${Math.round(t * fps)}f` : `${t}s`
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
                          {majorLabel}
                        </span>
                      )}
                    </div>
                  )
                })
              })()}
              <div className="playhead" style={{ left: currentTime * pxPerSec }} />
            </div>
            {rows.length === 0 ? (
              <p className="timeline-empty">Add motion in Animate mode — keyframes appear here.</p>
            ) : (
              rows.map(({ track }) => (
                <div
                  key={track.id}
                  className="track-lane"
                  onPointerDown={(e) => onLaneBackgroundPointerDown(e, track, e.currentTarget)}
                >
                  {laneMarqueeUi?.trackId === track.id && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 2,
                        bottom: 2,
                        left: Math.min(laneMarqueeUi.startX, laneMarqueeUi.endX),
                        width: Math.abs(laneMarqueeUi.endX - laneMarqueeUi.startX),
                        background: 'rgba(91,141,239,0.2)',
                        border: '1px dashed #5b8def',
                        pointerEvents: 'none',
                        zIndex: 1
                      }}
                    />
                  )}
                  <div className="playhead playhead--lane" style={{ left: currentTime * pxPerSec }} />
                  {track.keyframes.map((k) => {
                    const keyframeTooltip =
                      k.valueText !== undefined
                        ? `${k.time}s — ${k.value} — ${k.valueText.length > 48 ? `${k.valueText.slice(0, 48)}…` : k.valueText}`
                        : `${k.time}s — ${k.value}`
                    return (
                      <Tooltip
                        key={k.id}
                        content={keyframeTooltip}
                        anchorClassName="keyframe-dot-anchor"
                        anchorStyle={{
                          position: 'absolute',
                          left: k.time * pxPerSec,
                          top: '50%',
                          transform: 'translate(-50%, -50%)'
                        }}
                      >
                        <div
                          className={`keyframe-dot${selectedKfSet.has(selectionKey(track.id, k.id)) ? ' keyframe-dot--selected' : ''}`}
                          onPointerDown={(e) => beginKeyframeDrag(e, track, k)}
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
                              valueText: k.valueText,
                              easing: k.easing
                            })
                          }}
                        />
                      </Tooltip>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {keyframeMenu && (
        <div
          style={{
            position: 'fixed',
            left: keyframeMenu.left,
            top: keyframeMenu.top,
            transform: 'translateY(-100%)',
            minWidth: 160,
            maxHeight: '70vh',
            overflowY: 'auto',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
            padding: 4,
            zIndex: 60
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/*
           * Context-menu surface intentionally limited to destructive / copy
           * actions. Easing was moved out of here — too easy to mis-click a
           * preset and not realise the curve changed; the inline picker in
           * the timeline header lets users iterate with visible feedback.
           */}
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
                keyframeMenu.easing,
                { valueText: keyframeMenu.valueText }
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
