/**
 * Façade in front of `@resvg/resvg-wasm` that the export and preview pipelines
 * call instead of the legacy "create a Blob URL, decode through `<img>`, blit
 * with `drawImage`" path. Benefits of going through resvg:
 *
 *   - Native font / filter handling (no DOM at all) keeps rendering identical
 *     to what the SVG export looks like in headless rasterizers like puppeteer.
 *   - Skips the per-frame `Image.decode()` round-trip, which is the dominant
 *     cost in the JS rasterizer for complex scenes.
 *   - Returns RGBA pixels directly — perfect for `OffscreenCanvas` / GPU paths.
 *
 * Every call goes through `ensureResvgReady`; when WASM init failed or the
 * `wasmFlags` toggle is off, this module reports "unavailable" and the caller
 * runs the existing DOM rasterizer instead. There is no in-process partial
 * fallback (e.g. mixed-format frame streams) — that simplifies debugging.
 */
import { ensureResvgReady } from '@/wasm/resvg/loader'
import { isWasmEnabled } from '@/wasm/wasmFlags'

export type ResvgFitTo =
  | { mode: 'original' }
  | { mode: 'width'; value: number }
  | { mode: 'height'; value: number }
  | { mode: 'zoom'; value: number }

export type RasterizeOptions = {
  width: number
  height: number
  /** CSS color drawn behind the SVG. Use `null` for a transparent backdrop. */
  background?: string | null
}

/**
 * Render `svg` to an `ImageBitmap` via resvg-wasm. Returns `null` when WASM is
 * disabled or hasn't finished loading — callers must always provide a JS
 * fallback so the first frame after app start still paints something useful.
 */
export async function rasterizeSvgWithResvg(
  svg: string,
  opts: RasterizeOptions
): Promise<ImageBitmap | null> {
  if (!isWasmEnabled('rasterizer')) return null
  const runtime = await ensureResvgReady()
  if (!runtime) return null

  const { width, height, background } = opts
  try {
    const resvg = new runtime.Resvg(svg, {
      fitTo: { mode: 'width', value: Math.max(1, Math.round(width)) },
      background: background ?? undefined
    })
    const rendered = resvg.render()
    /**
     * `pixels` is an RGBA8 buffer at the *natural* size resvg decided to
     * render. We use the original width so it matches our requested viewport,
     * and pass the actual rendered height back to the caller via the returned
     * bitmap.
     */
    const pxW = rendered.width
    const pxH = rendered.height
    const pixels = rendered.pixels
    /**
     * `ImageData` cannot share a `Uint8Array` view — it needs a
     * `Uint8ClampedArray` backed by an `ArrayBuffer` (not a
     * `SharedArrayBuffer`, which is what the ambient typing for a generic
     * `ArrayBufferLike` could be). We allocate a fresh ArrayBuffer and copy
     * the pixel bytes into it so the WASM heap can free the underlying
     * buffer when `rendered.free()` runs without UB on aliased memory.
     */
    const owned = new ArrayBuffer(pixels.byteLength)
    new Uint8Array(owned).set(pixels)
    const clamped = new Uint8ClampedArray(owned)
    const imgData = new ImageData(clamped, pxW, pxH)
    rendered.free()
    resvg.free()

    /**
     * Resize to the requested target via `createImageBitmap`'s built-in
     * resampler. Passing `resizeQuality: 'high'` keeps text crisp without
     * adding a third manual canvas pass.
     */
    const bmp = await createImageBitmap(imgData, 0, 0, pxW, pxH, {
      resizeWidth: Math.max(1, Math.round(width)),
      resizeHeight: Math.max(1, Math.round(height)),
      resizeQuality: 'high'
    })
    return bmp
  } catch (err) {
    console.warn('[wasm/resvg] render failed — falling back', err)
    return null
  }
}

/**
 * Paint a single frame onto `ctx`, sized to (w × h). Wraps
 * {@link rasterizeSvgWithResvg} and returns `false` when WASM is unavailable
 * so the caller can run its DOM rasterizer.
 */
export async function paintSvgWithResvg(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  svg: string,
  opts: RasterizeOptions
): Promise<boolean> {
  const bmp = await rasterizeSvgWithResvg(svg, opts)
  if (!bmp) return false
  try {
    if (opts.background) {
      ctx.save()
      ;(ctx as CanvasRenderingContext2D).fillStyle = opts.background
      ctx.fillRect(0, 0, opts.width, opts.height)
      ctx.restore()
    } else {
      ctx.clearRect(0, 0, opts.width, opts.height)
    }
    ctx.drawImage(bmp, 0, 0, opts.width, opts.height)
  } finally {
    bmp.close?.()
  }
  return true
}
