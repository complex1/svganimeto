import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRasterImportModalStore, closeRasterImportModal } from '@/store/rasterImportModalStore'
import {
  buildTracerOptionsFromWizard,
  estimateSvgBytesFromPreview,
  formatBytes,
  loadRasterWizardSettings,
  RASTER_PREVIEW_MAX_SIDE,
  saveRasterWizardSettings,
  type RasterVectorMode,
  type RasterWizardSettings,
  wizardMaxSide
} from '@/engines/importer/rasterTraceSettings'
import { traceBitmapWithConfig } from '@/engines/importer/rasterTrace'
import { applyRasterWizardVectorization } from '@/ipc/fileActions'

const MODE_ROWS: {
  id: RasterVectorMode
  label: string
  hint: string
}[] = [
  {
    id: 'blackWhite',
    label: 'Black & white',
    hint: 'Grayscale quantization (few distinct tones).'
  },
  {
    id: 'limitedColor',
    label: 'Limited color',
    hint: 'K-means palette — good general photos / illustrations.'
  },
  {
    id: 'posterized',
    label: 'Posterized',
    hint: 'Few flat colors plus light blur.'
  },
  {
    id: 'centerline',
    label: 'Centerline-style',
    hint: 'Thin regions / line art approximation (true skeleton traces need other engines).'
  },
  {
    id: 'manual',
    label: 'Manual trace',
    hint: 'Place the raster as a locked reference; draw vectors with Pen / Pencil.'
  }
]

function rowStyle(useFlex = false): CSSProperties {
  return useFlex
    ? { display: 'flex', flexDirection: 'column', gap: 6 }
    : { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 12px', alignItems: 'center' }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--text-muted)',
        marginTop: 8,
        marginBottom: 4
      }}
    >
      {children}
    </div>
  )
}

