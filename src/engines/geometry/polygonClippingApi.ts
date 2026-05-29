/**
 * Boolean clipping façade used by the shape builder, eraser, and any other
 * geometry op that lives on top of polygon math.
 *
 * Two implementations sit behind this module:
 *   1. `polygon-clipping` (pure JS, always available) — the original engine.
 *   2. `js-angusj-clipper` (Clipper2 compiled to WASM) — lazily booted on
 *      app start via {@link primeClipperEngine}.
 *
 * Every export here is **synchronous** to keep the editor's existing call
 * sites unchanged. If Clipper-WASM has finished loading we route the call to
 * it; otherwise we transparently fall back to the JS engine. That means:
 *
 *   - First-ever shape-builder click after a cold start runs on JS (fast
 *     enough for typical shapes; WASM kicks in ~50ms later).
 *   - Every subsequent click uses Clipper2 (≈2–5× faster on real workloads).
 *
 * polygon-clipping’s published ESM bundle only exposes
 * `export { index as default }` (functions live on `.default`).
 * The package typings declare named exports that don’t exist at runtime → Vite error.
 *
 * Resolve the real API from namespace or default.
 */
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import * as pcModule from 'polygon-clipping'
import {
  clipperDifference,
  clipperIntersection,
  clipperReadySync,
  clipperUnion,
  clipperXor,
  primeClipperEngine
} from '@/wasm/clipper/clipperOps'
import { isWasmEnabled } from '@/wasm/wasmFlags'

type Geom = Polygon | MultiPolygon

type PolygonClippingOps = {
  union: (first: Geom, ...more: Geom[]) => MultiPolygon
  intersection: (first: Geom, ...more: Geom[]) => MultiPolygon
  xor: (first: Geom, ...more: Geom[]) => MultiPolygon
  difference: (subject: Geom, ...clips: Geom[]) => MultiPolygon
}

function loadOps(): PolygonClippingOps {
  const mod = pcModule as unknown as PolygonClippingOps & { default?: PolygonClippingOps }
  if (typeof mod.difference === 'function') return mod
  const d = mod.default
  if (d && typeof d.difference === 'function') return d
  throw new Error('polygon-clipping: expected union/intersection/xor/difference API')
}

const jsOps = loadOps()

/**
 * Kick off the WASM boot immediately on import so booleans are fast on first
 * click. Side effect — safe to call repeatedly; `ensureClipperReady` dedupes.
 */
primeClipperEngine()

function pickEngine(): 'wasm' | 'js' {
  if (!isWasmEnabled('boolean')) return 'js'
  return clipperReadySync() ? 'wasm' : 'js'
}

/**
 * Wraps a WASM call in a try/catch — if the WASM engine throws on a weird
 * input we silently fall back to the JS engine for that operation so the user
 * never sees a stack trace from a successful shape-builder click.
 */
function withFallback<T>(
  wasmFn: () => T,
  jsFn: () => T,
  label: string
): T {
  if (pickEngine() === 'wasm') {
    try {
      return wasmFn()
    } catch (err) {
      console.warn(`[polygonClippingApi:${label}] WASM failed, retrying with JS`, err)
    }
  }
  return jsFn()
}

export const union = (first: Geom, ...more: Geom[]): MultiPolygon =>
  withFallback(
    () => clipperUnion(first, ...more),
    () => jsOps.union(first, ...more),
    'union'
  )

export const intersection = (first: Geom, ...more: Geom[]): MultiPolygon =>
  withFallback(
    () => clipperIntersection(first, ...more),
    () => jsOps.intersection(first, ...more),
    'intersection'
  )

export const xor = (first: Geom, ...more: Geom[]): MultiPolygon =>
  withFallback(
    () => clipperXor(first, ...more),
    () => jsOps.xor(first, ...more),
    'xor'
  )

export const difference = (subject: Geom, ...clips: Geom[]): MultiPolygon =>
  withFallback(
    () => clipperDifference(subject, ...clips),
    () => jsOps.difference(subject, ...clips),
    'difference'
  )
