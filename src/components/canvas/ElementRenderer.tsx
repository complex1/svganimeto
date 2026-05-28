import type { SVGProps } from 'react'
import type { AnimationTrack } from '@/types/animation'
import type { SymbolDefinition, VectorElement } from '@/types/document'
import { applyMotionPathToTransform } from '@/engines/animation/motionPathApply'
import {
  sampleMergedAttrsForElement,
  sampleMergedTransformForElement
} from '@/engines/animation/gsapTrackCompiler'
import { transformToSvgString } from '@/engines/transform/matrix'
import { cloneSymbolTemplateForInstance } from '@/engines/document/symbolClone'
import { pathDragLiveDRef } from '@/components/canvas/pathDragLivePreview'
import type { DrawTool } from '@/store/editorStore'
import { useEditorStore } from '@/store/editorStore'

type Props = {
  /** Root layers (used for motion-path target lookup). */
  elements: VectorElement[]
  symbols: SymbolDefinition[]
  tracks: AnimationTrack[]
  currentTime: number
  gsapCanvasDriver: boolean
  activeTool: DrawTool
  onElementPointerDown: (
    id: string,
    shiftKey: boolean,
    clientX: number,
    clientY: number,
    button: number
  ) => void
}

function readNumberAttr(attrs: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = attrs[key]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function cssFilterFromAttrs(attrs: Record<string, unknown>): string | undefined {
  const blur = Math.max(0, readNumberAttr(attrs, '__fxBlur', 0))
  const sx = readNumberAttr(attrs, '__fxShadowX', 0)
  const sy = readNumberAttr(attrs, '__fxShadowY', 0)
  const sb = Math.max(0, readNumberAttr(attrs, '__fxShadowBlur', 0))
  const sc = typeof attrs.__fxShadowColor === 'string' ? attrs.__fxShadowColor : '#000000'
  const parts: string[] = []
  if (blur > 0.01) parts.push(`blur(${blur.toFixed(2)}px)`)
  if (sb > 0.01 || Math.abs(sx) > 0.01 || Math.abs(sy) > 0.01) {
    parts.push(`drop-shadow(${sx.toFixed(2)}px ${sy.toFixed(2)}px ${sb.toFixed(2)}px ${sc})`)
  }
  return parts.length ? parts.join(' ') : undefined
}

/** SVG `filter="url(#id)"` from animation track + CSS blur/shadow from __fx*. */
function combinedFilterStyle(attrs: Record<string, unknown>): string | undefined {
  const fx = cssFilterFromAttrs(attrs)
  const url =
    typeof attrs.filter === 'string' && attrs.filter.trim().startsWith('url(')
      ? attrs.filter.trim()
      : undefined
  const parts = [url, fx].filter(Boolean) as string[]
  return parts.length ? parts.join(' ') : undefined
}

function attrsForShape(merged: VectorElement['attrs']): VectorElement['attrs'] {
  const o = { ...merged } as Record<string, unknown>
  delete o.filter
  return o as VectorElement['attrs']
}

function InnerShape({ el }: { el: VectorElement }) {
  const { attrs } = el
  switch (el.type) {
    case 'group':
      return null
    case 'text': {
      const { __textContent, ...rest } = attrs as Record<string, unknown>
      const text = typeof __textContent === 'string' ? __textContent : ''
      return <text {...(spreadAttrs(rest) as React.SVGProps<SVGTextElement>)}>{text}</text>
    }
    case 'rect':
      return <rect {...(spreadAttrs(attrs) as React.SVGProps<SVGRectElement>)} />
    case 'circle':
      return <circle {...(spreadAttrs(attrs) as React.SVGProps<SVGCircleElement>)} />
    case 'ellipse':
      return <ellipse {...(spreadAttrs(attrs) as React.SVGProps<SVGEllipseElement>)} />
    case 'line':
      return <line {...(spreadAttrs(attrs) as React.SVGProps<SVGLineElement>)} />
    case 'path':
      return <path {...(spreadAttrs(attrs) as React.SVGProps<SVGPathElement>)} />
    case 'image':
      return <image {...(spreadAttrs(attrs) as React.SVGProps<SVGImageElement>)} />
    case 'polygon':
      return <polygon {...(spreadAttrs(attrs) as React.SVGProps<SVGPolygonElement>)} />
    case 'polyline':
      return <polyline {...(spreadAttrs(attrs) as React.SVGProps<SVGPolylineElement>)} />
    case 'symbolInstance':
      return null
    default:
      return null
  }
}

/** React SVG expects camelCase; our model/export use hyphenated SVG names. */
function reactDomAttrKey(name: string): string | null {
  if (name.startsWith('__')) return null
  if (name === 'class') return 'className'
  if (name.startsWith('data-') || name.startsWith('aria-')) return name
  if (!name.includes('-')) return name
  return name.replace(/-([a-z])/gi, (_, c: string) => c.toUpperCase())
}

function spreadAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    const rk = reactDomAttrKey(k)
    if (rk === null) continue
    out[rk] = k === 'class' ? String(v) : v
  }
  return out
}

