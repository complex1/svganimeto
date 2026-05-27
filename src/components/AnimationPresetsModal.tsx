import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { flattenForLayers } from '@/engines/document/tree'
import {
  ANIMATION_PRESETS,
  buildTracksWithPreset,
  samplePresetAtNorm,
  type AnimationPreset,
  type PresetCategory,
  type PresetParam
} from '@/engines/animation/presets'
import { defaultTransform, type Transform } from '@/types/document'
import { dialogAlert } from '@/store/dialogStore'

type Props = {
  open: boolean
  onClose: () => void
}

/** Categories in display order; matches the order of the filter chips. */
const CATEGORY_LABELS: Record<PresetCategory, string> = {
  in: 'Entrance',
  emphasis: 'Emphasis',
  out: 'Exit'
}

const PREVIEW_SIZE = 220

export function AnimationPresetsModal({ open, onClose }: Props) {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const elements = useEditorStore((s) => s.project.elements)
  const duration = useEditorStore((s) => s.duration)
  const currentTime = useEditorStore((s) => s.currentTime)
  const tracks = useEditorStore((s) => s.tracks)
  const setTracks = useEditorStore((s) => s.setTracks)
  const setDuration = useEditorStore((s) => s.setDuration)
  const setMode = useEditorStore((s) => s.setMode)
  const mode = useEditorStore((s) => s.mode)

  const [selectedId, setSelectedId] = useState<string>(ANIMATION_PRESETS[0].id)
  const [paramValues, setParamValues] = useState<Record<string, number | string>>({})
  const [categoryFilter, setCategoryFilter] = useState<PresetCategory | 'all'>('all')
  const [startMode, setStartMode] = useState<'zero' | 'playhead'>('zero')
  const [replaceExisting, setReplaceExisting] = useState(true)

  const preset = useMemo(
    () => ANIMATION_PRESETS.find((p) => p.id === selectedId) ?? ANIMATION_PRESETS[0],
    [selectedId]
  )

  /** Reset params whenever the chosen preset changes. */
  useEffect(() => {
    const next: Record<string, number | string> = {}
    for (const p of preset.params) next[p.id] = p.default
    setParamValues(next)
  }, [preset])

  /** Close on Escape. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  /** Determine the layer whose base transform will anchor the preset. */
  const targetEl =
    selectedIds.length === 1
      ? flattenForLayers(elements).find((x) => x.el.id === selectedIds[0])?.el
      : undefined
  const baseTransform: Transform = targetEl?.transform ?? defaultTransform()
  const previewBase = defaultTransform()

  const visiblePresets = ANIMATION_PRESETS.filter(
    (p) => categoryFilter === 'all' || p.category === categoryFilter
  )

  const presetDuration = Number(paramValues.duration ?? 1)
  const startTime = startMode === 'playhead' ? currentTime : 0

  const apply = () => {
    if (!targetEl) {
      void dialogAlert('Select exactly one layer to apply a preset.')
      return
    }
    /** If the preset's end time exceeds the project's duration, push duration out. */
    const endTime = startTime + presetDuration
    if (endTime > duration) setDuration(endTime)
    const nextTracks = buildTracksWithPreset({
      preset,
      params: paramValues,
      baseTransform,
      startTime,
      tracks,
      elementId: targetEl.id,
      replaceExisting
    })
    setTracks(nextTracks)
    /** Bounce into Animate so the user immediately sees what was added on the timeline. */
    if (mode !== 'animate' && mode !== 'preview') setMode('animate')
    onClose()
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10060,
        padding: 16
      }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="presets-modal-title"
        style={{
          width: 'min(880px, 100%)',
          maxHeight: 'calc(100vh - 40px)',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 id="presets-modal-title" style={{ margin: 0, fontSize: 16 }}>
            Animation Presets
          </h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {targetEl ? `Target: ${targetEl.name}` : 'Select a layer to apply'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['all', 'in', 'emphasis', 'out'] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={categoryFilter === c ? 'primary' : undefined}
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setCategoryFilter(c)}
              >
                {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
          {/* LEFT — preset grid */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-app)',
              padding: 8,
              overflowY: 'auto',
              maxHeight: 460
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8
              }}
            >
              {visiblePresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 6,
                    border:
                      p.id === preset.id
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border)',
                    background:
                      p.id === preset.id ? 'rgba(91,141,239,0.12)' : 'var(--bg-panel)',
                    color: 'var(--text)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em'
                    }}
                  >
                    {CATEGORY_LABELS[p.category]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    {p.description}
                  </span>
                </button>
              ))}
              {visiblePresets.length === 0 && (
                <p style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 12 }}>
                  No presets in this category.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT — preview + config */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-app)',
              padding: 12,
              minHeight: 0,
              overflowY: 'auto',
              maxHeight: 460
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong style={{ fontSize: 14 }}>{preset.name}</strong>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{preset.description}</span>
            </div>

            <PresetPreview
              preset={preset}
              params={paramValues}
              base={previewBase}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {preset.params.map((param) => (
                <ParamRow
                  key={param.id}
                  param={param}
                  value={paramValues[param.id] ?? param.default}
                  onChange={(v) => setParamValues((prev) => ({ ...prev, [param.id]: v }))}
                />
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingTop: 6,
                borderTop: '1px solid var(--border)'
              }}
            >
              <label style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Start at</span>
                <select value={startMode} onChange={(e) => setStartMode(e.target.value as 'zero' | 'playhead')}>
                  <option value="zero">Timeline start (0s)</option>
                  <option value="playhead">Playhead ({currentTime.toFixed(2)}s)</option>
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                />
                Replace existing keyframes for animated properties
              </label>
            </div>
          </div>
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!targetEl}
            title={targetEl ? undefined : 'Select exactly one layer first'}
            onClick={apply}
          >
            Apply to {targetEl?.name ?? 'layer'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ParamRow({
  param,
  value,
  onChange
}: {
  param: PresetParam
  value: number | string
  onChange: (v: number | string) => void
}) {
  if (param.type === 'select') {
    return (
      <label style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>{param.label}</span>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  const num = typeof value === 'number' ? value : Number(value)
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>
        {param.label}
        {param.suffix ? <span style={{ marginLeft: 4 }}>({param.suffix})</span> : null}
      </span>
      <div className="slider-group">
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={Number.isFinite(num) ? num : param.default}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={param.min}
          max={param.max}
          step={param.step}
          value={Number.isFinite(num) ? num : param.default}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(Math.max(param.min, Math.min(param.max, n)))
          }}
        />
      </div>
    </label>
  )
}

