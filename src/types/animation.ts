export type EasingId = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

export type Keyframe = {
  id: string
  time: number
  value: number
  easing?: EasingId
}

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'skewX'
  | 'skewY'

export type AnimationTrack = {
  id: string
  elementId: string
  property: AnimatableProperty
  keyframes: Keyframe[]
}
