/// <reference lib="webworker" />

import ImageTracer from '@/vendor/imagetracer_v1.2.6.js'
import type { RasterTraceImageTracerOptions } from '@/engines/importer/rasterTraceOptions'
import { tracePotraceImageData, type PotraceOptions } from '@/wasm/potrace/tracer'

export type RasterTraceEngine = 'auto' | 'potrace-wasm' | 'imagetracer'

export type RasterTraceWorkerRequest = {
  imageData: { buffer: ArrayBuffer; width: number; height: number }
  traceOptions: RasterTraceImageTracerOptions
  /**
   * Which tracing engine to use.
   *   - `'auto'` (default): try potrace-wasm first, fall back to ImageTracer.
   *   - `'potrace-wasm'`: WASM only — error out instead of falling back.
   *   - `'imagetracer'`: skip WASM, use ImageTracer directly (legacy parity).
   */
  engine?: RasterTraceEngine
  potraceOptions?: PotraceOptions
}

type ProgressPayload = {
  phase: string
  percent: number
  layer?: number
  totalLayers?: number
}

declare global {
  // eslint-disable-next-line no-var
  var __imageTracerProgress: ((payload: ProgressPayload) => void) | undefined
}

const ctx = self as DedicatedWorkerGlobalScope

function emit(payload: ProgressPayload): void {
  ctx.postMessage({ type: 'progress', ...payload })
}

function runImageTracer(imgd: ImageData, traceOptions: RasterTraceImageTracerOptions): string {
  /**
   * ImageTracer reads `globalThis.__imageTracerProgress` from inside its hot
   * loop to emit phase updates; the global is the only progress hook the
   * vendored library exposes. We restore it after each invocation so a future
   * call (e.g. WASM-failure-then-fallback) sees a clean slate.
   */
  globalThis.__imageTracerProgress = emit
  try {
    return ImageTracer.imagedataToSVG(imgd, traceOptions)
  } finally {
    delete globalThis.__imageTracerProgress
  }
}

ctx.onmessage = async (ev: MessageEvent<RasterTraceWorkerRequest>) => {
  const { buffer, width, height } = ev.data.imageData
  const traceOptions = ev.data.traceOptions ?? 'default'
  const engine: RasterTraceEngine = ev.data.engine ?? 'auto'
  const potraceOptions = ev.data.potraceOptions ?? {}
  const copy = new Uint8ClampedArray(buffer)
  const imgd = new ImageData(copy, width, height)

  try {
    if (engine === 'imagetracer') {
      const svg = runImageTracer(imgd, traceOptions)
      ctx.postMessage({ type: 'done', svg, engineUsed: 'imagetracer' satisfies RasterTraceEngine })
      return
    }

    if (engine === 'potrace-wasm' || engine === 'auto') {
      emit({ phase: 'layers', percent: 25 })
      const svg = await tracePotraceImageData(imgd, potraceOptions)
      if (svg) {
        emit({ phase: 'svg', percent: 95 })
        ctx.postMessage({
          type: 'done',
          svg,
          engineUsed: 'potrace-wasm' satisfies RasterTraceEngine
        })
        return
      }
      if (engine === 'potrace-wasm') {
        throw new Error('potrace-wasm unavailable in this environment')
      }
    }

    /** Auto mode + WASM unavailable → ImageTracer fallback (the legacy path). */
    const svg = runImageTracer(imgd, traceOptions)
    ctx.postMessage({ type: 'done', svg, engineUsed: 'imagetracer' satisfies RasterTraceEngine })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
