/**
 * Bake every frame of the project's animation into an `ImageBitmap` ahead of
 * playback. The preview overlay then blits the pre-rendered frame whose index
 * matches the playhead — no per-frame SVG sample / re-paint, no React tree
 * diff, no DOM filter pipeline cost. This is what gives the user a "video"
 * feel even when the underlying scene is heavy (texture brushes, noise wiggle,
 * many keyframes).
 *
 * Tradeoffs we make deliberately:
 *   1. Memory ceiling — capped at `FRAME_BUDGET` bitmaps; if FPS × duration
 *      would exceed it, the effective FPS is reduced rather than dropping
 *      tail-end frames. Sub-FPS playback is still smooth because the bitmap
 *      cadence drives the playback canvas, not the project FPS.
 *   2. Resolution ceiling — bitmaps render at the project's native size,
 *      clamped to `MAX_SIDE` so 4K canvases don't OOM the GPU. The display
 *      `<canvas>` upscales via CSS, which keeps perfectly crisp at typical
 *      preview zooms.
 *   3. Stale cache — if any of `project`, `tracks`, `duration`, `fps` change,
 *      the existing bitmaps are closed and a new bake starts automatically.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { drawSvgFrameToCanvas } from '@/engines/export/rasterizeAnimation'

/** Max bitmaps we cache at once; safe budget for 1080p frames on integrated GPUs. */
const FRAME_BUDGET = 720
/** Clamp render canvas to this long side (per dimension) so giant projects don't OOM. */
const MAX_SIDE = 1280

export type PreRenderState =
  | { status: 'idle' }
  | { status: 'rendering'; current: number; total: number }
  | {
      status: 'ready'
      frames: ImageBitmap[]
      fps: number
      width: number
      height: number
      durationSec: number
    }
  | { status: 'error'; error: string }

export type PreRenderOptions = {
  project: Project
  tracks: AnimationTrack[]
  durationSec: number
  /** Target FPS — actual cached FPS may be lower if the budget is hit. */
  fps: number
  /** When false, no work happens. Use to defer baking while preview is unmounted. */
  enabled: boolean
}

/**
 * Shrink the render dimensions when the project is larger than {@link MAX_SIDE},
 * preserving aspect ratio. We always emit ≥1×1.
 */
function fitRenderSize(w: number, h: number) {
  const max = Math.max(w, h, 1)
  const scale = Math.min(1, MAX_SIDE / max)
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale))
  }
}

/** Yield to the browser so the progress UI can paint between frames. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export function usePreRenderedFrames(opts: PreRenderOptions): PreRenderState {
  const { project, tracks, durationSec, fps, enabled } = opts
  const [state, setState] = useState<PreRenderState>({ status: 'idle' })

  /**
   * Cancellation handle: a render run checks `cancelledRef.current` before
   * mutating state or pushing more frames. Re-rendering on input change
   * triggers cancel-then-restart.
   */
  const cancelTokenRef = useRef<{ cancelled: boolean } | null>(null)
  const framesRef = useRef<ImageBitmap[]>([])

  /**
   * `bakeKey` deliberately excludes objects that don't affect the visual frame
   * (selection, mode flags) so opening Preview after a no-op edit doesn't pay
   * the bake cost twice.
   */
  const bakeKey = useMemo(
    () =>
      JSON.stringify({
        eCount: project.elements.length,
        gCount: project.gradients?.length ?? 0,
        sCount: project.symbols?.length ?? 0,
        w: project.width,
        h: project.height,
        n: project.name,
        durationSec,
        fps,
        /**
         * Hash-ish digest of element ids + their attrs/transform/tracks. Using
         * `JSON.stringify(project.elements)` directly is too heavy for large
         * scenes; an id + length hint is enough to detect "this is the same
         * scene I baked last time" in the common case (opening preview twice
         * without edits).
         */
        sig: project.elements.map((e) => `${e.id}:${e.children?.length ?? 0}`).join('|'),
        trackSig: tracks
          .map((t) => `${t.elementId}:${t.property}:${t.keyframes.length}`)
          .join('|')
      }),
    [project, tracks, durationSec, fps]
  )

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' })
      return
    }
    if (durationSec <= 0) {
      setState({ status: 'error', error: 'Project duration is 0 — nothing to render.' })
      return
    }

    /** Begin a new run; flag any in-flight run to stop after its current frame. */
    if (cancelTokenRef.current) cancelTokenRef.current.cancelled = true
    const token = { cancelled: false }
    cancelTokenRef.current = token

    /** Release any previously-cached bitmaps (GPU-backed; not GC'd implicitly). */
    for (const bmp of framesRef.current) bmp.close?.()
    framesRef.current = []

    const wantedFrames = Math.max(1, Math.ceil(durationSec * fps))
    const effectiveTotal = Math.min(FRAME_BUDGET, wantedFrames)
    /** If we had to cap, derive the actual FPS so playback math stays correct. */
    const effectiveFps = effectiveTotal / durationSec
    const { width, height } = fitRenderSize(project.width, project.height)

    setState({ status: 'rendering', current: 0, total: effectiveTotal })

    void (async () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: false })
      if (!ctx) {
        setState({ status: 'error', error: 'Canvas 2D context unavailable.' })
        return
      }

      try {
        for (let i = 0; i < effectiveTotal; i += 1) {
          if (token.cancelled) return
          /**
           * Sample at the centre of each frame's time-slice rather than its
           * start so the first/last frames feel temporally symmetrical and
           * looping doesn't double-stamp the boundary frame.
           */
          const tSec = Math.min(durationSec, (i + 0.5) / effectiveFps)
          await drawSvgFrameToCanvas(ctx, project, tracks, tSec, width, height)
          if (token.cancelled) return
          const bmp = await createImageBitmap(canvas)
          if (token.cancelled) {
            bmp.close?.()
            return
          }
          framesRef.current.push(bmp)
          setState({ status: 'rendering', current: i + 1, total: effectiveTotal })
          /** Yield so progress UI updates and the user can cancel by closing preview. */
          await nextPaint()
        }
        if (token.cancelled) return
        setState({
          status: 'ready',
          frames: framesRef.current,
          fps: effectiveFps,
          width,
          height,
          durationSec
        })
      } catch (err) {
        if (token.cancelled) return
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Frame bake failed.'
        })
      }
    })()

    /** Cleanup on input change / unmount: cancel run + free bitmaps. */
    return () => {
      token.cancelled = true
      for (const bmp of framesRef.current) bmp.close?.()
      framesRef.current = []
    }
    /** Re-run when anything affecting the baked frames changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bakeKey])

  /** Dispose on full unmount in case the cleanup above missed (StrictMode etc.). */
  useEffect(() => {
    return () => {
      if (cancelTokenRef.current) cancelTokenRef.current.cancelled = true
      for (const bmp of framesRef.current) bmp.close?.()
      framesRef.current = []
    }
  }, [])

  return state
}

/**
 * Helper for the playback canvas: given the playhead in seconds, pick the
 * right cached frame. Wraps when looping so `currentTime` past `durationSec`
 * still resolves cleanly during the brief window before the playback loop
 * normalises it.
 */
export function pickFrameIndex(currentSec: number, fps: number, totalFrames: number): number {
  if (totalFrames <= 0) return 0
  if (!Number.isFinite(currentSec)) return 0
  const idx = Math.floor(currentSec * fps)
  if (idx < 0) return 0
  if (idx >= totalFrames) return totalFrames - 1
  return idx
}