/**
 * Tiny in-modal preview. A placeholder square plays the preset on loop using
 * `samplePresetAtNorm` + raf, so the modal stays free of any GSAP / canvas plumbing
 * and the user gets a faithful, lightweight preview before committing.
 */
function PresetPreview({
  preset,
  params,
  base
}: {
  preset: AnimationPreset
  params: Record<string, number | string>
  base: Transform
}) {
  const rectRef = useRef<SVGGElement>(null)
  const [playing, setPlaying] = useState(true)
  const [progressLabel, setProgressLabel] = useState('0.00s')
  const tickRef = useRef(0)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let start = 0
    const duration = Math.max(0.05, Number(params.duration ?? 1))
    const totalMs = duration * 1000
    /** Hold the end-state briefly before restarting, so eye can register the result. */
    const tail = 400
    const loopMs = totalMs + tail

    const step = (ts: number) => {
      if (!start) start = ts
      const elapsed = (ts - start) % loopMs
      const t = Math.min(1, elapsed / totalMs)
      tickRef.current = t
      const sample = samplePresetAtNorm(preset, params, t, base)
      const g = rectRef.current
      if (g) {
        const tx = sample.x ?? base.x
        const ty = sample.y ?? base.y
        const sx = sample.scaleX ?? base.scaleX
        const sy = sample.scaleY ?? base.scaleY
        const rot = sample.rotation ?? base.rotation
        const op = sample.opacity ?? base.opacity
        g.setAttribute('transform', `translate(${tx} ${ty}) rotate(${rot}) scale(${sx} ${sy})`)
        g.setAttribute('opacity', String(op))
      }
      setProgressLabel(`${(t * duration).toFixed(2)}s`)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [preset, params, base, playing])

  const center = PREVIEW_SIZE / 2

  return (
    <div
      style={{
        background: 'repeating-conic-gradient(rgba(255,255,255,0.04) 0deg 90deg, transparent 90deg 180deg) 0 0 / 18px 18px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6
      }}
    >
      <svg
        viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
        width="100%"
        style={{ background: 'transparent', borderRadius: 4 }}
      >
        {/* Center crosshair as anchor reference */}
        <line x1={center - 6} y1={center} x2={center + 6} y2={center} stroke="rgba(255,255,255,0.18)" />
        <line x1={center} y1={center - 6} x2={center} y2={center + 6} stroke="rgba(255,255,255,0.18)" />
        <g transform={`translate(${center} ${center})`}>
          <g ref={rectRef}>
            <rect
              x={-24}
              y={-24}
              width={48}
              height={48}
              rx={6}
              ry={6}
              fill="#5b8def"
              stroke="#fff"
              strokeWidth={1.5}
              opacity={0.95}
            />
          </g>
        </g>
      </svg>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 11,
          color: 'var(--text-muted)'
        }}
      >
        <span>Preview · {progressLabel}</span>
        <button
          type="button"
          style={{ fontSize: 11, padding: '2px 8px' }}
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </div>
  )
}
