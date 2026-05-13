import gsap from 'gsap'
import type { AnimatableProperty, AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import type { Transform, VectorAttrValue, VectorElement } from '@/types/document'
import { flattenForLayers } from '@/engines/document/tree'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { mergeAttrsFromTracks, packedRgbToHex } from '@/engines/animation/attrAnimation'
import { morphPathDApprox } from '@/engines/geometry/svgPathMotion'

const TRANSFORM_PROPS = new Set<AnimatableProperty>([
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'skewX',
  'skewY',
  'opacity'
])

function sortKfs(kfs: Keyframe[]): Keyframe[] {
  return [...kfs].sort((a, b) => a.time - b.time)
}

function easeIdToGsap(easing: EasingId | undefined): string {
  switch (easing ?? 'linear') {
    case 'linear':
      return 'none'
    case 'easeIn':
      return 'power2.in'
    case 'easeOut':
      return 'power2.out'
    case 'easeInOut':
      return 'power2.inOut'
    case 'easeInCubic':
      return 'power3.in'
    case 'easeOutCubic':
      return 'power3.out'
    case 'easeInOutCubic':
      return 'power3.inOut'
    case 'easeInBack':
      return 'back.in(1.70158)'
    case 'easeOutBack':
      return 'back.out(1.70158)'
    case 'easeInOutBack':
      return 'back.inOut(1.70158)'
    default:
      return 'none'
  }
}

let masterTl: gsap.core.Timeline | null = null
const transformProxies = new Map<string, Transform>()
const attrProxies = new Map<string, Record<string, unknown>>()

function getOrCreateAttrProxy(elementId: string): Record<string, unknown> {
  let p = attrProxies.get(elementId)
  if (!p) {
    p = {}
    attrProxies.set(elementId, p)
  }
  return p
}

export function disposeGsapTrackTimeline() {
  masterTl?.kill()
  masterTl = null
  transformProxies.clear()
  attrProxies.clear()
}

function maxKeyframeTime(tracks: AnimationTrack[]): number {
  let m = 0
  for (const tr of tracks) {
    for (const k of tr.keyframes) m = Math.max(m, k.time)
  }
  return m
}

function findEl(roots: VectorElement[], id: string): VectorElement | undefined {
  return flattenForLayers(roots).find((x) => x.el.id === id)?.el
}

function addTransformSegments(
  tl: gsap.core.Timeline,
  track: AnimationTrack,
  roots: VectorElement[],
  tracks: AnimationTrack[]
) {
  if (!TRANSFORM_PROPS.has(track.property)) return
  const el = findEl(roots, track.elementId)
  if (!el) return
  let proxy = transformProxies.get(track.elementId)
  if (!proxy) {
    proxy = mergeTransformFromTracks(el.transform, track.elementId, tracks, 0)
    transformProxies.set(track.elementId, proxy)
  }
  const prop = track.property as keyof Transform
  const kfs = sortKfs(track.keyframes).filter((k) => Number.isFinite(k.value))
  if (kfs.length === 0) return
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    const span = b.time - a.time
    const ease = easeIdToGsap(b.easing ?? a.easing)
    if (span <= 1e-9) {
      tl.set(proxy, { [prop]: b.value } as Partial<Transform>, a.time)
    } else {
      tl.fromTo(
        proxy,
        { [prop]: a.value } as Partial<Transform>,
        { [prop]: b.value, duration: span, ease } as gsap.TweenVars,
        a.time
      )
    }
  }
}

function addNumericAttrSegments(
  tl: gsap.core.Timeline,
  track: AnimationTrack,
  toValue: (v: number) => Record<string, unknown>
) {
  const kfs = sortKfs(track.keyframes).filter((k) => Number.isFinite(k.value))
  if (kfs.length === 0) return
  const proxy = getOrCreateAttrProxy(track.elementId)
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    const span = b.time - a.time
    const ease = easeIdToGsap(b.easing ?? a.easing)
    const fromObj = toValue(a.value)
    const toObj = toValue(b.value)
    if (span <= 1e-9) {
      tl.set(proxy, toObj, a.time)
    } else {
      tl.fromTo(proxy, fromObj, { ...toObj, duration: span, ease } as gsap.TweenVars, a.time)
    }
  }
}