export function RasterImportModal() {
  const open = useRasterImportModalStore((s) => s.open)
  const blob = useRasterImportModalStore((s) => s.blob)
  const displayName = useRasterImportModalStore((s) => s.displayName)

  const [settings, setSettings] = useState<RasterWizardSettings>(() => loadRasterWizardSettings())
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewSvgLen, setPreviewSvgLen] = useState(0)
  /** UTF-8 byte length (for size label). */
  const [previewUtf8Bytes, setPreviewUtf8Bytes] = useState(0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  const previewGen = useRef(0)
  const rasterObjectUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !blob) return
    setSettings(loadRasterWizardSettings())
  }, [open, blob])

  useEffect(() => {
    if (open) return
    previewGen.current += 1
    setPreviewUrl((prev) => {
      if (prev && prev !== rasterObjectUrl.current) URL.revokeObjectURL(prev)
      return null
    })
    setPreviewSvgLen(0)
    setPreviewUtf8Bytes(0)
    setPreviewError(null)
  }, [open])

  useEffect(() => {
    if (!open || !blob) {
      if (rasterObjectUrl.current) {
        URL.revokeObjectURL(rasterObjectUrl.current)
        rasterObjectUrl.current = null
      }
      setPreviewUrl(null)
      setPreviewSvgLen(0)
      setPreviewError(null)
      return
    }
    const url = URL.createObjectURL(blob)
    rasterObjectUrl.current = url
    return () => {
      URL.revokeObjectURL(url)
      rasterObjectUrl.current = null
    }
  }, [open, blob])

  const runPreview = useCallback(async () => {
    const b = blob
    if (!open || !b) return

    if (settings.mode === 'manual') {
      const ro = rasterObjectUrl.current
      setPreviewUrl(ro)
      setPreviewSvgLen(0)
      setPreviewUtf8Bytes(0)
      setPreviewError(null)
      setPreviewBusy(false)
      return
    }

    const gen = ++previewGen.current
    setPreviewBusy(true)
    setPreviewError(null)

    try {
      const traceOptions = buildTracerOptionsFromWizard(settings)
      const preprocess = {
        invert: settings.vectorizeInvert,
        binarize: settings.vectorizeBinarize,
        threshold: settings.vectorizeThreshold
      }
      const svg = await traceBitmapWithConfig(b, {
        maxSide: RASTER_PREVIEW_MAX_SIDE,
        traceOptions,
        preprocess
      })

      if (gen !== previewGen.current) return

      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const nextUrl = URL.createObjectURL(svgBlob)
      setPreviewUrl((prev) => {
        if (prev && prev !== rasterObjectUrl.current) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setPreviewSvgLen(svg.length)
      setPreviewUtf8Bytes(new TextEncoder().encode(svg).length)
    } catch (e) {
      if (gen !== previewGen.current) return
      setPreviewError(e instanceof Error ? e.message : String(e))
      setPreviewUrl((prev) => {
        if (prev && prev !== rasterObjectUrl.current) URL.revokeObjectURL(prev)
        return null
      })
      setPreviewSvgLen(0)
      setPreviewUtf8Bytes(0)
    } finally {
      if (gen === previewGen.current) setPreviewBusy(false)
    }
  }, [blob, open, settings])

  useEffect(() => {
    if (!open || !blob) return
    const t = window.setTimeout(() => {
      void runPreview()
    }, 420)
    return () => clearTimeout(t)
  }, [open, blob, runPreview])


  const fullMax = wizardMaxSide(settings.quality)
  const estBytes =
    settings.mode === 'manual'
      ? 0
      : estimateSvgBytesFromPreview(previewUtf8Bytes, RASTER_PREVIEW_MAX_SIDE, fullMax)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || applying) return
      e.preventDefault()
      e.stopPropagation()
      closeRasterImportModal()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, applying])

  if (!open || !blob) return null

  const manual = settings.mode === 'manual'

  const onApply = async () => {
    setApplying(true)
    try {
      saveRasterWizardSettings(settings)
      await applyRasterWizardVectorization(blob, displayName, settings)
      closeRasterImportModal()
    } catch (e) {
      console.error(e)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10060,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: 16,
        overflow: 'auto'
      }}
      onMouseDown={() => !applying && closeRasterImportModal()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="raster-import-title"
        style={{
          width: 'min(920px, 100%)',
          margin: 'auto',
          background: 'var(--bg-panel)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: '18px 20px 16px',
          display: 'grid',
          gridTemplateColumns: '1fr min(340px, 38vw)',
          gap: 18,
          maxHeight: 'min(720px, 92vh)',
          boxShadow: '0 16px 56px rgba(0,0,0,0.45)'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ overflow: 'auto', paddingRight: 4 }}>
          <h2 id="raster-import-title" style={{ margin: '0 0 12px', fontSize: 18 }}>
            Raster → vector
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            {displayName}
          </div>

          <SectionTitle>Mode</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {MODE_ROWS.map((m) => (
              <label
                key={m.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="radio"
                  name="raster-mode"
                  checked={settings.mode === m.id}
                  onChange={() =>
                    setSettings((s) => ({
                      ...s,
                      mode: m.id,
                      ...(m.id === 'blackWhite'
                        ? { colorCount: Math.min(s.colorCount, 8) }
                        : m.id === 'posterized'
                          ? { colorCount: Math.min(Math.max(s.colorCount, 3), 12) }
                          : {})
                    }))
                  }
                />
                <span>
                  <span style={{ fontWeight: 500 }}>{m.label}</span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{m.hint}</div>
                </span>
              </label>
            ))}
          </div>

          <SectionTitle>Quality (output resolution)</SectionTitle>
          <div style={rowStyle()}>
            {(
              [
                ['tiny', 'Tiny', 'Fast, smallest files'],
                ['balanced', 'Balanced', 'Recommended default'],
                ['highQuality', 'High quality', 'More detail — heavier SVG']
              ] as const
            ).map(([id, lab, hint]) => (
              <label key={id} style={{ display: 'contents' }}>
                <span style={{ fontSize: 13 }}>{lab}</span>
                <span>
                  <input
                    type="radio"
                    name="raster-quality"
                    checked={settings.quality === id}
                    disabled={manual}
                    onChange={() =>
                      setSettings((s) => ({
                        ...s,
                        quality: id
                      }))
                    }
                  />
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {!manual ? (
            <>
              <SectionTitle>Shape & complexity</SectionTitle>
              <div style={rowStyle(true)}>
                <label style={{ fontSize: 13 }}>
                  Color count: <strong>{settings.colorCount}</strong>
                  <input
                    type="range"
                    min={2}
                    max={64}
                    value={settings.colorCount}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, colorCount: Number(e.target.value) }))
                    }
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  Path smoothness (fewer anchors):{' '}
                  <strong>{settings.pathSmoothness}</strong>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.pathSmoothness}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        pathSmoothness: Number(e.target.value)
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  Detail threshold (omit small regions):{' '}
                  <strong>{settings.detailThreshold}</strong>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.detailThreshold}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        detailThreshold: Number(e.target.value)
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  Noise removal (blur before trace): <strong>{settings.noiseRemoval}</strong>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.noiseRemoval}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        noiseRemoval: Number(e.target.value)
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <SectionTitle>Raster preprocessing</SectionTitle>
              <div style={rowStyle(true)}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.vectorizeInvert}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, vectorizeInvert: e.target.checked }))
                    }
                  />
                  Invert colors
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.vectorizeBinarize}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, vectorizeBinarize: e.target.checked }))
                    }
                  />
                  Threshold (binary black / white before trace)
                </label>
                <label style={{ fontSize: 13 }}>
                  Luminance threshold: <strong>{settings.vectorizeThreshold}</strong>
                  <input
                    type="range"
                    min={1}
                    max={254}
                    disabled={!settings.vectorizeBinarize}
                    value={settings.vectorizeThreshold}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        vectorizeThreshold: Number(e.target.value)
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                </label>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
              Vectorization controls are skipped. The raster is inserted as a single locked reference
              image; use Pen or Pencil to trace on top (unlock the layer in the Layers panel when you no
              longer need it fixed).
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" disabled={applying} onClick={() => closeRasterImportModal()}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={applying} onClick={() => void onApply()}>
              {applying ? 'Applying…' : settings.mode === 'manual' ? 'Insert reference' : 'Apply vectorization'}
            </button>
          </div>
        </div>

        <aside
          style={{
            borderLeft: '1px solid var(--border)',
            paddingLeft: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 0
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>Preview</div>
          <div
            style={{
              flex: 1,
              minHeight: 220,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background:
                'repeating-conic-gradient(var(--bg-app) 0% 25%, rgba(127,127,127,0.06) 0% 50%) 50% / 16px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              padding: 8
            }}
          >
            {previewBusy ? (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Updating preview…</span>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                style={{ maxWidth: '100%', maxHeight: 'min(340px, 48vh)', objectFit: 'contain' }}
              />
            ) : previewError ? (
              <span style={{ fontSize: 12, color: 'salmon', textAlign: 'center', padding: 8 }}>
                {previewError}
              </span>
            ) : null}
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Preview is traced at roughly <strong>{RASTER_PREVIEW_MAX_SIDE}px</strong> on the longest side —
            faster than the final export.
          </div>

          <SectionTitle>Estimated SVG size</SectionTitle>
          <div style={{ fontSize: 14 }}>
            {manual ? (
              <span style={{ color: 'var(--text-muted)' }}>
                Automatic vectorization skipped (reference raster only).
              </span>
            ) : previewSvgLen > 0 ? (
              <>
                <div>
                  Preview sample (UTF-8):{' '}
                  <strong>{formatBytes(previewUtf8Bytes)}</strong>
                </div>
                <div style={{ marginTop: 6 }}>
                  Est. full export (~{fullMax}px):{' '}
                  <strong>{formatBytes(estBytes)}</strong>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.85 }}>
                  Heuristic scaling from preview trace — actual size varies with image content.
                </div>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                Waiting for preview…
              </span>
            )}
          </div>

          <button
            type="button"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            disabled={previewBusy || manual}
            onClick={() => void runPreview()}
          >
            Refresh preview
          </button>
        </aside>
      </div>
    </div>
  )
}
