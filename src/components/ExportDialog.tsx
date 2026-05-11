import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { dialogAlert } from '@/store/dialogStore'
import { exportAnimatedSvg } from '@/engines/export/exportSvg'
import { exportAnimatedHtml } from '@/engines/export/exportHtml'
import { exportAnimatedGifBytes, exportAnimatedVideoBlob } from '@/engines/export/rasterizeAnimation'

export type ExportFormat = 'html' | 'svg' | 'gif' | 'video'

type ExportCache =
  | { kind: 'text'; content: string; fileName: string; filters: { name: string; extensions: string[] }[] }
  | { kind: 'gif'; bytes: Uint8Array }
  | { kind: 'video'; blob: Blob; ext: string }

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  return btoa(binary)
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = r.result as string
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore((s) => s.project)
  const tracks = useEditorStore((s) => s.tracks)
  const duration = useEditorStore((s) => s.duration)

  const [format, setFormat] = useState<ExportFormat>('svg')
  const [loop, setLoop] = useState(false)
  const [minify, setMinify] = useState(true)
  const [fps, setFps] = useState(24)
  const [maxSide, setMaxSide] = useState(960)
  const [textPreview, setTextPreview] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const cacheRef = useRef<ExportCache | null>(null)

  const safeBase = useMemo(
    () => (project.name || 'export').replace(/[^\w.\-]+/g, '_') || 'export',
    [project.name]
  )

  useEffect(() => {
    cacheRef.current = null
    setTextPreview('')
    setStatusLine('')
    setProgress(null)
  }, [format])

  const generate = useCallback(async () => {
    setProgress(null)
    cacheRef.current = null
    setStatusLine('')

    if (format === 'html') {
      const content = exportAnimatedHtml(project, tracks, duration, { loop, minify, title: project.name })
      setTextPreview(content)
      cacheRef.current = {
        kind: 'text',
        content,
        fileName: `${safeBase}.html`,
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
      }
      return
    }

    if (format === 'svg') {
      const content = exportAnimatedSvg(project, tracks, duration, { loop, minify })
      setTextPreview(content)
      cacheRef.current = {
        kind: 'text',
        content,
        fileName: `${safeBase}.svg`,
        filters: [{ name: 'SVG', extensions: ['svg'] }]
      }
      return
    }

    setBusy(true)
    setTextPreview('')
    try {
      if (format === 'gif') {
        const bytes = await exportAnimatedGifBytes(project, tracks, duration, {
          fps,
          maxSide,
          loop,
          onProgress: (p) => setProgress({ current: p.current, total: p.total })
        })
        cacheRef.current = { kind: 'gif', bytes }
        setStatusLine(`GIF encoded (${(bytes.length / 1024).toFixed(1)} KB).`)
      } else {
        const { blob, ext } = await exportAnimatedVideoBlob(project, tracks, duration, {
          fps,
          maxSide,
          loop,
          onProgress: (p) => setProgress({ current: p.current, total: p.total })
        })
        cacheRef.current = { kind: 'video', blob, ext }
        setStatusLine(`Video encoded (${(blob.size / 1024).toFixed(1)} KB, container .${ext}).`)
      }
    } catch (e) {
      cacheRef.current = null
      await dialogAlert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [format, project, tracks, duration, loop, minify, fps, maxSide, safeBase])

  const copy = async () => {
    if (format === 'gif' || format === 'video') {
      await dialogAlert('Copy is only available for HTML and SVG. Use Save to file for GIF or video.')
      return
    }
    const content =
      textPreview ||
      (format === 'html'
        ? exportAnimatedHtml(project, tracks, duration, { loop, minify, title: project.name })
        : exportAnimatedSvg(project, tracks, duration, { loop, minify }))
    await navigator.clipboard.writeText(content)
  }

  const saveFile = async () => {
    const api = window.api
    const c = cacheRef.current

    if (c?.kind === 'text') {
      if (api?.saveExport) {
        const path = await api.saveExport({
          encoding: 'utf8',
          data: c.content,
          defaultFileName: c.fileName,
          filters: c.filters
        })
        if (path) await dialogAlert(`Saved to ${path}`)
      } else {
        downloadBlob(new Blob([c.content], { type: 'text/plain;charset=utf-8' }), c.fileName)
        await dialogAlert('Download started (desktop save unavailable).')
      }
      return
    }

    if (c?.kind === 'gif') {
      const b64 = uint8ToBase64(c.bytes)
      if (api?.saveExport) {
        const path = await api.saveExport({
          encoding: 'base64',
          data: b64,
          defaultFileName: `${safeBase}.gif`,
          filters: [{ name: 'GIF', extensions: ['gif'] }]
        })
        if (path) await dialogAlert(`Saved to ${path}`)
      } else {
        downloadBlob(new Blob([c.bytes], { type: 'image/gif' }), `${safeBase}.gif`)
        await dialogAlert('Download started.')
      }
      return
    }

    if (c?.kind === 'video') {
      if (api?.saveExport) {
        const b64 = await blobToBase64(c.blob)
        const path = await api.saveExport({
          encoding: 'base64',
          data: b64,
          defaultFileName: `${safeBase}.${c.ext}`,
          filters: [
            c.ext === 'mp4'
              ? { name: 'MP4', extensions: ['mp4'] }
              : { name: 'WebM', extensions: ['webm'] }
          ]
        })
        if (path) await dialogAlert(`Saved to ${path}`)
      } else {
        downloadBlob(c.blob, `${safeBase}.${c.ext}`)
        await dialogAlert('Download started.')
      }
      return
    }

    await dialogAlert('Click Generate first.')
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 'min(920px, 94vw)',
          maxHeight: '88vh',
          background: 'var(--bg-panel)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0 }}>Export</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          HTML and SVG use inline CSS keyframe animation. GIF rasterizes frames in the browser. Video uses
          MediaRecorder (often WebM / VP9; MP4 only if the browser exposes a supported H.264 recorder).
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {(['html', 'svg', 'gif', 'video'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={format === f ? 'primary' : undefined}
              onClick={() => setFormat(f)}
              style={{ textTransform: 'uppercase', fontSize: 12 }}
            >
              {f === 'video' ? 'MP4 / WebM' : f}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 13 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop
          </label>
          {(format === 'html' || format === 'svg') && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} />
              Minify
            </label>
          )}
          {(format === 'gif' || format === 'video') && (
            <>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                FPS
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  {[12, 15, 24, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                Max side (px)
                <select value={maxSide} onChange={(e) => setMaxSide(Number(e.target.value))}>
                  {[480, 640, 960, 1280, 1920].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="primary" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Working…' : 'Generate'}
          </button>
          <button type="button" disabled={busy || format === 'gif' || format === 'video'} onClick={() => void copy()}>
            Copy
          </button>
          <button type="button" disabled={busy} onClick={() => void saveFile()}>
            Save to file…
          </button>
          <button type="button" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>

        {progress && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Frame {progress.current} / {progress.total}
          </div>
        )}
        {statusLine && <div style={{ fontSize: 12, color: 'var(--accent)' }}>{statusLine}</div>}

        {(format === 'html' || format === 'svg') && (
          <textarea
            readOnly
            value={textPreview}
            placeholder="Click Generate for HTML or SVG…"
            style={{
              flex: 1,
              minHeight: 220,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              background: 'var(--bg-app)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 8,
              resize: 'vertical'
            }}
          />
        )}
      </div>
    </div>
  )
}
