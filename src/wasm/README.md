# src/wasm

WebAssembly back-ends for the editor's three heaviest hot paths. Each engine
follows the same lazy + fallback contract:

1. `loader.ts` exports `ensure<Engine>Ready(): Promise<EngineInstance | null>`.
   - First call kicks off the WASM fetch + instantiate.
   - Subsequent calls return the cached promise (idempotent, safe to call from
     any number of components).
   - Returns `null` (rather than throwing) when the runtime cannot host the
     module — callers always have a working JS fallback.
2. The façade file (e.g. `rasterizer.ts`, `clipperOps.ts`, `tracer.ts`) exposes
   a small, problem-shaped API the rest of the codebase uses. It tries the
   WASM path first when the `wasmFlags.ts` toggle is on; otherwise it routes
   to the legacy JS implementation.
3. `wasmFlags.ts` is the single source of truth for run-time opt-out. Useful
   for debugging regressions ("turn off WASM and see if the bug persists").

Bundle impact (gzipped, rough):

| Engine     | Package                | WASM payload | Loaded when…              |
| ---------- | ---------------------- | ------------ | ------------------------- |
| Rasterizer | `@resvg/resvg-wasm`    | ~600 KB      | first preview / export    |
| Boolean    | `js-angusj-clipper`    | ~250 KB      | first shape-builder op    |
| Tracer     | `esm-potrace-wasm`     | ~50 KB       | first raster trace import |

All payloads are lazy — the landing page and the empty editor pay nothing.