function addColorSegments(tl: gsap.core.Timeline, track: AnimationTrack, packedKey: string, outKey: string) {
  const kfs = sortKfs(track.keyframes).filter((k) => Number.isFinite(k.value))
  if (kfs.length === 0) return
  const proxy = getOrCreateAttrProxy(track.elementId)
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    const span = b.time - a.time
    const ease = easeIdToGsap(b.easing ?? a.easing)
    const from = { [packedKey]: a.value }
    const toVars: gsap.TweenVars = {
      [packedKey]: b.value,
      duration: span,
      ease,
      onUpdate() {
        const raw = proxy[packedKey]
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (Number.isFinite(n)) {
          proxy[outKey] = packedRgbToHex(n)
        }
      }
    }
    if (span <= 1e-9) {
      proxy[packedKey] = b.value
      proxy[outKey] = packedRgbToHex(b.value)
    } else {
      tl.fromTo(proxy, from, toVars, a.time)
    }
  }
}

function addPathDMorphSegments(tl: gsap.core.Timeline, track: AnimationTrack) {
  if (track.property !== 'pathD') return
  const kfs = sortKfs(track.keyframes).filter((k) => typeof k.valueText === 'string')
  if (kfs.length < 2) return
  const proxy = getOrCreateAttrProxy(track.elementId)
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    const d0 = a.valueText ?? ''
    const d1 = b.valueText ?? ''
    const span = b.time - a.time
    const ease = easeIdToGsap(b.easing ?? a.easing)
    const o = { _p: 0 }
    if (span <= 1e-9) {
      const morphed = morphPathDApprox(d0, d1, 1) ?? d1
      tl.set(proxy, { d: morphed }, a.time)
    } else {
      tl.fromTo(
        o,
        { _p: 0 },
        {
          _p: 1,
          duration: span,
          ease,
          onUpdate() {
            const morphed = morphPathDApprox(d0, d1, o._p)
            proxy.d = morphed ?? (o._p < 0.5 ? d0 : d1)
          }
        },
        a.time
      )
    }
  }
}

function addTextHoldSegments(tl: gsap.core.Timeline, track: AnimationTrack, attrKey: string) {
  const kfs = sortKfs(track.keyframes).filter((k) => typeof k.valueText === 'string')
  if (kfs.length === 0) return
  const proxy = getOrCreateAttrProxy(track.elementId)
  for (const k of kfs) {
    tl.set(proxy, { [attrKey]: k.valueText }, k.time)
  }
}

/**
 * Rebuilds a paused master timeline from `tracks` + document tree.
 * Call when tracks, elements, or duration change while the GSAP canvas driver may be active.
 */
