import type { RasterTraceImageTracerOptions } from '@/engines/importer/rasterTraceOptions'

/** User-facing raster → vector wizard (maps to ImageTracer options + preprocessing). */
export type RasterVectorMode = 'blackWhite' | 'limitedColor' | 'posterized' | 'centerline' | 'manual'

export type RasterQualityTier = 'tiny' | 'balanced' | 'highQuality'

export type RasterWizardSettings = {
  mode: RasterVectorMode
  quality: RasterQualityTier
  /** 2–64 (ImageTracer `numberofcolors`). */
  colorCount: number
  /** 0 = tight curves, 100 = very smooth / fewer points (drives `ltres` / `qtres`). */
  pathSmoothness: number
  /** 0 = keep tiny regions, 100 = drop more small paths (drives `pathomit`). */
  detailThreshold: number
  /** 0–100 → selective blur before trace (`blurradius` / `blurdelta`). */
  noiseRemoval: number
  vectorizeBinarize: boolean
  /** Luminance threshold when binarize is on. */
  vectorizeThreshold: number
  vectorizeInvert: boolean
}

export const RASTER_WIZARD_STORAGE_KEY = 'svg-motion-raster-wizard-settings-v1'

export const RASTER_PREVIEW_MAX_SIDE = 280

export const defaultRasterWizardSettings = (): RasterWizardSettings => ({
  mode: 'limitedColor',
  quality: 'balanced',
  colorCount: 16,
  pathSmoothness: 38,
  detailThreshold: 42,
  noiseRemoval: 12,
  vectorizeBinarize: false,
  vectorizeThreshold: 128,
  vectorizeInvert: false
})

export function loadRasterWizardSettings(): RasterWizardSettings {
  const d = defaultRasterWizardSettings()
  try {
    const raw = localStorage.getItem(RASTER_WIZARD_STORAGE_KEY)
    if (!raw) return d
    const j = JSON.parse(raw) as Partial<RasterWizardSettings>
    return {
      mode:
        j.mode === 'blackWhite' ||
        j.mode === 'limitedColor' ||
        j.mode === 'posterized' ||
        j.mode === 'centerline' ||
        j.mode === 'manual'
          ? j.mode
          : d.mode,
      quality:
        j.quality === 'tiny' || j.quality === 'balanced' || j.quality === 'highQuality'
          ? j.quality
          : d.quality,
      colorCount: clampN(j.colorCount, 2, 64, d.colorCount),
      pathSmoothness: clampN(j.pathSmoothness, 0, 100, d.pathSmoothness),
      detailThreshold: clampN(j.detailThreshold, 0, 100, d.detailThreshold),
      noiseRemoval: clampN(j.noiseRemoval, 0, 100, d.noiseRemoval),
      vectorizeBinarize: typeof j.vectorizeBinarize === 'boolean' ? j.vectorizeBinarize : d.vectorizeBinarize,
      vectorizeThreshold: clampN(j.vectorizeThreshold, 1, 254, d.vectorizeThreshold),
      vectorizeInvert: typeof j.vectorizeInvert === 'boolean' ? j.vectorizeInvert : d.vectorizeInvert
    }
  } catch {
    return d
  }
}

export function saveRasterWizardSettings(s: RasterWizardSettings): void {
  try {
    localStorage.setItem(RASTER_WIZARD_STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

function clampN(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(hi, Math.max(lo, x))
}

export function wizardMaxSide(quality: RasterQualityTier): number {
  switch (quality) {
    case 'tiny':
      return 512
    case 'balanced':
      return 896
    case 'highQuality':
      return 1100
    default:
      return 896
  }
}

/**
 * Rough estimate of full-resolution SVG UTF-8 size from a downscaled preview trace.
 */
export function estimateSvgBytesFromPreview(previewSvgLength: number, previewMaxSide: number, fullMaxSide: number): number {
  if (previewSvgLength <= 0 || previewMaxSide <= 0) return 0
  const k = Math.max(1.05, fullMaxSide / previewMaxSide)
  return Math.round(previewSvgLength * Math.pow(k, 1.35))
}

function smoothnessToLtres(pathSmoothness: number): number {
  const u = clampN(pathSmoothness, 0, 100, 40) / 100
  return 0.35 + u * u * 7.2
}

function detailToPathomit(detailThreshold: number): number {
  const u = clampN(detailThreshold, 0, 100, 40) / 100
  return Math.round(u * 36)
}

function noiseToBlur(noiseRemoval: number): { blurradius: number; blurdelta: number } {
  const u = clampN(noiseRemoval, 0, 100, 10) / 100
  const blurradius = Math.round(u * 5)
  const blurdelta = blurradius > 0 ? Math.round(16 + u * 70) : 20
  return { blurradius, blurdelta }
}

/** Build merged ImageTracer option object from the wizard UI. */
export function buildTracerOptionsFromWizard(s: RasterWizardSettings): RasterTraceImageTracerOptions {
  const ltres = smoothnessToLtres(s.pathSmoothness)
  const qtres = ltres * 1.08
  const pathomitBase = detailToPathomit(s.detailThreshold)
  const { blurradius, blurdelta } = noiseToBlur(s.noiseRemoval)
  const nColors = clampN(s.colorCount, 2, 64, 16)
  const roundcoords = s.quality === 'highQuality' ? 2 : 1

  const base: Record<string, string | number | boolean | undefined> = {
    ltres,
    qtres,
    pathomit: pathomitBase,
    roundcoords,
    blurradius,
    blurdelta,
    numberofcolors: nColors,
    linefilter: false,
    rightangleenhance: true,
    strokewidth: 1,
    layering: 0,
    viewbox: false,
    desc: false,
    lcpr: 0,
    qcpr: 0,
    corsenabled: false,
    colorsampling: 2,
    mincolorratio: 0,
    colorquantcycles: 3
  }

  switch (s.mode) {
    case 'blackWhite':
      base.colorsampling = 0
      base.numberofcolors = Math.min(8, Math.max(2, nColors))
      base.colorquantcycles = 2
      break
    case 'limitedColor':
      base.colorsampling = 2
      base.numberofcolors = nColors
      break
    case 'posterized':
      base.colorsampling = 0
      base.colorquantcycles = 2
      base.numberofcolors = Math.min(12, Math.max(3, nColors))
      if (base.blurradius === 0) {
        base.blurradius = 3
        base.blurdelta = 42
      }
      break
    case 'centerline':
      /** ImageTracer fills regions — this preset favors stark regions / fewer layers (not a true skeletal centerline). */
      base.colorsampling = 2
      base.numberofcolors = Math.min(6, Math.max(2, nColors))
      base.strokewidth = 0
      base.linefilter = true
      base.pathomit = Math.max(pathomitBase, 10)
      break
    case 'manual':
      break
    default:
      break
  }

  return base
}

export function formatBytes(n: number): string {
  if (n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
