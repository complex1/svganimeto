/**
 * Lazy loader for `@resvg/resvg-wasm`. The wasm payload (~2.5 MB binary, far
 * smaller compressed) only fetches the first time the preview pre-renders
 * frames or the user kicks off a GIF / video export — opening the editor with
 * an empty canvas costs nothing.
 *
 * Loader contract
 * ===============
 *   - `import('@resvg/resvg-wasm')` is dynamic so the resvg JS glue is
 *     code-split into its own chunk and not pulled into the main editor
 *     bundle. The landing page never fetches it.
 *   - `initWasm` mutates a module-level global inside resvg-wasm, so we MUST
 *     guard against running it twice. A cached `Promise<ResvgRuntime | null>`
 *     does double duty:
 *       * de-dupes concurrent calls from preview + export running back-to-back
 *       * never re-throws on second call; failure resolves to `null` so the
 *         façade can transparently fall back to the `<img>` rasterizer.
 */
import type { Resvg, ResvgRenderOptions } from '@resvg/resvg-wasm'

export type ResvgConstructor = typeof Resvg

type ResvgRuntime = {
  Resvg: ResvgConstructor
  RenderOptions: ResvgRenderOptions
}

let cached: Promise<ResvgRuntime | null> | null = null

export function ensureResvgReady(): Promise<ResvgRuntime | null> {
  if (cached) return cached
  cached = (async () => {
    try {
      const mod = await import('@resvg/resvg-wasm')
      /**
       * Vite resolves `?url` for static asset imports. We resolve the URL
       * inside the async loader so the URL string itself is also code-split
       * into the resvg chunk and never lives in the main bundle's import
       * graph.
       */
      const { default: wasmUrl } = await import('@resvg/resvg-wasm/index_bg.wasm?url')
      await mod.initWasm(fetch(wasmUrl))
      return { Resvg: mod.Resvg, RenderOptions: {} as ResvgRenderOptions }
    } catch (err) {
      console.warn('[wasm/resvg] initWasm failed — falling back to <img> rasterizer', err)
      return null
    }
  })()
  return cached
}
