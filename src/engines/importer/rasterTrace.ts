/**
 * Bitmap → SVG via vendored ImageTracer 1.2.6 (Unlicense / public domain).
 * Heavy tracing runs in a Web Worker so the UI can show progress.
 * @see src/vendor/imagetracer_v1.2.6.js
 */
import RasterTraceWorker from '@/workers/rasterTrace.worker?worker'
import type {
  RasterTraceEngine,
  RasterTraceWorkerRequest
} from '@/workers/rasterTrace.worker'
import type { RasterTraceImageTracerOptions } from '@/engines/importer/rasterTraceOptions'
import { preprocessImageData, type RasterPreprocessOptions } from '@/engines/importer/imagePreprocess'
import type { PotraceOptions } from '@/wasm/potrace/tracer'

export type TraceProgressPayload = {
  phase: string
  percent: number
  layer?: number
  totalLayers?: number
}

export type RasterTracePipelineConfig = {
  maxSide: number
  traceOptions: RasterTraceImageTracerOptions
  preprocess: RasterPreprocessOptions
  /**
   * Which tracing engine to use. `'auto'` (the default) tries the WASM
   * potrace engine first because it's faster and outputs crisper curves for
   * mono/posterised art, then falls back to the legacy ImageTracer when the
   * WASM module isn't usable in the current environment.
   */
  engine?: RasterTraceEngine
  /** Tuning for the WASM potrace path. Ignored when engine === 'imagetracer'. */
  potraceOptions?: PotraceOptions
}

export function humanizeTraceStatus(u: TraceProgressPayload): string {
  switch (u.phase) {
    case 'decode':
      return 'Loading bitmap…'
    case 'scale':
      return 'Scaling for trace…'
    case 'quantization':
      return 'Analyzing colors…'
    case 'layers':
      return u.totalLayers != null && u.layer != null
        ? `Tracing color layers (${u.layer} of ${u.totalLayers})…`
        : 'Tracing color layers…'
    case 'paths-done':
      return 'Finalizing paths…'
    case 'parallel-layering':
      return 'Separating layers…'
    case 'parallel-scan':
      return 'Scanning edges…'
    case 'parallel-interpolate':
      return 'Interpolating curves…'
    case 'parallel-done':
      return 'Building vector layers…'
    case 'svg':
      return 'Generating SVG…'
    case 'done':
      return 'Done.'
    default:
      return 'Tracing…'
  }
}

export async function blobToScaledImageData(blob: Blob, maxSide: number): Promise<ImageData> {
  const bmp = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h)
      const g = canvas.getContext('2d')
      if (!g) throw new Error('Canvas 2D unavailable')
      g.drawImage(bmp, 0, 0, w, h)
      return g.getImageData(0, 0, w, h)
    }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) throw new Error('Canvas 2D unavailable')
    g.drawImage(bmp, 0, 0, w, h)
    return g.getImageData(0, 0, w, h)
  } finally {
    bmp.close?.()
  }
}

async function traceInWorker(
  imgd: ImageData,
  traceOptions: RasterTraceWorkerRequest['traceOptions'],
  onProgress?: (u: TraceProgressPayload) => void,
  engine: RasterTraceEngine = 'auto',
  potraceOptions: PotraceOptions = {}
): Promise<string> {
  const WorkerCtor = RasterTraceWorker as unknown as new () => Worker
  const worker = new WorkerCtor()

  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data as
        | { type: 'progress'; phase: string; percent: number; layer?: number; totalLayers?: number }
        | { type: 'done'; svg: string; engineUsed?: RasterTraceEngine }
        | { type: 'error'; message: string }

      if (d.type === 'progress') {
        onProgress?.({
          phase: d.phase,
          percent: d.percent,
          layer: d.layer,
          totalLayers: d.totalLayers
        })
      } else if (d.type === 'done') {
        const svg = d.svg
        queueMicrotask(() => worker.terminate())
        resolve(svg)
      } else if (d.type === 'error') {
        queueMicrotask(() => worker.terminate())
        reject(new Error(d.message))
      }
    }
    worker.onerror = (ev) => {
      queueMicrotask(() => worker.terminate())
      reject(ev.error ?? new Error('Raster trace worker failed'))
    }

    const buf = imgd.data.buffer.slice(0)
    worker.postMessage(
      {
        imageData: { buffer: buf, width: imgd.width, height: imgd.height },
        traceOptions,
        engine,
        potraceOptions
      } satisfies RasterTraceWorkerRequest,
      [buf]
    )
  })
}

async function traceImageDataOnMainThread(
  imgd: ImageData,
  traceOptions: RasterTraceImageTracerOptions,
  onProgress?: (u: TraceProgressPayload) => void
): Promise<string> {
  const { default: ImageTracer } = await import('@/vendor/imagetracer_v1.2.6.js')
  globalThis.__imageTracerProgress = onProgress
    ? (payload: TraceProgressPayload) => {
        onProgress(payload)
      }
    : undefined
  try {
    return ImageTracer.imagedataToSVG(imgd, traceOptions)
  } finally {
    delete globalThis.__imageTracerProgress
  }
}

/**
 * Decode → scale → optional preprocess → trace.
 *
 * Tracing happens in a Web Worker so the UI stays responsive. The worker
 * tries `potrace-wasm` first (cleaner curves, faster on B&W input) and falls
 * back to the vendored ImageTracer when WASM is unavailable. If the worker
 * itself fails to load (e.g. file:// runs with strict CSP), we run
 * ImageTracer on the main thread as a last resort.
 */
export async function traceBitmapWithConfig(
  blob: Blob,
  config: RasterTracePipelineConfig,
  onProgress?: (u: TraceProgressPayload) => void
): Promise<string> {
  onProgress?.({ phase: 'decode', percent: 2 })
  const scaled = await blobToScaledImageData(blob, config.maxSide)
  onProgress?.({ phase: 'scale', percent: 6 })
  const imgd = preprocessImageData(scaled, config.preprocess)
  if (imgd !== scaled) {
    onProgress?.({ phase: 'scale', percent: 8 })
  }

  try {
    return await traceInWorker(
      imgd,
      config.traceOptions,
      onProgress,
      config.engine ?? 'auto',
      config.potraceOptions ?? {}
    )
  } catch (e) {
    console.warn('[rasterTrace] worker failed, falling back to main thread', e)
    onProgress?.({ phase: 'layers', percent: 15 })
    return traceImageDataOnMainThread(imgd, config.traceOptions, onProgress)
  }
}