export function rebuildGsapTrackTimeline(roots: VectorElement[], tracks: AnimationTrack[], duration: number) {
  disposeGsapTrackTimeline()
  if (tracks.length === 0) return

  const tl = gsap.timeline({ paused: true })
  masterTl = tl

  const elementIds = new Set<string>()
  for (const tr of tracks) elementIds.add(tr.elementId)

  for (const id of elementIds) {
    const el = findEl(roots, id)
    if (!el) continue
    const t0 = mergeTransformFromTracks(el.transform, id, tracks, 0)
    let hasTransformTrack = false
    for (const tr of tracks) {
      if (tr.elementId === id && TRANSFORM_PROPS.has(tr.property) && tr.keyframes.length > 0) {
        hasTransformTrack = true
        break
      }
    }
    if (hasTransformTrack) transformProxies.set(id, { ...t0 })
  }

  for (const track of tracks) {
    if (track.keyframes.length === 0) continue
    if (TRANSFORM_PROPS.has(track.property)) {
      addTransformSegments(tl, track, roots, tracks)
      continue
    }
    switch (track.property) {
      case 'fill':
        addColorSegments(tl, track, '__gsap_fillPacked', 'fill')
        break
      case 'stroke':
        addColorSegments(tl, track, '__gsap_strokePacked', 'stroke')
        break
      case 'fxShadowColor':
        addColorSegments(tl, track, '__gsap_shadowPacked', '__fxShadowColor')
        break
      case 'strokeWidth':
        addNumericAttrSegments(tl, track, (v) => ({ 'stroke-width': v }))
        break
      case 'fxBlur':
        addNumericAttrSegments(tl, track, (v) => ({ __fxBlur: v }))
        break
      case 'fxShadowX':
        addNumericAttrSegments(tl, track, (v) => ({ __fxShadowX: v }))
        break
      case 'fxShadowY':
        addNumericAttrSegments(tl, track, (v) => ({ __fxShadowY: v }))
        break
      case 'fxShadowBlur':
        addNumericAttrSegments(tl, track, (v) => ({ __fxShadowBlur: v }))
        break
      case 'pathD':
        addPathDMorphSegments(tl, track)
        break
      case 'mask':
        addTextHoldSegments(tl, track, 'mask')
        break
      case 'clipPath':
        addTextHoldSegments(tl, track, 'clip-path')
        break
      case 'svgFilter':
        addTextHoldSegments(tl, track, 'filter')
        break
      default:
        break
    }
  }

  const end = Math.max(duration, maxKeyframeTime(tracks), 1e-3)
  tl.duration(end)
}

/** Move the compiled timeline playhead (seconds). */
export function syncGsapTrackTimelineTime(timeSec: number) {
  if (!masterTl) return
  const d = masterTl.duration()
  const t = Math.min(Math.max(0, timeSec), d)
  masterTl.time(t)
}

export function readGsapDriverTransform(
  elementId: string,
  base: Transform,
  _roots: VectorElement[],
  tracks: AnimationTrack[],
  _timeSec: number
): Transform {
  const p = transformProxies.get(elementId)
  if (!p) return mergeTransformFromTracks(base, elementId, tracks, _timeSec)
  return {
    x: p.x,
    y: p.y,
    scaleX: p.scaleX,
    scaleY: p.scaleY,
    rotation: p.rotation,
    skewX: p.skewX,
    skewY: p.skewY,
    opacity: p.opacity
  }
}

