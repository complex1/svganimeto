import { useEditorStore } from '@/store/editorStore'
import { dialogAlert } from '@/store/dialogStore'
import { humanizeTraceStatus, traceBitmapWithConfig } from '@/engines/importer/rasterTrace'
import {
  buildTracerOptionsFromWizard,
  wizardMaxSide,
  type RasterWizardSettings
} from '@/engines/importer/rasterTraceSettings'
import {
  closeTraceOverlay,
  openTraceOverlay,
  setTraceOverlay
} from '@/store/traceOverlayStore'
import { openRasterImportModal } from '@/store/rasterImportModalStore'

async function flushNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('Failed to read image'))
    fr.readAsDataURL(blob)
  })
}

function guardSymbolEditing(): boolean {
  if (useEditorStore.getState().symbolEditBackup) {
    void dialogAlert('Finish or cancel symbol editing first.')
    return true
  }
  return false
}

export async function openProjectFile() {
  if (guardSymbolEditing()) return
  const api = window.api
  if (!api?.openProject) return
  const res = await api.openProject()
  if (!res) return
  useEditorStore.getState().hydrateFromJson(res.content)
  useEditorStore.setState({ projectPath: res.path })
}

export async function saveProjectFile() {
  if (guardSymbolEditing()) return
  const api = window.api
  const json = useEditorStore.getState().serializeProject()
  const name = `${useEditorStore.getState().project.name || 'project'}.svgmotion`
  if (!api?.saveProject) {
    await navigator.clipboard.writeText(json)
    await dialogAlert('Copied project JSON (desktop save unavailable).')
    return
  }
  const path = await api.saveProject(json, name)
  if (path) useEditorStore.setState({ projectPath: path })
}

export async function importSvgFile() {
  const api = window.api
  if (!api?.importSvg) return
  const res = await api.importSvg()
  if (!res) return
  applyImportedSvg(res.content, res.path.split(/[/\\]/).pop() ?? 'Imported')
}

/** Decode `data:mime;base64,...` without fetch — CSP `connect-src` defaults block blob:/data: fetch. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Invalid data URL')
  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mimeMatch = /^data:([^;,]+)/.exec(header)
  const mime = mimeMatch?.[1]?.trim() ?? 'application/octet-stream'
  if (/;base64/i.test(header)) {
    const binary = atob(body)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(body)], { type: mime })
}

function toRasterBlob(source: Blob | File | string): Blob {
  if (typeof source === 'string') {
    if (!source.startsWith('data:')) {
      throw new Error('Raster source must be a File, Blob, or data URL')
    }
    return dataUrlToBlob(source)
  }
  return source
}

/** Open the vectorization wizard (after user picks a raster file). */
export function openRasterVectorizeWizard(source: Blob | File | string, displayName: string) {
  if (guardSymbolEditing()) return
  try {
    const blob = toRasterBlob(source)
    openRasterImportModal(blob, displayName)
  } catch (e) {
    console.error('[raster import]', e)
    void dialogAlert(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Run full trace from wizard settings (overlay + GC-friendly apply). Call after user confirms in modal.
 */
export async function applyRasterWizardVectorization(
  blob: Blob,
  projectBaseName: string,
  settings: RasterWizardSettings
): Promise<void> {
  const baseName =
    projectBaseName.replace(/\.(png|jpe?g|webp|gif)$/i, '').trim() || 'Traced image'

  if (settings.mode === 'manual') {
    const bmp = await createImageBitmap(blob)
    try {
      const dataUrl = await blobToDataUrl(blob)
      useEditorStore
        .getState()
        .importRasterManualReference(dataUrl, bmp.width, bmp.height, `${baseName} (manual)`)
    } finally {
      bmp.close?.()
    }
    return
  }

  openTraceOverlay({ percent: 0, statusLine: 'Preparing trace…' })
  await flushNextPaint()

  try {
    setTraceOverlay({ percent: 4, statusLine: 'Reading bitmap…' })
    await flushNextPaint()

    const traceOptions = buildTracerOptionsFromWizard(settings)
    const maxSide = wizardMaxSide(settings.quality)
    const preprocess = {
      invert: settings.vectorizeInvert,
      binarize: settings.vectorizeBinarize,
      threshold: settings.vectorizeThreshold
    }

    const svg = await traceBitmapWithConfig(
      blob,
      { maxSide, traceOptions, preprocess },
      (u) => {
        setTraceOverlay({
          percent: u.percent,
          statusLine: humanizeTraceStatus(u)
        })
      }
    )

    setTraceOverlay({ percent: 99, statusLine: 'Applying trace…' })
    useEditorStore.getState().evictToEmptyProject()
    await flushNextPaint()
    await new Promise<void>((r) => setTimeout(r, 0))
    await new Promise<void>((r) => setTimeout(r, 32))

    applyImportedSvg(svg, `${baseName} trace`, { resetHistory: true })
  } catch (e) {
    console.error('[raster import]', e)
    await dialogAlert(
      `Could not trace image (${e instanceof Error ? e.message : String(e)}). Try Draft quality, fewer colors, or a smaller image.`
    )
  } finally {
    closeTraceOverlay()
  }
}

export async function importRasterTraceFile() {
  if (guardSymbolEditing()) return
  const api = window.api
  if (api?.importRaster) {
    const res = await api.importRaster()
    if (!res) return
    openRasterVectorizeWizard(res.dataUrl, res.path.split(/[/\\]/).pop() ?? 'Image')
  }
}

/** Shared path for Electron IPC and browser file picker. */
export function applyImportedSvg(
  svgText: string,
  label: string,
  opts?: { resetHistory?: boolean }
) {
  const name = label.replace(/\.svg$/i, '') || 'Imported'
  useEditorStore.getState().importSvgFromString(svgText, name, opts)
  if (useEditorStore.getState().project.elements.length === 0) {
    console.warn(
      '[SVG Animation Studio] Import produced no layers. Common causes: SVG is `<use>` / `<symbol>` only, malformed XML, or wrappers we do not parse yet.'
    )
  }
}
