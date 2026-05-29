/**
 * Loader for the Clipper2 / js-angusj-clipper WASM module. Same lazy +
 * idempotent contract as the resvg loader:
 *
 *   - First call boots the WASM module (~250 KB binary, inlined as base64 by
 *     Emscripten — split into a separate chunk via the dynamic import below).
 *   - Subsequent calls return the cached promise.
 *   - Boot failure resolves to `null` (callers route to polygon-clipping JS).
 *
 * We deliberately request `WasmWithAsmJsFallback` so older browsers without
 * `WebAssembly` (very rare now) still get a usable engine, but normal
 * environments take the real WASM path.
 */
import type { ClipperLibWrapper } from 'js-angusj-clipper/web'

let cached: Promise<ClipperLibWrapper | null> | null = null

export function ensureClipperReady(): Promise<ClipperLibWrapper | null> {
  if (cached) return cached
  cached = (async () => {
    try {
      const mod = await import('js-angusj-clipper/web')
      const inst = await mod.loadNativeClipperLibInstanceAsync(
        mod.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
      )
      return inst
    } catch (err) {
      console.warn(
        '[wasm/clipper] failed to load Clipper2 WASM — falling back to polygon-clipping JS',
        err
      )
      return null
    }
  })()
  return cached
}
