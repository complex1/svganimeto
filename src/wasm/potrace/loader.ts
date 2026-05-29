/**
 * Loader for `esm-potrace-wasm`. Same pattern as the other WASM loaders:
 *   - First call dynamically imports the package and initialises the WASM
 *     module (~50 KB compressed payload).
 *   - Cached promise dedupes concurrent calls.
 *   - Failure resolves to `null` and the caller falls back to ImageTracer.
 *
 * The dynamic `import('esm-potrace-wasm')` keeps the tracer JS glue out of
 * the worker's "tracing entry-point" bundle until tracing actually starts —
 * useful when the worker is spun up speculatively or imported for type
 * inspection only.
 */
type PotraceModule = {
  init?: () => Promise<void>
  potrace: (image: ImageBitmapSource, options: Record<string, unknown>) => Promise<string>
}

let cached: Promise<PotraceModule | null> | null = null

export function ensurePotraceReady(): Promise<PotraceModule | null> {
  if (cached) return cached
  cached = (async () => {
    try {
      const loaded = (await import('esm-potrace-wasm')) as unknown as PotraceModule
      if (typeof loaded.init === 'function') {
        /**
         * `esm-potrace-wasm` 0.4 exposes an `init()` for environments where
         * the bundler can't auto-fetch the wasm — calling it explicitly is a
         * no-op when not needed and a fix when it is.
         */
        await loaded.init()
      }
      return loaded
    } catch (err) {
      console.warn('[wasm/potrace] init failed — ImageTracer fallback will be used', err)
      return null
    }
  })()
  return cached
}
