/// <reference lib="webworker" />

import ImageTracer from '@/vendor/imagetracer_v1.2.6.js'
import type { RasterTraceImageTracerOptions } from '@/engines/importer/rasterTraceOptions'

export type RasterTraceWorkerRequest = {
  imageData: { buffer: ArrayBuffer; width: number; height: number }
  traceOptions: RasterTraceImageTracerOptions
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

ctx.onmessage = (ev: MessageEvent<RasterTraceWorkerRequest>) => {
  const { buffer, width, height } = ev.data.imageData
  const traceOptions = ev.data.traceOptions ?? 'default'
  const copy = new Uint8ClampedArray(buffer)
  const imgd = new ImageData(copy, width, height)

  globalThis.__imageTracerProgress = (payload: ProgressPayload) => {
    ctx.postMessage({ type: 'progress', ...payload })
  }

  try {
    const svg = ImageTracer.imagedataToSVG(imgd, traceOptions)
    ctx.postMessage({ type: 'done', svg })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    delete globalThis.__imageTracerProgress
  }
}
