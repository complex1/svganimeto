/**
 * Façade around `esm-potrace-wasm`. Used by the raster-trace worker as a
 * faster, higher-quality engine for monochrome / binary tracing — the legacy
 * vendored `ImageTracer.js` stays in place as the colour-mode fallback and as
 * the safety net if WASM init fails.
 *
 * The public API intentionally mirrors what ImageTracer returns: a single SVG
 * string. The worker doesn't care which engine produced it.
 */
import { ensurePotraceReady } from '@/wasm/potrace/loader'
import { isWasmEnabled } from '@/wasm/wasmFlags'

export type PotraceTurnPolicy = 'black' | 'white' | 'left' | 'right' | 'minority' | 'majority'

export type PotraceOptions = {
  /** Turdsize — suppresses speckles smaller than this many pixels. */
  turdSize?: number
  turnPolicy?: PotraceTurnPolicy
  /** Smoothness, 0..1.3 — higher is smoother. */
  alphaMax?: number
  /** Curve optimisation tolerance. */
  optTolerance?: number
  /** Threshold for grayscale → binary, 0..255. */
  threshold?: number
  /** Background colour for the rendered SVG (`'transparent'` to leave it bare). */
  background?: string
  /** Stroke / fill colour for the traced layer. */
  color?: string
  /** Number of colour posterisation steps (1 = binary). */
  steps?: number
}

/**
 * Trace `imgd` (RGBA8 ImageData) with the potrace WASM module and return the
 * resulting SVG string. Returns `null` when WASM is disabled or hasn't loaded,
 * letting the caller fall through to ImageTracer.
 */
export async function tracePotraceImageData(
  imgd: ImageData,
  opts: PotraceOptions = {}
): Promise<string | null> {
  if (!isWasmEnabled('tracer')) return null
  const runtime = await ensurePotraceReady()
  if (!runtime) return null

  try {
    /**
     * potrace-wasm wants an `ImageBitmapSource`. An ImageData satisfies that
     * directly in modern browsers, but to be safe across electron versions
     * we round-trip through `createImageBitmap` which accepts ImageData
     * everywhere.
     */
    const bmp = await createImageBitmap(imgd)
    try {
      const svg = await runtime.potrace(bmp, {
        turdsize: opts.turdSize ?? 2,
        turnpolicy: opts.turnPolicy ?? 'minority',
        alphamax: opts.alphaMax ?? 1,
        opttolerance: opts.optTolerance ?? 0.2,
        threshold: opts.threshold ?? -1,
        background: opts.background ?? 'transparent',
        color: opts.color ?? 'auto',
        steps: opts.steps ?? 1,
        extractcolors: opts.steps && opts.steps > 1 ? true : false
      })
      return svg
    } finally {
      bmp.close?.()
    }
  } catch (err) {
    console.warn('[wasm/potrace] trace failed — falling back to ImageTracer', err)
    return null
  }
}
