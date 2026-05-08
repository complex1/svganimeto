export type GradientStop = {
  offset: number
  color: string
  opacity?: number
}

export type LinearGradientDef = {
  id: string
  kind: 'linear'
  x1: number
  y1: number
  x2: number
  y2: number
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  stops: GradientStop[]
}

export type RadialGradientDef = {
  id: string
  kind: 'radial'
  cx: number
  cy: number
  r: number
  fx?: number
  fy?: number
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  stops: GradientStop[]
}

export type GradientDef = LinearGradientDef | RadialGradientDef
