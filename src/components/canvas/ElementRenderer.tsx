import type { SVGProps } from 'react'
import type { AnimationTrack } from '@/types/animation'
import type { SymbolDefinition, VectorElement } from '@/types/document'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { transformToSvgString } from '@/engines/transform/matrix'
import { cloneSymbolTemplateForInstance } from '@/engines/document/symbolClone'

type Props = {
  elements: VectorElement[]
  symbols: SymbolDefinition[]
  tracks: AnimationTrack[]
  currentTime: number
  onElementPointerDown: (id: string, shiftKey: boolean) => void
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
  onElementPointerDown
}: {
  el: VectorElement
  symbols: SymbolDefinition[]
  tracks: AnimationTrack[]
  currentTime: number
  onElementPointerDown: (id: string, shiftKey: boolean) => void
}) {
  if (el.visible === false) return null
  const tr = mergeTransformFromTracks(el.transform, el.id, tracks, currentTime)
  const editorTransform = transformToSvgString(tr)

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
        style={{ cursor: el.locked ? 'default' : 'pointer', pointerEvents: 'auto' }}
        onPointerDown={(e) => {
          if (el.locked) return
          e.stopPropagation()
          onElementPointerDown(el.id, e.shiftKey)
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
        style={{ cursor: el.locked ? 'default' : 'pointer', pointerEvents: 'auto' }}
        onPointerDown={(e) => {
          if (el.locked) return
          e.stopPropagation()
          onElementPointerDown(el.id, e.shiftKey)
        }}
      >
        {/*
          Avoid pointer-events: none on this inner wrapper — in SVG it can prevent descendants
          from receiving hits so groups (e.g. detached symbols) appear unclickable.
        */}
        <g {...(spreadAttrs(el.attrs) as SVGProps<SVGGElement>)}>
          {(el.children ?? []).map((c) => (
            <El
              key={c.id}
              el={c}
              symbols={symbols}
              tracks={tracks}
              currentTime={currentTime}
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
      style={{ cursor: el.locked ? 'default' : 'pointer' }}
      onPointerDown={(e) => {
        if (el.locked) return
        e.stopPropagation()
        onElementPointerDown(el.id, e.shiftKey)
      }}
    >
      <InnerShape el={el} />
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
          onElementPointerDown={onElementPointerDown}
        />
      ))}
    </>
  )
}
