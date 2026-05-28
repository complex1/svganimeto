export type VectorElementType =
  | 'group'
  | 'path'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'image'
  | 'polygon'
  | 'polyline'
  /** Reference to `project.symbols[].template`; rendered as a clone of the master. */
  | 'symbolInstance'

export type PathPointMode = 'corner' | 'symmetric' | 'asymmetric' | 'disconnected'

export type PathPoint = {
  x: number
  y: number
  inX?: number
  inY?: number
  outX?: number
  outY?: number
  mode?: PathPointMode
}

export type VectorAttrValue = string | number | boolean | PathPoint[]

export type Transform = {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  skewX: number
  skewY: number
  opacity: number
}

export const defaultTransform = (): Transform => ({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  skewX: 0,
  skewY: 0,
  opacity: 1
})

export type VectorElement = {
  id: string
  name: string
  type: VectorElementType
  attrs: Record<string, VectorAttrValue>
  transform: Transform
  children?: VectorElement[]
  locked?: boolean
  visible?: boolean
}

export type Asset = {
  id: string
  name: string
  kind: 'icon' | 'gradient' | 'preset' | 'symbol' | 'other'
  data?: unknown
}

/** Reusable component master (single root element tree). */
export type SymbolDefinition = {
  id: string
  name: string
  /** Root group or shape; transforms at root are relative to each instance. */
  template: VectorElement
  /**
   * Optional self-contained timeline that drives every instance on the main canvas.
   * Track `elementId`s reference ids inside `template`. When `loop` is true (default)
   * the instance plays the symbol's clip on a loop independent of the project's
   * playhead — useful for spinners, idle motions, blinking icons, etc.
   */
  animation?: {
    tracks: import('./animation').AnimationTrack[]
    duration: number
    loop?: boolean
  }
}

export type Project = {
  id: string
  name: string
  width: number
  height: number
  elements: VectorElement[]
  assets: Asset[]
  gradients: import('./gradient').GradientDef[]
  symbols: SymbolDefinition[]
}

export type SerializedProject = Project & {
  version: 1
  animations: import('./animation').AnimationTrack[]
}
