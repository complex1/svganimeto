export type RasterPreprocessOptions = {
  invert: boolean
  /** Hard black/white split using luminance. */
  binarize: boolean
  /** Compared to perceptual luminance 0–255 (pixels ≥ threshold → white, else black). */
  threshold: number
}

export function preprocessImageData(src: ImageData, opts: RasterPreprocessOptions): ImageData {
  if (!opts.invert && !opts.binarize) {
    return src
  }

  const d = src.data
  const out = new Uint8ClampedArray(d.length)
  const t = Math.min(255, Math.max(0, Math.round(opts.threshold)))

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]!
    let g = d[i + 1]!
    let b = d[i + 2]!
    const a = d[i + 3]!

    if (opts.invert) {
      r = 255 - r
      g = 255 - g
      b = 255 - b
    }

    if (opts.binarize) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      const v = y >= t ? 255 : 0
      r = v
      g = v
      b = v
    }

    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = a
  }

  return new ImageData(out, src.width, src.height)
}