function elementCursor(activeTool: DrawTool, locked: boolean | undefined) {
  if (activeTool === 'hand') return 'grab'
  return locked ? 'default' : 'pointer'
}

/**
 * Drawing tools (pen, pencil, shapes, fill, etc.) need the pointer event to
 * reach the canvas background even when the cursor lands on an existing
 * element — otherwise users can't add a new path point on top of existing art.
 */
const DRAW_THROUGH_TOOLS: DrawTool[] = [
  'pen',
  'pencil',
  'brush',
  'eraser',
  'rect',
  'circle',
  'ellipse',
  'line',
  'text'
]
function shouldDrawThrough(activeTool: DrawTool) {
  return DRAW_THROUGH_TOOLS.includes(activeTool)
}

function El({
  el,
  symbols,
  tracks,
  currentTime,
  gsapCanvasDriver,
  rootElements,
  activeTool,
  onElementPointerDown,
  timeOverride,
  tracksOverride
}: {
  el: VectorElement
  symbols: SymbolDefinition[]
  tracks: AnimationTrack[]
  currentTime: number
  gsapCanvasDriver: boolean
  rootElements: VectorElement[]
  activeTool: DrawTool
  onElementPointerDown: (
    id: string,
    shiftKey: boolean,
    clientX: number,
    clientY: number,
    button: number
  ) => void
  /** When set (e.g. inside a symbol instance) sample at this time instead of the playhead. */
  timeOverride?: number
  /** When set, sample these tracks instead of the live project timeline. */
  tracksOverride?: AnimationTrack[]
}) {
  const mode = useEditorStore((s) => s.mode)
  const playhead = useEditorStore((s) => s.currentTime)
  const timelineTracks = useEditorStore((s) => s.tracks)
  const gsapDriver = useEditorStore((s) => s.gsapCanvasDriver)
  if (el.visible === false) return null
  const animateView = mode === 'animate' || mode === 'preview'
  /**
   * Draw view normally renders the layer's resting pose, but when we're inside a
   * symbol instance (`timeOverride` / `tracksOverride` set) we always sample so the
   * symbol's own timeline animates the instance on the main canvas even in Draw.
   */
  const insideSymbolScope = tracksOverride !== undefined && timeOverride !== undefined
  const shouldSample = insideSymbolScope || animateView
  const timeSec = insideSymbolScope
    ? (timeOverride as number)
    : animateView
      ? playhead
      : currentTime
  const tracksForSample = insideSymbolScope
    ? (tracksOverride as AnimationTrack[])
    : animateView
      ? timelineTracks
      : tracks
  const tr0 = shouldSample
    ? sampleMergedTransformForElement(el, rootElements, tracksForSample, timeSec, gsapDriver)
    : el.transform
  const tr = applyMotionPathToTransform(tr0, el, rootElements, tracksForSample, timeSec)
  const editorTransform = transformToSvgString(tr)
  const mergedAttrs = (
    shouldSample
      ? sampleMergedAttrsForElement(el, tracksForSample, timeSec, gsapDriver)
      : el.attrs
  ) as VectorElement['attrs']
  const cssFilter = combinedFilterStyle(mergedAttrs as Record<string, unknown>)
  const live = pathDragLiveDRef.current
  const mergedForShape =
    el.type === 'path' && live?.elementId === el.id
      ? ({ ...mergedAttrs, d: live.d } as VectorElement['attrs'])
      : mergedAttrs
  const shapeAttrs = attrsForShape(mergedForShape)

  if (el.type === 'symbolInstance') {
    const sid = String(el.attrs.__symbolId ?? '')
    const def = symbols.find((s) => s.id === sid)
    if (!def) return null
    const clone = cloneSymbolTemplateForInstance(def.template, el.id)

    /**
     * If the symbol carries its own animation, drive the cloned subtree from it.
     * - `tracks` are remapped so each elementId is prefixed to match the clone's id
     *   (`${instanceId}_sym_${templateId}`) — exactly what cloneSymbolTemplateForInstance produces.
     * - `time` is the project playhead modulo the symbol's duration when looping,
     *   otherwise clamped to [0, duration]. This gives every instance its own running
     *   clock relative to the main canvas, independent of the main timeline.
     */
    const symAnim = def.animation
    let childTimeOverride = timeOverride
    let childTracksOverride = tracksOverride
    if (symAnim && symAnim.tracks.length > 0 && symAnim.duration > 0) {
      const prefix = `${el.id}_sym_`
      const remappedTracks: AnimationTrack[] = symAnim.tracks.map((t) => ({
        ...t,
        elementId: `${prefix}${t.elementId}`
      }))
      const baseTime = animateView ? playhead : currentTime
      const loopOn = symAnim.loop !== false
      const symTime = loopOn
        ? ((baseTime % symAnim.duration) + symAnim.duration) % symAnim.duration
        : Math.max(0, Math.min(symAnim.duration, baseTime))
      childTimeOverride = symTime
      childTracksOverride = remappedTracks
    }

    return (
      <g
        data-el-id={el.id}
        transform={editorTransform}
        opacity={tr.opacity}
        style={{
          cursor: elementCursor(activeTool, el.locked),
          pointerEvents: 'auto',
          ...(cssFilter ? { filter: cssFilter } : {})
        }}
        onPointerDown={(e) => {
          if (el.locked) return
          if (activeTool === 'hand') return
          if (shouldDrawThrough(activeTool)) return
          e.stopPropagation()
          onElementPointerDown(el.id, e.shiftKey, e.clientX, e.clientY, e.button)
        }}
      >
        {/*
          Do not use pointer-events: none on the clone wrapper — SVG won't hit-test the instance's
          outer <g> when all descendants opt out, so the select tool could never select the symbol.
          Inner nodes are locked; their handlers return without stopping propagation so the event
          bubbles here and selects the instance id.
        */}
        <El
          el={clone}
          symbols={symbols}
          tracks={tracks}
          currentTime={currentTime}
          gsapCanvasDriver={gsapCanvasDriver}
          rootElements={rootElements}
          activeTool={activeTool}
          onElementPointerDown={onElementPointerDown}
          timeOverride={childTimeOverride}
          tracksOverride={childTracksOverride}
        />
      </g>
    )
  }

  if (el.type === 'group') {
    return (
      <g
        data-el-id={el.id}
        transform={editorTransform}
        opacity={tr.opacity}
        style={{
          cursor: elementCursor(activeTool, el.locked),
          pointerEvents: 'auto',
          ...(cssFilter ? { filter: cssFilter } : {})
        }}
        onPointerDown={(e) => {
          if (el.locked) return
          if (activeTool === 'hand') return
          if (shouldDrawThrough(activeTool)) return
          e.stopPropagation()
          onElementPointerDown(el.id, e.shiftKey, e.clientX, e.clientY, e.button)
        }}
      >
        {/*
          Avoid pointer-events: none on this inner wrapper — in SVG it can prevent descendants
          from receiving hits so groups (e.g. detached symbols) appear unclickable.
        */}
        <g {...(spreadAttrs(shapeAttrs as Record<string, unknown>) as SVGProps<SVGGElement>)}>
          {(el.children ?? []).map((c) => (
            <El
              key={c.id}
              el={c}
              symbols={symbols}
              tracks={tracks}
              currentTime={currentTime}
              gsapCanvasDriver={gsapCanvasDriver}
              rootElements={rootElements}
              activeTool={activeTool}
              onElementPointerDown={onElementPointerDown}
              timeOverride={timeOverride}
              tracksOverride={tracksOverride}
            />
          ))}
        </g>
      </g>
    )
  }

  return (
    <g
      data-el-id={el.id}
      transform={editorTransform}
      opacity={tr.opacity}
      style={{
        cursor: elementCursor(activeTool, el.locked),
        ...(cssFilter ? { filter: cssFilter } : {})
      }}
      onPointerDown={(e) => {
        if (el.locked) return
        if (activeTool === 'hand') return
        if (shouldDrawThrough(activeTool)) return
        e.stopPropagation()
        onElementPointerDown(el.id, e.shiftKey, e.clientX, e.clientY, e.button)
      }}
    >
      <InnerShape el={{ ...el, attrs: shapeAttrs }} />
    </g>
  )
}

export function ElementRenderer({
  elements,
  symbols,
  tracks,
  currentTime,
  gsapCanvasDriver,
  activeTool,
  onElementPointerDown
}: Props) {
  return (
    <>
      {elements.map((el) => (
        <El
          key={el.id}
          el={el}
          symbols={symbols}
          tracks={tracks}
          currentTime={currentTime}
          gsapCanvasDriver={gsapCanvasDriver}
          rootElements={elements}
          activeTool={activeTool}
          onElementPointerDown={onElementPointerDown}
        />
      ))}
    </>
  )
}
