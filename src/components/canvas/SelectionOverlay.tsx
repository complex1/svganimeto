import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { flattenForLayers } from '@/engines/document/tree'

type Box = { left: number; top: number; width: number; height: number }

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

function svgToClient(svg: SVGSVGElement, x: number, y: number) {
  const pt = svg.createSVGPoint()
  pt.x = x
  pt.y = y
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = pt.matrixTransform(ctm)
  return { x: p.x, y: p.y }
}

function rotateVector(x: number, y: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return {
    x: x * c - y * s,
    y: x * s + y * c
  }
}

type Props = {
  svgRef: React.RefObject<SVGSVGElement>
  wrapRef: React.RefObject<HTMLDivElement>
}

export function SelectionOverlay({ svgRef, wrapRef }: Props) {
  const viewBoxPanZoom = useEditorStore((s) => s.viewBox)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const selectedId = selectedIds[0] ?? null
  const selectionKey = selectedIds.length === 1 ? selectedIds[0] : [...selectedIds].sort().join('|')
  const elements = useEditorStore((s) => s.project.elements)
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const mode = useEditorStore((s) => s.mode)
  const updateTransform = useEditorStore((s) => s.updateTransform)
  const pushHistory = useEditorStore((s) => s.pushHistory)

  const [box, setBox] = useState<Box | null>(null)
  const [pivotMenuOpen, setPivotMenuOpen] = useState(false)
  const [pivotMenuPos, setPivotMenuPos] = useState<{ left: number; top: number } | null>(null)
  const customPivotById = useRef<Record<string, { x: number; y: number }>>({})
  const pivotMenuRef = useRef<HTMLDivElement | null>(null)
  const [, setPivotVersion] = useState(0)
  const drag = useRef<{
    kind: 'move' | 'scale' | 'rotate'
    startSvg: { x: number; y: number }
    targets: Array<{
      id: string
      startTransform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
    }>
    pivotSvg: { x: number; y: number }
    startDist: number
    startAngle: number
  } | null>(null)

  useLayoutEffect(() => {
    const svg = svgRef.current
    const wrap = wrapRef.current
    if (!svg || !wrap || selectedIds.length === 0) {
      setBox(null)
      return
    }

    let minLeft = Infinity
    let minTop = Infinity
    let maxRight = -Infinity
    let maxBottom = -Infinity
    for (const id of selectedIds) {
      const el = svg.querySelector(`[data-el-id="${CSS.escape(id)}"]`) as SVGGraphicsElement | null
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1e-6 && r.height < 1e-6) continue
      minLeft = Math.min(minLeft, r.left)
      minTop = Math.min(minTop, r.top)
      maxRight = Math.max(maxRight, r.right)
      maxBottom = Math.max(maxBottom, r.bottom)
    }
    if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
      setBox(null)
      return
    }
    const wrapRect = wrap.getBoundingClientRect()
    const pad = 3
    setBox({
      left: minLeft - wrapRect.left - pad,
      top: minTop - wrapRect.top - pad,
      width: maxRight - minLeft + pad * 2,
      height: maxBottom - minTop + pad * 2
    })
  }, [selectedIds, elements, tracks, currentTime, viewBoxPanZoom, svgRef, wrapRef])

  useLayoutEffect(() => {
    const onResize = () => {
      const svg = svgRef.current
      const wrap = wrapRef.current
      if (!svg || !wrap || selectedIds.length === 0) return
      let minLeft = Infinity
      let minTop = Infinity
      let maxRight = -Infinity
      let maxBottom = -Infinity
      for (const id of selectedIds) {
        const el = svg.querySelector(`[data-el-id="${CSS.escape(id)}"]`) as SVGGraphicsElement | null
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.width < 1e-6 && r.height < 1e-6) continue
        minLeft = Math.min(minLeft, r.left)
        minTop = Math.min(minTop, r.top)
        maxRight = Math.max(maxRight, r.right)
        maxBottom = Math.max(maxBottom, r.bottom)
      }
      if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
        setBox(null)
        return
      }
      const wrapRect = wrap.getBoundingClientRect()
      const pad = 3
      setBox({
        left: minLeft - wrapRect.left - pad,
        top: minTop - wrapRect.top - pad,
        width: maxRight - minLeft + pad * 2,
        height: maxBottom - minTop + pad * 2
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [selectedIds, svgRef, wrapRef])

  useEffect(() => {
    if (!pivotMenuOpen) return
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null
      if (!pivotMenuRef.current || (target && pivotMenuRef.current.contains(target))) return
      setPivotMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [pivotMenuOpen])

  if (!selectedId || !box || mode === 'preview' || mode === 'export') return null
  const svg = svgRef.current
  const wrap = wrapRef.current
  if (!svg || !wrap) return null

  const handleSize = Math.min(10, Math.max(7, Math.min(box.width, box.height) * 0.2))
  const rotR = 5
  const cx = box.left + box.width / 2
  const rotCy = box.top - 6 - rotR
  const rotStemTop = box.top - 2

  /** Scale + rotate pivot is top-left of visible selection border (requested behavior). */
  const wrapRect = wrap.getBoundingClientRect()
  const defaultPivotSvg = clientToSvg(svg, box.left + wrapRect.left, box.top + wrapRect.top)
  const pivotSvg = selectionKey
    ? customPivotById.current[selectionKey] ?? defaultPivotSvg
    : defaultPivotSvg
  const pivotClientAbs = svgToClient(svg, pivotSvg.x, pivotSvg.y)
  const pivotScreen = {
    left: pivotClientAbs.x - wrapRect.left,
    top: pivotClientAbs.y - wrapRect.top
  }

  const setPivotFromBoxPoint = (px: number, py: number) => {
    if (!selectionKey) return
    const p = clientToSvg(svg, wrapRect.left + px, wrapRect.top + py)
    customPivotById.current[selectionKey] = p
    setPivotVersion((v) => v + 1)
  }

  const onPivotPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svgEl = svgRef.current
    const sid = selectionKey
    if (!svgEl || !sid) return
    ;(e.target as Element).setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const p = clientToSvg(svgEl, ev.clientX, ev.clientY)
      customPivotById.current[sid] = { x: p.x, y: p.y }
      setPivotVersion((v) => v + 1)
    }

    const onUp = (ev: PointerEvent) => {
      try {
        ;(e.target as Element).releasePointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onPointerDown =
    (kind: 'move' | 'scale' | 'rotate') => (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const svgEl = svgRef.current
      const wrap = wrapRef.current
      if (!svgEl || !wrap) return
      const elementMap = new Map(
        flattenForLayers(useEditorStore.getState().project.elements).map((n) => [n.el.id, n.el])
      )
      const transformTargets = selectedIds
        .map((id) => {
          const elStore = elementMap.get(id)
          if (!elStore || elStore.locked) return null
          return {
            id,
            startTransform: {
              x: elStore.transform.x,
              y: elStore.transform.y,
              scaleX: elStore.transform.scaleX,
              scaleY: elStore.transform.scaleY,
              rotation: elStore.transform.rotation
            }
          }
        })
        .filter((v): v is { id: string; startTransform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number } } => Boolean(v))
      if (transformTargets.length === 0) return
      const startSvg = clientToSvg(svgEl, e.clientX, e.clientY)

      const dx0 = startSvg.x - pivotSvg.x
      const dy0 = startSvg.y - pivotSvg.y
      const startDist = Math.hypot(dx0, dy0) || 1
      const startAngle = (Math.atan2(dy0, dx0) * 180) / Math.PI

      drag.current = {
        kind,
        startSvg,
        targets: transformTargets,
        pivotSvg,
        startDist,
        startAngle
      }
      pushHistory()
      ;(e.target as Element).setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const d = drag.current
        if (!d || !svgRef.current) return
        const cur = clientToSvg(svgRef.current, ev.clientX, ev.clientY)
        if (d.kind === 'move') {
          const dx = cur.x - d.startSvg.x
          const dy = cur.y - d.startSvg.y
          for (const t of d.targets) {
            updateTransform(
              t.id,
              {
                x: t.startTransform.x + dx,
                y: t.startTransform.y + dy
              },
              { skipHistory: true }
            )
          }
          // Keep custom pivot attached to the object while translating.
          if (selectionKey && customPivotById.current[selectionKey]) {
            customPivotById.current[selectionKey] = {
              x: d.pivotSvg.x + dx,
              y: d.pivotSvg.y + dy
            }
            setPivotVersion((v) => v + 1)
          }
        } else if (d.kind === 'scale') {
          const dist = Math.hypot(cur.x - d.pivotSvg.x, cur.y - d.pivotSvg.y) || 1
          const s = dist / d.startDist
          for (const t of d.targets) {
            const nextScaleX = Math.max(0.05, t.startTransform.scaleX * s)
            const nextScaleY = Math.max(0.05, t.startTransform.scaleY * s)

            // Move translate origin so scaling visually happens around pivot.
            const v0x = t.startTransform.x - d.pivotSvg.x
            const v0y = t.startTransform.y - d.pivotSvg.y
            const nextX = d.pivotSvg.x + v0x * s
            const nextY = d.pivotSvg.y + v0y * s

            updateTransform(
              t.id,
              {
                x: nextX,
                y: nextY,
                scaleX: nextScaleX,
                scaleY: nextScaleY
              },
              { skipHistory: true }
            )
          }
        } else if (d.kind === 'rotate') {
          const ang = (Math.atan2(cur.y - d.pivotSvg.y, cur.x - d.pivotSvg.x) * 180) / Math.PI
          const delta = ang - d.startAngle

          for (const t of d.targets) {
            // Move translate origin so rotation visually happens around pivot.
            const v0x = t.startTransform.x - d.pivotSvg.x
            const v0y = t.startTransform.y - d.pivotSvg.y
            const rv = rotateVector(v0x, v0y, delta)
            const nextX = d.pivotSvg.x + rv.x
            const nextY = d.pivotSvg.y + rv.y

            updateTransform(
              t.id,
              {
                x: nextX,
                y: nextY,
                rotation: t.startTransform.rotation + delta
              },
              { skipHistory: true }
            )
          }
        }
      }

      const onUp = (ev: PointerEvent) => {
        try {
          ;(e.target as Element).releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        drag.current = null
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

  const baseHandleStyle: CSSProperties = {
    position: 'absolute',
    width: handleSize,
    height: handleSize,
    background: '#fff',
    border: '1px solid #8b5cf6',
    boxSizing: 'border-box',
    pointerEvents: 'auto'
  }

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      <div
        style={{
          position: 'absolute',
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          border: '1px solid #8b5cf6',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          cursor: 'move'
        }}
        onPointerDown={onPointerDown('move')}
      />

      <div
        style={{
          ...baseHandleStyle,
          left: box.left - handleSize / 2,
          top: box.top - handleSize / 2,
          cursor: 'nwse-resize'
        }}
        onPointerDown={onPointerDown('scale')}
      />
      <div
        style={{
          ...baseHandleStyle,
          left: box.left + box.width - handleSize / 2,
          top: box.top - handleSize / 2,
          cursor: 'nesw-resize'
        }}
        onPointerDown={onPointerDown('scale')}
      />
      <div
        style={{
          ...baseHandleStyle,
          left: box.left - handleSize / 2,
          top: box.top + box.height - handleSize / 2,
          cursor: 'nesw-resize'
        }}
        onPointerDown={onPointerDown('scale')}
      />
      <div
        style={{
          ...baseHandleStyle,
          left: box.left + box.width - handleSize / 2,
          top: box.top + box.height - handleSize / 2,
          cursor: 'nwse-resize'
        }}
        onPointerDown={onPointerDown('scale')}
      />

      <div
        style={{
          position: 'absolute',
          left: cx,
          top: rotStemTop,
          height: Math.max(box.top - rotCy, 0),
          borderLeft: '1px solid #8b5cf6',
          transform: 'translateX(-0.5px)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: rotR * 2,
          height: rotR * 2,
          borderRadius: '50%',
          left: cx - rotR,
          top: rotCy - rotR,
          background: '#fff',
          border: '1px solid #8b5cf6',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          cursor: 'grab'
        }}
        onPointerDown={onPointerDown('rotate')}
      />
      {/* Draggable pivot marker used by scale/rotate operations */}
      <div
        title="Pivot (drag to move, double-click to reset)"
        style={{
          position: 'absolute',
          left: pivotScreen.left - 5,
          top: pivotScreen.top - 5,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#8b5cf6',
          border: '2px solid #fff',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          cursor: 'grab',
          zIndex: 2
        }}
        onPointerDown={onPivotPointerDown}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const wrapBounds = wrapRef.current?.getBoundingClientRect()
          if (!wrapBounds) return
          setPivotMenuPos({
            left: e.clientX - wrapBounds.left + 4,
            top: e.clientY - wrapBounds.top + 4
          })
          setPivotMenuOpen(true)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!selectionKey) return
          delete customPivotById.current[selectionKey]
          setPivotVersion((v) => v + 1)
        }}
      />
      {pivotMenuOpen && pivotMenuPos && (
        <div
          ref={pivotMenuRef}
          style={{
            position: 'absolute',
            left: pivotMenuPos.left,
            top: pivotMenuPos.top,
            pointerEvents: 'auto',
            zIndex: 4
          }}
        >
          <div
            style={{
              minWidth: 148,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              padding: 4
            }}
          >
            {[
              { label: 'Top Left', x: box.left, y: box.top },
              { label: 'Top Mid', x: box.left + box.width / 2, y: box.top },
              { label: 'Top Right', x: box.left + box.width, y: box.top },
              { label: 'Left Mid', x: box.left, y: box.top + box.height / 2 },
              { label: 'Center', x: box.left + box.width / 2, y: box.top + box.height / 2 },
              { label: 'Right Mid', x: box.left + box.width, y: box.top + box.height / 2 },
              { label: 'Bottom Left', x: box.left, y: box.top + box.height },
              { label: 'Bottom Mid', x: box.left + box.width / 2, y: box.top + box.height },
              { label: 'Bottom Right', x: box.left + box.width, y: box.top + box.height }
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: 12,
                  borderRadius: 4,
                  cursor: 'pointer'
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setPivotFromBoxPoint(item.x, item.y)
                  setPivotMenuOpen(false)
                  setPivotMenuPos(null)
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '6px 8px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 12,
                borderRadius: 4,
                cursor: 'pointer'
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (selectionKey) delete customPivotById.current[selectionKey]
                setPivotVersion((v) => v + 1)
                setPivotMenuOpen(false)
                setPivotMenuPos(null)
              }}
            >
              Reset to Default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
