import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import {
  applyTransformDragMove,
  buildTransformDragTargets,
  clientToSvg,
  computeDragMatrix,
  type TransformDragTarget
} from '@/components/canvas/selectionTransformDrag'
import { flattenForLayers } from '@/engines/document/tree'
import { getLocalShapeCenter } from '@/engines/geometry/localShapeBounds'
import { sampleMergedAttrsForElement } from '@/engines/animation/gsapTrackCompiler'
import {
  applyToPoint,
  bakeMatrixIntoElement,
  elementGeometryToPathD,
  invertMat,
  isPointBakeType,
  matFromDOM,
  matFromTransform,
  mul,
  type Mat2D
} from '@/engines/geometry/transformGeometry'
import type { VectorElement } from '@/types/document'

type Box = { left: number; top: number; width: number; height: number }

function svgToClient(svg: SVGSVGElement, x: number, y: number) {
  const pt = svg.createSVGPoint()
  pt.x = x
  pt.y = y
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = pt.matrixTransform(ctm)
  return { x: p.x, y: p.y }
}

function ctmAsMat(svg: SVGSVGElement, id: string): Mat2D | null {
  const node = svg.querySelector(`[data-el-id="${CSS.escape(id)}"]`) as SVGGraphicsElement | null
  const m = node?.getCTM?.()
  return m ? matFromDOM(m) : null
}

type Props = {
  svgRef: React.RefObject<SVGSVGElement>
  wrapRef: React.RefObject<HTMLDivElement>
}

/** One element captured at gesture start so the absolute drag matrix can be applied idempotently. */
type TierASnapshot = {
  id: string
  /** Original geometry (base in Draw, sampled-at-playhead in Animate) — never mutated. */
  original: VectorElement
  /** Element local -> SVG root, captured at start. */
  L0: Mat2D
  /** Inverse of L0. */
  L0inv: Mat2D
  /** Base transform as a matrix (flattened into geometry so transform resets to identity). */
  T0: Mat2D
}

