import type { SVGProps } from 'react'
import type { AnimationTrack } from '@/types/animation'
import type { VectorElement } from '@/types/document'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { transformToSvgString } from '@/engines/transform/matrix'

type Props = {
  elements: VectorElement[]
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
    default:
      return null
  }
}

function spreadAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('__')) continue
    if (k === 'class') out.className = String(v)
    else out[k] = v
  }
  return out
}

function El({
  el,
  tracks,
  currentTime,
  onElementPointerDown
}: {
  el: VectorElement
  tracks: AnimationTrack[]
  currentTime: number
  onElementPointerDown: (id: string, shiftKey: boolean) => void
}) {
  if (el.visible === false) return null
  const tr = mergeTransformFromTracks(el.transform, el.id, tracks, currentTime)
  const editorTransform = transformToSvgString(tr)

  if (el.type === 'group') {
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
        <g
          {...(spreadAttrs(el.attrs) as SVGProps<SVGGElement>)}
          style={{ pointerEvents: 'none' }}
        >
          {(el.children ?? []).map((c) => (
            <El
              key={c.id}
              el={c}
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

export function ElementRenderer({ elements, tracks, currentTime, onElementPointerDown }: Props) {
  return (
    <>
      {elements.map((el) => (
        <El
          key={el.id}
          el={el}
          tracks={tracks}
          currentTime={currentTime}
          onElementPointerDown={onElementPointerDown}
        />
      ))}
    </>
  )
}
