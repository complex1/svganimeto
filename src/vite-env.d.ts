/// <reference types="vite/client" />

declare module '@/vendor/imagetracer_v1.2.6.js' {
  const ImageTracer: {
    imagedataToSVG: (imgd: ImageData, options?: Record<string, unknown> | string) => string
  }
  export default ImageTracer
}

declare global {
  /** Optional hook patched into vendored ImageTracer (see `rasterTrace.ts`). */
  var __imageTracerProgress:
    | ((payload: {
        phase: string
        percent: number
        layer?: number
        totalLayers?: number
      }) => void)
    | undefined
}

export {}