export function SelectionOverlay({ svgRef, wrapRef }: Props) {
  const viewBoxPanZoom = useEditorStore((s) => s.viewBox)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const selectedId = selectedIds[0] ?? null
  const selectionKey = selectedIds.length === 1 ? selectedIds[0] : [...selectedIds].sort().join('|')
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const gsapCanvasDriver = useEditorStore((s) => s.gsapCanvasDriver)
  const elements = useEditorStore((s) => s.project.elements)
  const mode = useEditorStore((s) => s.mode)
  const activeTool = useEditorStore((s) => s.activeTool)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const showPivots = useEditorStore((s) => s.showPivots)
  const updateTransform = useEditorStore((s) => s.updateTransform)
  const updateElementGeometry = useEditorStore((s) => s.updateElementGeometry)
  const setElementPivot = useEditorStore((s) => s.setElementPivot)
  const writeGeometryKeyframe = useEditorStore((s) => s.writeGeometryKeyframe)
  const pushHistory = useEditorStore((s) => s.pushHistory)

  const [box, setBox] = useState<Box | null>(null)
  const [pivotMenuOpen, setPivotMenuOpen] = useState(false)
  const [pivotMenuPos, setPivotMenuPos] = useState<{ left: number; top: number } | null>(null)
  /** Transient shared pivot for multi-selection (single selection uses persisted el.pivot). */
  const sharedPivotById = useRef<Record<string, { x: number; y: number }>>({})
  const pivotMenuRef = useRef<HTMLDivElement | null>(null)
  const [, setPivotVersion] = useState(0)
  const drag = useRef<{
    kind: 'move' | 'scale' | 'rotate'
    startSvg: { x: number; y: number }
    pivotSvg: { x: number; y: number }
    startDist: number
    startAngle: number
    tierA: TierASnapshot[]
    tierBTargets: TransformDragTarget[]
  } | null>(null)

  const single = selectedIds.length === 1

  const measure = () => {
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
    if (
      !Number.isFinite(minLeft) ||
      !Number.isFinite(minTop) ||
      !Number.isFinite(maxRight) ||
      !Number.isFinite(maxBottom)
    ) {
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

  useLayoutEffect(measure, [selectedIds, elements, tracks, currentTime, viewBoxPanZoom, svgRef, wrapRef])

  useLayoutEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Hide the overlay during playback so users can watch animation unobstructed. */
  if (
    !selectedId ||
    !box ||
    mode === 'preview' ||
    mode === 'export' ||
    activeTool !== 'select' ||
    isPlaying
  )
    return null
  const svg = svgRef.current
  const wrap = wrapRef.current
  if (!svg || !wrap) return null

  const handleSize = Math.min(10, Math.max(7, Math.min(box.width, box.height) * 0.2))
  const rotR = 5
  const cx = box.left + box.width / 2
  const rotCy = box.top - 6 - rotR
  const rotStemTop = box.top - 2

  const wrapRect = wrap.getBoundingClientRect()
  const boxCenterSvg = clientToSvg(
    svg,
    box.left + wrapRect.left + box.width / 2,
    box.top + wrapRect.top + box.height / 2
  )

  /** Element local -> root for the (single) selected element. */
  const singleEl = single ? flattenForLayers(elements).find((x) => x.el.id === selectedId)?.el ?? null : null
  const L0Single = single && selectedId ? ctmAsMat(svg, selectedId) : null

  /** Pivot in the element's LOCAL geometry space (single selection). */
  const localPivotFor = (el: VectorElement, L0: Mat2D): { x: number; y: number } => {
    if (el.pivot) return el.pivot
    const c = getLocalShapeCenter(el)
    if (c) return c
    return applyToPoint(invertMat(L0), boxCenterSvg.x, boxCenterSvg.y)
  }

  const pivotSvg =
    single && singleEl && L0Single
      ? (() => {
          const pl = localPivotFor(singleEl, L0Single)
          return applyToPoint(L0Single, pl.x, pl.y)
        })()
      : (selectionKey ? sharedPivotById.current[selectionKey] : null) ?? boxCenterSvg

  const pivotClientAbs = svgToClient(svg, pivotSvg.x, pivotSvg.y)
  const pivotScreen = {
    left: pivotClientAbs.x - wrapRect.left,
    top: pivotClientAbs.y - wrapRect.top
  }

  /** Persist (single) or stash (multi) a pivot expressed in SVG-root space. */
  const commitPivotSvg = (rootX: number, rootY: number) => {
    if (single && singleEl && L0Single) {
      const local = applyToPoint(invertMat(L0Single), rootX, rootY)
      setElementPivot(singleEl.id, { x: local.x, y: local.y }, { skipHistory: true })
    } else if (selectionKey) {
      sharedPivotById.current[selectionKey] = { x: rootX, y: rootY }
      setPivotVersion((v) => v + 1)
    }
  }

  const setPivotFromBoxPoint = (px: number, py: number) => {
    const p = clientToSvg(svg, wrapRect.left + px, wrapRect.top + py)
    pushHistory()
    commitPivotSvg(p.x, p.y)
  }

  const resetPivot = () => {
    if (single && singleEl) {
      pushHistory()
      setElementPivot(singleEl.id, null, { skipHistory: true })
    } else if (selectionKey) {
      delete sharedPivotById.current[selectionKey]
      setPivotVersion((v) => v + 1)
    }
  }

  const onPivotPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svgEl = svgRef.current
    if (!svgEl) return
    pushHistory()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const p = clientToSvg(svgEl, ev.clientX, ev.clientY)
      commitPivotSvg(p.x, p.y)
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
      if (!svgEl) return
      const inAnim = mode === 'animate'
      const flat = flattenForLayers(elements)
      const byId = new Map(flat.map((f) => [f.el.id, f.el]))

      const tierA: TierASnapshot[] = []
      const tierBIds: string[] = []
      for (const id of selectedIds) {
        const el = byId.get(id)
        if (!el || el.locked) continue
        if (isPointBakeType(el.type)) {
          const L0 = ctmAsMat(svgEl, id)
          if (!L0) {
            tierBIds.push(id)
            continue
          }
          /**
           * Animate edits operate on the geometry visible at the playhead, so capture
           * the sampled attrs; Draw edits operate on the resting base geometry.
           */
          const original: VectorElement = inAnim
            ? {
                ...el,
                attrs: sampleMergedAttrsForElement(
                  el,
                  tracks,
                  currentTime,
                  gsapCanvasDriver
                ) as VectorElement['attrs']
              }
            : el
          tierA.push({ id, original, L0, L0inv: invertMat(L0), T0: matFromTransform(el.transform) })
        } else {
          tierBIds.push(id)
        }
      }

      const tierBTargets =
        tierBIds.length > 0
          ? buildTransformDragTargets(
              svgEl,
              elements,
              tierBIds,
              tracks,
              inAnim ? currentTime : 0,
              inAnim,
              gsapCanvasDriver
            )
          : []

      if (tierA.length === 0 && tierBTargets.length === 0) return

      const startSvg = clientToSvg(svgEl, e.clientX, e.clientY)
      const dx0 = startSvg.x - pivotSvg.x
      const dy0 = startSvg.y - pivotSvg.y
      const startDist = Math.hypot(dx0, dy0) || 1
      const startAngle = (Math.atan2(dy0, dx0) * 180) / Math.PI

      drag.current = {
        kind,
        startSvg,
        pivotSvg,
        startDist,
        startAngle,
        tierA,
        tierBTargets
      }
      pushHistory()
      ;(e.target as Element).setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const d = drag.current
        if (!d || !svgRef.current) return
        const cur = clientToSvg(svgRef.current, ev.clientX, ev.clientY)
        const mRoot = computeDragMatrix(
          d.pivotSvg,
          d.startSvg,
          cur,
          d.startDist,
          d.startAngle,
          d.kind
        )

        for (const t of d.tierA) {
          /** Express the root-space gesture in the element's local geometry space, folding in T0. */
          const mLocal = mul(t.T0, mul(t.L0inv, mul(mRoot, t.L0)))
          const baked = bakeMatrixIntoElement(t.original, mLocal)
          if (!baked) continue
          if (inAnim) {
            const localD =
              baked.type === 'path' && typeof baked.attrs.d === 'string'
                ? (baked.attrs.d as string)
                : elementGeometryToPathD({ ...t.original, type: baked.type, attrs: baked.attrs })
            if (localD) writeGeometryKeyframe(t.id, localD, { skipHistory: true })
          } else {
            updateElementGeometry(t.id, baked, { skipHistory: true })
            updateTransform(
              t.id,
              { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 },
              { skipHistory: true }
            )
          }
        }

        if (d.tierBTargets.length > 0) {
          const updates = applyTransformDragMove(
            d.tierBTargets,
            d.pivotSvg,
            d.startSvg,
            cur,
            d.startDist,
            d.startAngle,
            d.kind
          )
          for (const update of updates) {
            updateTransform(update.id, update.partial, { skipHistory: true })
          }
        }

        /** Keep a transient multi-selection pivot following a move gesture. */
        if (d.kind === 'move' && !single && selectionKey && sharedPivotById.current[selectionKey]) {
          const dx = cur.x - d.startSvg.x
          const dy = cur.y - d.startSvg.y
          sharedPivotById.current[selectionKey] = {
            x: d.pivotSvg.x + dx,
            y: d.pivotSvg.y + dy
          }
          setPivotVersion((v) => v + 1)
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
      {/* Draggable pivot marker — gated on the show-pivots toggle. */}
      {showPivots && (
        <div
          title="Drag to move pivot · right-click for presets · double-click to reset"
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
            resetPivot()
          }}
        />
      )}
      {showPivots && pivotMenuOpen && pivotMenuPos && (
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
                resetPivot()
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
