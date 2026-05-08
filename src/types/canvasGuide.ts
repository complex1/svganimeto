/** Non-exported canvas construction overlays (guides only). */
export type CanvasGuideType =
  | 'none'
  | 'square'
  | 'isometric'
  | 'perspective1'
  | 'perspective2'
  | 'perspective3'
  | 'fisheye'

/** Vanishing point / center in normalized artboard coords (may be outside 0–1 for off-canvas VPs). */
export type GuidePointNorm = { nx: number; ny: number }
