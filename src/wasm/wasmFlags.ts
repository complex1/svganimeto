/**
 * Single source of truth for which engines are allowed to use their WASM
 * back-end. Every flag is independent so a failure to load one module never
 * disables another. The defaults are "on" because every loader has a graceful
 * JS / DOM fallback when the WASM payload fails to fetch or instantiate (e.g.
 * offline file:// runs, restrictive CSP, ancient browsers).
 *
 * Toggling a flag at runtime takes effect on the *next* call into the relevant
 * façade — already-cached results are not invalidated.
 */
export type WasmFlagId = 'rasterizer' | 'boolean' | 'tracer'

type WasmFlagState = Record<WasmFlagId, boolean>

const DEFAULTS: WasmFlagState = {
  rasterizer: true,
  boolean: true,
  tracer: true
}

const state: WasmFlagState = { ...DEFAULTS }

export function isWasmEnabled(id: WasmFlagId): boolean {
  return state[id]
}

export function setWasmEnabled(id: WasmFlagId, enabled: boolean): void {
  state[id] = enabled
}

export function getAllWasmFlags(): Readonly<WasmFlagState> {
  return { ...state }
}
