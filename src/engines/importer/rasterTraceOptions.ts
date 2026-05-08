/**
 * Values accepted by vendored ImageTracer after `checkoptions()` merge.
 * @see src/vendor/imagetracer_v1.2.6.js
 */
export type RasterTraceImageTracerOptions =
  | string
  | Record<string, string | number | boolean | undefined>