export function readGsapDriverAttrs(
  el: VectorElement,
  tracks: AnimationTrack[],
  timeSec: number
): Record<string, VectorAttrValue> {
  const merged = mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<string, VectorAttrValue>
  const proxy = attrProxies.get(el.id)
  if (!proxy) return merged
  const out: Record<string, VectorAttrValue> = { ...merged }
  for (const [k, v] of Object.entries(proxy)) {
    if (k.startsWith('__gsap')) continue
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/**
 * Classic merge vs GSAP-compiled sampling.
 * When `useGsapDriver` is true, call `syncGsapTrackTimelineTime(timeSec)` once per frame before reading.
 */
export function sampleMergedTransformForElement(
  el: VectorElement,
  roots: VectorElement[],
  tracks: AnimationTrack[],
  timeSec: number,
  useGsapDriver: boolean
): Transform {
  if (!useGsapDriver) return mergeTransformFromTracks(el.transform, el.id, tracks, timeSec)
  return readGsapDriverTransform(el.id, el.transform, roots, tracks, timeSec)
}

export function sampleMergedAttrsForElement(
  el: VectorElement,
  tracks: AnimationTrack[],
  timeSec: number,
  useGsapDriver: boolean
): Record<string, VectorAttrValue> {
  if (!useGsapDriver) return mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<string, VectorAttrValue>
  return readGsapDriverAttrs(el, tracks, timeSec)
}

export type GsapParitySample = {
  time: number
  elementId: string
  kind: 'transform' | 'attrs'
  detail: string
}

export type GsapParityReport = {
  ok: boolean
  maxTransformDelta: number
  maxAttrsMismatch: number
  samples: GsapParitySample[]
}

const TRANSFORM_KEYS: (keyof Transform)[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'skewX',
  'skewY',
  'opacity'
]

function transformMaxDelta(a: Transform, b: Transform): number {
  let m = 0
  for (const k of TRANSFORM_KEYS) {
    m = Math.max(m, Math.abs(a[k] - b[k]))
  }
  return m
}

/**
 * Random scrub comparison between classic sampling and the compiled GSAP timeline.
 * Run in the dev panel only; can be expensive on large projects.
 */
export function runGsapSamplingParityCheck(
  roots: VectorElement[],
  tracks: AnimationTrack[],
  duration: number,
  sampleCount: number
): GsapParityReport {
  const samples: GsapParitySample[] = []
  let maxTransformDelta = 0
  let maxAttrsMismatch = 0

  rebuildGsapTrackTimeline(roots, tracks, duration)
  const ids = [...new Set(tracks.map((t) => t.elementId))]

  for (let s = 0; s < sampleCount; s++) {
    const timeSec = Math.random() * Math.max(duration, 0.001)
    syncGsapTrackTimelineTime(timeSec)

    for (const id of ids) {
      const el = findEl(roots, id)
      if (!el) continue
      const refT = mergeTransformFromTracks(el.transform, id, tracks, timeSec)
      const gsapT = readGsapDriverTransform(id, el.transform, roots, tracks, timeSec)
      const td = transformMaxDelta(refT, gsapT)
      if (td > 1e-4) {
        maxTransformDelta = Math.max(maxTransformDelta, td)
        samples.push({ time: timeSec, elementId: id, kind: 'transform', detail: `Δ≤${td.toExponential(3)}` })
      }

      const refA = mergeAttrsFromTracks(el.attrs, id, tracks, timeSec) as Record<string, VectorAttrValue>
      const gsapA = readGsapDriverAttrs(el, tracks, timeSec)
      const skipKeys = new Set(['__pathPoints', '__pathClosed', '__textContent', '__symbolId'])
      const keySet = new Set([...Object.keys(refA), ...Object.keys(gsapA)])
      const interesting = [...keySet].filter(
        (k) => !skipKeys.has(k) && (!k.startsWith('__') || k.startsWith('__fx'))
      )
      let mismatch = 0
      for (const k of interesting) {
        if (refA[k] !== gsapA[k]) {
          if (
            typeof refA[k] === 'number' &&
            typeof gsapA[k] === 'number' &&
            Math.abs(Number(refA[k]) - Number(gsapA[k])) < 1e-3
          )
            continue
          mismatch++
        }
      }
      if (mismatch > 0) {
        maxAttrsMismatch = Math.max(maxAttrsMismatch, mismatch)
        samples.push({
          time: timeSec,
          elementId: id,
          kind: 'attrs',
          detail: `${mismatch} key(s) differ`
        })
      }
    }
  }

  rebuildGsapTrackTimeline(roots, tracks, duration)

  const ok = maxTransformDelta < 1e-3 && maxAttrsMismatch === 0
  return { ok, maxTransformDelta, maxAttrsMismatch, samples: samples.slice(0, 80) }
}

/** @internal tests / dev — compare path `d` only */
export function pathDParityAt(
  roots: VectorElement[],
  tracks: AnimationTrack[],
  pathLayerId: string,
  timeSec: number,
  duration: number
): { ref: string; gsap: string; match: boolean } {
  rebuildGsapTrackTimeline(roots, tracks, Math.max(duration, timeSec, 1e-3))
  syncGsapTrackTimelineTime(timeSec)
  const el = findEl(roots, pathLayerId)
  if (!el || el.type !== 'path') {
    rebuildGsapTrackTimeline(roots, tracks, duration)
    return { ref: '', gsap: '', match: true }
  }
  const ref = (mergeAttrsFromTracks(el.attrs, pathLayerId, tracks, timeSec).d as string) ?? ''
  const gsap = (readGsapDriverAttrs(el, tracks, timeSec).d as string) ?? ''
  const match = ref === gsap
  rebuildGsapTrackTimeline(roots, tracks, duration)
  return { ref, gsap, match }
}
