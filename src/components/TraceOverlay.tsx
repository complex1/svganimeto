import { useTraceOverlayStore } from '@/store/traceOverlayStore'

/** Full-screen overlay while raster → vector tracing runs (can block the main thread). */
export function TraceOverlay() {
  const open = useTraceOverlayStore((s) => s.open)
  const percent = useTraceOverlayStore((s) => s.percent)
  const statusLine = useTraceOverlayStore((s) => s.statusLine)

  if (!open) return null

  const pct = Math.min(100, Math.max(0, Math.round(percent)))

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Tracing image to vectors"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10040,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--bg-panel)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          padding: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)'
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Tracing raster…</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, minHeight: 40 }}>
          {statusLine}
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 4,
            background: 'var(--bg-app)',
            overflow: 'hidden',
            border: '1px solid var(--border)'
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--accent-dim), var(--accent))',
              borderRadius: 3,
              transition: 'width 0.12s ease-out'
            }}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
          {pct}%
        </div>
      </div>
    </div>
  )
}
