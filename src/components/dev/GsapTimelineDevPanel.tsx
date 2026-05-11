import { useCallback, useMemo, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import {
  runGsapSamplingParityCheck,
  syncGsapTrackTimelineTime,
  type GsapParityReport
} from '@/engines/animation/gsapTrackCompiler'

/**
 * Dev-only: compile tracks → GSAP timeline, optional canvas driver, random parity sampling vs merge().
 */
export function GsapTimelineDevPanel() {
  const [open, setOpen] = useState(false)
  const [parity, setParity] = useState<GsapParityReport | null>(null)
  const gsapCanvasDriver = useEditorStore((s) => s.gsapCanvasDriver)
  const setGsapCanvasDriver = useEditorStore((s) => s.setGsapCanvasDriver)
  const tracks = useEditorStore((s) => s.tracks)
  const elements = useEditorStore((s) => s.project.elements)
  const duration = useEditorStore((s) => s.duration)

  const runParity = useCallback(() => {
    const report = runGsapSamplingParityCheck(elements, tracks, duration, 40)
    setParity(report)
    syncGsapTrackTimelineTime(useEditorStore.getState().currentTime)
  }, [elements, tracks, duration])

  const trackCount = useMemo(() => tracks.length, [tracks])

  if (!import.meta.env.DEV) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 50,
        fontSize: 11,
        maxWidth: 320,
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid var(--border-subtle, #334155)',
          background: 'var(--panel-bg, #1e293b)',
          color: 'var(--text-muted, #94a3b8)',
          cursor: 'pointer'
        }}
      >
        GSAP dev
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--border-subtle, #334155)',
            background: 'var(--panel-bg, #1e293b)',
            color: 'var(--text, #e2e8f0)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)'
          }}
        >
          <div style={{ marginBottom: 8, color: 'var(--text-muted, #94a3b8)' }}>
            Compiles `AnimationTrack[]` into a paused master <code>gsap.timeline()</code> (transforms,
            colors, stroke width, FX, pathD morph, mask / clip-path / filter holds). Motion-path offset
            still uses classic <code>sampleTrack</code>.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={gsapCanvasDriver}
              onChange={(e) => setGsapCanvasDriver(e.target.checked)}
            />
            Drive canvas + inspector from GSAP timeline
          </label>
          <div style={{ marginBottom: 8, color: 'var(--text-muted, #94a3b8)' }}>
            Tracks: {trackCount} · duration {duration.toFixed(2)}s
          </div>
          <button
            type="button"
            onClick={runParity}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle, #334155)',
              background: '#334155',
              color: '#e2e8f0',
              cursor: 'pointer',
              marginBottom: 8
            }}
          >
            Run merge vs GSAP parity (40 samples)
          </button>
          {parity && (
            <div style={{ color: parity.ok ? '#4ade80' : '#f87171', lineHeight: 1.45 }}>
              {parity.ok ? (
                'OK — no transform or attr mismatches in sampled times.'
              ) : (
                <>
                  Mismatch: max transform Δ {parity.maxTransformDelta.toExponential(2)} · attrs issues{' '}
                  {parity.maxAttrsMismatch}
                  {parity.samples.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 10, opacity: 0.9 }}>
                      {parity.samples.slice(0, 12).map((s, i) => (
                        <li key={i}>
                          t={s.time.toFixed(3)} {s.kind} {s.elementId.slice(0, 8)}… {s.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
