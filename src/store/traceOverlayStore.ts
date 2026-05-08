import { create } from 'zustand'

export type TraceOverlayState = {
  open: boolean
  /** 0–100 while tracing */
  percent: number
  /** User-visible status line */
  statusLine: string
}

export const useTraceOverlayStore = create<TraceOverlayState>(() => ({
  open: false,
  percent: 0,
  statusLine: ''
}))

export function openTraceOverlay(initial?: Partial<Pick<TraceOverlayState, 'percent' | 'statusLine'>>) {
  useTraceOverlayStore.setState({
    open: true,
    percent: initial?.percent ?? 0,
    statusLine: initial?.statusLine ?? 'Starting…'
  })
}

export function setTraceOverlay(patch: Partial<TraceOverlayState>) {
  useTraceOverlayStore.setState(patch)
}

export function closeTraceOverlay() {
  useTraceOverlayStore.setState({ open: false, percent: 0, statusLine: '' })
}
