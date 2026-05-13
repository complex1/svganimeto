import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { Project } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { exportStillFrameSvg } from '@/engines/export/exportSvg'

export type RasterizeProgress = { current: number; total: number }

function scaleDimensions(
  projectW: number,
  projectH: number,
  maxSide: number
): { w: number; h: number; scale: number } {
  const max = Math.max(projectW, projectH, 1)
  const scale = Math.min(1, maxSide / max)
  return {
    w: Math.max(1, Math.round(projectW * scale)),
    h: Math.max(1, Math.round(projectH * scale)),
    scale
  }
}

/** Rasterize one frame (still SVG at `timeSec`) into the canvas. */
export async function drawSvgFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  project: Project,
  tracks: AnimationTrack[],
  timeSec: number,
  w: number,
  h: number
): Promise<void> {
  const svg = exportStillFrameSvg(project, tracks, timeSec)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not decode SVG for export frame'))
      img.src = url
    })
    ctx.fillStyle = '#f4f5f7'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const MAX_GIF_FRAMES = 300

export async function exportAnimatedGifBytes(
  project: Project,
  tracks: AnimationTrack[],
  durationSec: number,
  options: {
    fps: number
    maxSide: number
    loop: boolean
    onProgress?: (p: RasterizeProgress) => void
  }
): Promise<Uint8Array> {
  const fps = Math.max(1, Math.min(30, options.fps))
  const { w, h } = scaleDimensions(project.width, project.height, Math.max(64, options.maxSide))
  const totalFrames = Math.min(MAX_GIF_FRAMES, Math.max(1, Math.ceil(durationSec * fps)))
  const dt = durationSec / totalFrames
  const delayMs = Math.max(20, Math.round(1000 / fps))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context is not available')

  const gif = GIFEncoder()
  let globalPalette: ReturnType<typeof quantize> | null = null

  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min(durationSec, i * dt)
    await drawSvgFrameToCanvas(ctx, project, tracks, t, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    if (i === 0) {
      globalPalette = quantize(data, 256)
    }
    const index = applyPalette(data, globalPalette!, 'rgb565')
    gif.writeFrame(index, w, h, {
      palette: globalPalette!,
      delay: delayMs,
      ...(i === 0 ? { repeat: options.loop ? 0 : -1 } : {})
    })
    options.onProgress?.({ current: i + 1, total: totalFrames })
  }

  gif.finish()
  return gif.bytes()
}

function pickVideoMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
    { mime: 'video/mp4', ext: 'mp4' }
  ]
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      return c
    }
  }
  return { mime: 'video/webm', ext: 'webm' }
}

const MAX_VIDEO_FRAMES = 600

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requestCanvasFrame(stream: MediaStream): void {
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  track?.requestFrame?.()
}

/**
 * Records the animation by painting each sampled frame to a canvas stream.
 * Browsers typically emit WebM (VP8/VP9); true H.264 MP4 is uncommon from MediaRecorder.
 */
export async function exportAnimatedVideoBlob(
  project: Project,
  tracks: AnimationTrack[],
  durationSec: number,
  options: {
    fps: number
    maxSide: number
    loop: boolean
    onProgress?: (p: RasterizeProgress) => void
  }
): Promise<{ blob: Blob; mime: string; ext: string }> {
  const fps = Math.max(1, Math.min(60, options.fps))
  const { w, h } = scaleDimensions(project.width, project.height, Math.max(64, options.maxSide))
  const cycles = options.loop ? 2 : 1
  const requestedFramesPerCycle = Math.max(1, Math.ceil(durationSec * fps))
  const framesPerCycle = Math.min(
    Math.max(1, Math.floor(MAX_VIDEO_FRAMES / cycles)),
    requestedFramesPerCycle
  )
  const totalFrames = framesPerCycle * cycles
  const dt = durationSec / framesPerCycle
  const frameDurationMs = Math.max(1, (durationSec * 1000) / framesPerCycle)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is not available')

  const { mime, ext } = pickVideoMime()
  let stream = canvas.captureStream(0)
  let manualCapture = Boolean(
    stream.getVideoTracks()[0] && 'requestFrame' in stream.getVideoTracks()[0]
  )
  if (!manualCapture) {
    stream = canvas.captureStream(fps)
  }
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 8_000_000
    })
  } catch {
    recorder = new MediaRecorder(stream)
  }
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  await new Promise<void>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('MediaRecorder failed'))
    recorder.onstop = () => resolve()
    recorder.start(250)

    void (async () => {
      try {
        for (let i = 0; i < totalFrames; i++) {
          const frameInCycle = i % framesPerCycle
          const t =
            frameInCycle >= framesPerCycle - 1
              ? durationSec
              : Math.min(durationSec, frameInCycle * dt)
          await drawSvgFrameToCanvas(ctx, project, tracks, t, w, h)
          if (manualCapture) {
            requestCanvasFrame(stream)
          }
          options.onProgress?.({ current: i + 1, total: totalFrames })
          await waitMs(manualCapture ? frameDurationMs : Math.max(frameDurationMs, 1000 / fps))
        }
        await waitMs(250)
        recorder.stop()
      } catch (e) {
        try {
          recorder.stop()
        } catch {
          /* ignore */
        }
        reject(e)
      }
    })()
  })

  const blob = new Blob(chunks, { type: mime.split(';')[0] })
  return { blob, mime, ext }
}
