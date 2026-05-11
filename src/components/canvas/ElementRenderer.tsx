import type { SVGProps } from 'react'
import type { AnimationTrack } from '@/types/animation'
import type { SymbolDefinition, VectorElement } from '@/types/document'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { applyMotionPathToTransform } from '@/engines/animation/motionPathApply'
import { mergeAttrsFromTracks } from '@/engines/animation/attrAnimation'
import { transformToSvgString } from '@/engines/transform/matrix'
import { cloneSymbolTemplateForInstance } from '@/engines/document/symbolClone'
import { pathDragLiveDRef } from '@/components/canvas/pathDragLivePreview'

type Props = {
  /** Root layers (used for motion-path target lookup). */
  elements: VectorElement[]
  symbols: SymbolDefinition[]
  tracks: AnimationTrack[]
  currentTime: number
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

function El({
  el,
  symbols,
  tracks,
  currentTime,
  rootElements,
  onElementPointerDown
}: {
  el: VectorElement
  symbols: SymbolDefinition[]
  tracks: AnimationTrack[]
  currentTime: number
  rootElements: VectorElement[]
  onElementPointerDown: (
    id: string,
    shiftKey: boolean,
    clientX: number,
    clientY: number,
    button: number
  ) => void
}) {
  if (el.visible === false) return null
  const tr0 = mergeTransformFromTracks(el.transform, el.id, tracks, currentTime)
  const tr = applyMotionPathToTransform(tr0, el.attrs, rootElements, tracks, el.id, currentTime)
  const editorTransform = transformToSvgString(tr)
  const mergedAttrs = mergeAttrsFromTracks(el.attrs, el.id, tracks, currentTime) as VectorElement['attrs']
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
    return (
      <g
        data-el-id={el.id}
        transform={editorTransform}
        opacity={tr.opacity}
        style={{
          cursor: el.locked ? 'default' : 'pointer',
          pointerEvents: 'auto',
          ...(cssFilter ? { filter: cssFilter } : {})
        }}
        onPointerDown={(e) => {
          if (el.locked) return
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
          rootElements={rootElements}
          onElementPointerDown={onElementPointerDown}
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
          cursor: el.locked ? 'default' : 'pointer',
          pointerEvents: 'auto',
          ...(cssFilter ? { filter: cssFilter } : {})
        }}
        onPointerDown={(e) => {
          if (el.locked) return
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
              rootElements={rootElements}
              onElementPointerDown={onElementPointerDown}
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
        cursor: el.locked ? 'default' : 'pointer',
        ...(cssFilter ? { filter: cssFilter } : {})
      }}
      onPointerDown={(e) => {
        if (el.locked) return
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
          rootElements={elements}
          onElementPointerDown={onElementPointerDown}
        />
      ))}
    </>
  )
}
