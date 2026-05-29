import clsx from 'clsx'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { nanoid } from 'nanoid'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faChevronRight, faCircleInfo, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore } from '@/store/editorStore'
import { flattenForLayers } from '@/engines/document/tree'
import { sampleTrack } from '@/engines/animation/interpolate'
import {
  sampleMergedAttrsForElement,
  sampleMergedTransformForElement
} from '@/engines/animation/gsapTrackCompiler'
import { getLocalShapeCenter } from '@/engines/geometry/localShapeBounds'
import type { AnimationTrack, NoiseDef, NoiseProperty } from '@/types/animation'
import type { VectorElement } from '@/types/document'
import type { TextureBrush, TextureBrushPresetId } from '@/types/texture'
import { NOISE_PROPERTIES } from '@/engines/animation/noise'
import { bboxInSvgRootSpace } from '@/components/canvas/svgBounds'
import type { LinearGradientDef, RadialGradientDef } from '@/types/gradient'
import { AnimationPresetsModal } from '@/components/AnimationPresetsModal'
import {
  defaultTextureBrush,
  getTextureBrushPreset,
  sampleTextureStamps,
  TEXTURE_BRUSH_ELIGIBLE_TYPES,
  TEXTURE_BRUSH_PRESETS
} from '@/engines/texture/textureBrushes'

function InspectorHelpIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-help">
      <button type="button" className="inspector-help-trigger" aria-label={label}>
        <FontAwesomeIcon icon={faCircleInfo} style={{ fontSize: 14 }} />
      </button>
      <div role="tooltip" className="inspector-help-tooltip">
        {children}
      </div>
    </div>
  )
}

type InspectorSectionId =
  | 'layer'
  | 'transform'
  | 'animation'
  | 'noise'
  | 'texture'
  | 'symbol'
  | 'geometry'
  | 'appearance'
  | 'typography'
  | 'effects'
  | 'advanced'
  | 'layout'

const defaultOpenSections: Record<InspectorSectionId, boolean> = {
  layer: true,
  transform: true,
  animation: true,
  noise: false,
  texture: false,
  symbol: true,
  geometry: true,
  appearance: true,
  typography: false,
  effects: false,
  advanced: false,
  layout: false
}

function InspectorCollapsibleSection({
  sectionId,
  title,
  info,
  infoLabel,
  expanded,
  onToggle,
  disabled = false,
  disabledReason,
  children
}: {
  sectionId: InspectorSectionId
  title: string
  info?: ReactNode
  infoLabel?: string
  expanded: boolean
  onToggle: () => void
  disabled?: boolean
  disabledReason?: string
  children: ReactNode
}) {
  return (
    <section
      className={clsx('inspector-section', disabled && 'inspector-section--disabled')}
      data-section={sectionId}
    >
      <div className="inspector-section-header">
        <button
          type="button"
          className="inspector-section-toggle"
          aria-expanded={expanded}
          aria-controls={`inspector-section-${sectionId}`}
          onClick={onToggle}
        >
          <FontAwesomeIcon
            icon={expanded ? faChevronDown : faChevronRight}
            className="inspector-section-chevron"
            aria-hidden
          />
          <span className="inspector-section-title">{title}</span>
        </button>
        {info ? (
          <div className="inspector-section-help" onClick={(e) => e.stopPropagation()}>
            <InspectorHelpIcon label={infoLabel ?? `About ${title}`}>{info}</InspectorHelpIcon>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div id={`inspector-section-${sectionId}`} className="inspector-section-body">
          {disabled && disabledReason ? (
            <p className="inspector-section-hint">{disabledReason}</p>
          ) : null}
          {!disabled ? children : null}
        </div>
      ) : null}
    </section>
  )
}

/** Resolved `d` for a path layer at a timeline time (includes pathD track if any). */
function mergedPathDForLayer(
  roots: VectorElement[],
  tracks: AnimationTrack[],
  pathLayerId: string,
  timeSec: number,
  useGsapDriver: boolean
): string {
  const node = flattenForLayers(roots).find((x) => x.el.id === pathLayerId)?.el
  if (!node || node.type !== 'path') return ''
  const attrs = sampleMergedAttrsForElement(node, tracks, timeSec, useGsapDriver)
  const d = attrs.d
  return typeof d === 'string' && d.trim().length > 0 ? d : ''
}

export function RightInspector() {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const project = useEditorStore((s) => s.project)
  const elements = project.elements
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const updateTransform = useEditorStore((s) => s.updateTransform)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const setElementAttrs = useEditorStore((s) => s.setElementAttrs)
  const setElementNoise = useEditorStore((s) => s.setElementNoise)
  const setElementTextureBrush = useEditorStore((s) => s.setElementTextureBrush)
  const upsertKeyframe = useEditorStore((s) => s.upsertKeyframe)
  const setTracks = useEditorStore((s) => s.setTracks)
  const duration = useEditorStore((s) => s.duration)
  const upsertGradient = useEditorStore((s) => s.upsertGradient)
  const applyBooleanOperation = useEditorStore((s) => s.applyBooleanOperation)
  const mode = useEditorStore((s) => s.mode)
  const symbolEditing = useEditorStore((s) => !!s.symbolEditBackup)
  const beginSymbolEdit = useEditorStore((s) => s.beginSymbolEdit)
  const detachSymbolInstance = useEditorStore((s) => s.detachSymbolInstance)
  const gsapCanvasDriver = useEditorStore((s) => s.gsapCanvasDriver)

  const id = selectedIds[0]
  const el = id ? flattenForLayers(elements).find((x) => x.el.id === id)?.el : undefined

  const [morphTargetPathId, setMorphTargetPathId] = useState('')
  const [openSections, setOpenSections] = useState(defaultOpenSections)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const toggleSection = (sectionId: InspectorSectionId) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }
  useEffect(() => {
    setMorphTargetPathId('')
  }, [id])

  const pathLayersForMotion = useMemo(() => {
    return flattenForLayers(elements).filter((x) => x.el.type === 'path')
  }, [elements])

  /**
   * Selection-wide helpers (computed before the single/multi branches so both views
   * can offer Alignment + Shape Builder). They only depend on `selectedIds`, `mode`
   * and the document tree — not on the focused element.
   */
  const canAlignSelection = selectedIds.length > 1 && mode === 'draw'
  const BOOLEAN_TYPES_SET = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline'])
  const canShapeBooleanSelection =
    mode === 'draw' &&
    selectedIds.length >= 2 &&
    selectedIds.every((sid) => {
      const node = flattenForLayers(elements).find((x) => x.el.id === sid)?.el
      return node ? BOOLEAN_TYPES_SET.has(node.type) : false
    })

  const alignSelectedShared = (
    axis: 'x' | 'y',
    anchor: 'start' | 'center' | 'end'
  ) => {
    if (!canAlignSelection) return
    const svg = document.querySelector('.canvas-wrap svg') as SVGSVGElement | null
    if (!svg) return

    const elementMap = new Map(flattenForLayers(elements).map((n) => [n.el.id, n.el]))
    const alignables = selectedIds
      .map((sid) => {
        const node = svg.querySelector(`[data-el-id="${CSS.escape(sid)}"]`) as SVGGraphicsElement | null
        const b = node ? bboxInSvgRootSpace(node, svg) : null
        const elData = elementMap.get(sid)
        if (!b || !elData || elData.locked) return null
        return { id: sid, box: b, el: elData }
      })
      .filter(
        (v): v is { id: string; box: { x: number; y: number; width: number; height: number }; el: VectorElement } =>
          Boolean(v)
      )
    if (alignables.length < 2) return

    const minX = Math.min(...alignables.map((a) => a.box.x))
    const maxX = Math.max(...alignables.map((a) => a.box.x + a.box.width))
    const minY = Math.min(...alignables.map((a) => a.box.y))
    const maxY = Math.max(...alignables.map((a) => a.box.y + a.box.height))
    const targetX = anchor === 'start' ? minX : anchor === 'center' ? (minX + maxX) / 2 : maxX
    const targetY = anchor === 'start' ? minY : anchor === 'center' ? (minY + maxY) / 2 : maxY

    pushHistory()
    for (const a of alignables) {
      if (axis === 'x') {
        const currentAnchor =
          anchor === 'start'
            ? a.box.x
            : anchor === 'center'
              ? a.box.x + a.box.width / 2
              : a.box.x + a.box.width
        const dx = targetX - currentAnchor
        updateTransform(a.id, { x: a.el.transform.x + dx }, { skipHistory: true })
      } else {
        const currentAnchor =
          anchor === 'start'
            ? a.box.y
            : anchor === 'center'
              ? a.box.y + a.box.height / 2
              : a.box.y + a.box.height
        const dy = targetY - currentAnchor
        updateTransform(a.id, { y: a.el.transform.y + dy }, { skipHistory: true })
      }
    }
  }

  if (selectedIds.length === 0) {
    return (
      <aside className="area-inspector">
        <div className="panel-section-title">Inspector</div>
        <p style={{ padding: 12, color: 'var(--text-muted)' }}>Select a layer</p>
      </aside>
    )
  }

  if (selectedIds.length > 1) {
    return (
      <aside className="area-inspector">
        <div className="panel-section-title">Inspector</div>
        <div className="inspector-panel">
          <InspectorCollapsibleSection
            sectionId="layer"
            title="Selection"
            expanded={openSections.layer}
            onToggle={() => toggleSection('layer')}
            info={
              <>
                {selectedIds.length} layers selected. Group wraps siblings (same parent or root) into one layer so you
                can animate the whole group (transform, opacity, etc.) on the timeline.
                <br />
                <br />
                Shortcuts: ⌘⇧G / Ctrl+Shift+G (group) · ⌘D / Ctrl+D (duplicate)
              </>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className="primary"
                disabled={mode === 'preview' || mode === 'export'}
                onClick={() => useEditorStore.getState().groupSelection()}
              >
                Group selection
              </button>
              <button
                type="button"
                disabled={mode === 'preview' || mode === 'export'}
                onClick={() => useEditorStore.getState().duplicateSelection()}
              >
                Duplicate selection
              </button>
            </div>
          </InspectorCollapsibleSection>

          <InspectorCollapsibleSection
            sectionId="layout"
            title="Layout"
            expanded={openSections.layout}
            onToggle={() => toggleSection('layout')}
            info={
              <>
                Align distributes the selected layers against the bounding box of the
                whole selection. Shape Builder performs boolean operations and requires
                only shape-like layer types (path, rect, circle, ellipse, line,
                polygon/polyline) in <strong>Draw</strong> mode.
              </>
            }
          >
            <div className="inspector-subsection-title">Alignment</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              <button type="button" disabled={!canAlignSelection} onClick={() => alignSelectedShared('x', 'start')}>Left</button>
              <button type="button" disabled={!canAlignSelection} onClick={() => alignSelectedShared('x', 'center')}>Center</button>
              <button type="button" disabled={!canAlignSelection} onClick={() => alignSelectedShared('x', 'end')}>Right</button>
              <button type="button" disabled={!canAlignSelection} onClick={() => alignSelectedShared('y', 'start')}>Top</button>
              <button type="button" disabled={!canAlignSelection} onClick={() => alignSelectedShared('y', 'center')}>Middle</button>
              <button type="button" disabled={!canAlignSelection} onClick={() => alignSelectedShared('y', 'end')}>Bottom</button>
            </div>

            <div className="inspector-subsection-title">Shape builder</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              <button
                type="button"
                disabled={!canShapeBooleanSelection}
                onClick={() => applyBooleanOperation('union')}
              >
                Merge
              </button>
              <button
                type="button"
                disabled={!canShapeBooleanSelection}
                onClick={() => applyBooleanOperation('subtract')}
              >
                Subtract
              </button>
              <button
                type="button"
                disabled={!canShapeBooleanSelection}
                onClick={() => applyBooleanOperation('intersect')}
              >
                Intersect
              </button>
              <button
                type="button"
                disabled={!canShapeBooleanSelection}
                onClick={() => applyBooleanOperation('xor')}
              >
                Exclude
              </button>
            </div>
          </InspectorCollapsibleSection>
        </div>
      </aside>
    )
  }

  if (!el) {
    return (
      <aside className="area-inspector">
        <div className="panel-section-title">Inspector</div>
        <p style={{ padding: 12, color: 'var(--text-muted)' }}>Select a layer</p>
      </aside>
    )
  }

  /** Draw / Animate / Preview: editable; Export dialog mode: read-only. */
  const attrsUiLocked = el.locked || mode === 'export'

  const tr =
    mode === 'draw'
      ? el.transform
      : sampleMergedTransformForElement(el, elements, tracks, currentTime, gsapCanvasDriver)
  const fillValue = typeof el.attrs.fill === 'string' ? el.attrs.fill : '#d1d5db'
  const fillNone = fillValue === 'none' || fillValue === 'transparent'
  const fillUrlMatch =
    typeof el.attrs.fill === 'string' ? /^url\(#([^)]+)\)$/.exec(el.attrs.fill) : null
  const gradientRefId = fillUrlMatch?.[1]
  const activeGradient = gradientRefId
    ? project.gradients.find((g) => g.id === gradientRefId)
    : undefined
  const fillMode: 'none' | 'solid' | 'linear' | 'radial' = fillNone
    ? 'none'
    : activeGradient?.kind === 'linear'
      ? 'linear'
      : activeGradient?.kind === 'radial'
        ? 'radial'
        : 'solid'
  const solidFillHex =
    fillMode === 'solid' && typeof fillValue === 'string' && fillValue.startsWith('#')
      ? fillValue
      : '#d1d5db'
  const strokeValue = typeof el.attrs.stroke === 'string' ? el.attrs.stroke : '#5b8def'
  const strokeWidthValue =
    typeof el.attrs['stroke-width'] === 'number'
      ? el.attrs['stroke-width']
      : Number(el.attrs['stroke-width'] ?? 2)
  const textContent =
    typeof el.attrs.__textContent === 'string' ? el.attrs.__textContent : ''
  const fontSizeValue =
    typeof el.attrs['font-size'] === 'number'
      ? el.attrs['font-size']
      : Number(el.attrs['font-size'] ?? 24)
  const fontWeightValue =
    typeof el.attrs['font-weight'] === 'number'
      ? el.attrs['font-weight']
      : Number(el.attrs['font-weight'] ?? 400)
  const cornerRadiusXValue =
    typeof el.attrs.rx === 'number' ? el.attrs.rx : Number(el.attrs.rx ?? 0)
  const cornerRadiusYValue =
    typeof el.attrs.ry === 'number' ? el.attrs.ry : Number(el.attrs.ry ?? 0)
  const canCornerRadius = el.type === 'rect'
  const canTypography = el.type === 'text'
  /** Alias the selection-wide helpers so the existing single-element JSX keeps reading naturally. */
  const canAlign = canAlignSelection
  const canShapeBoolean = canShapeBooleanSelection
  const isSymbolInstance = el.type === 'symbolInstance'
  const symbolMaster =
    isSymbolInstance && typeof el.attrs.__symbolId === 'string'
      ? project.symbols.find((s) => s.id === el.attrs.__symbolId)
      : undefined
  const canFillGradient =
    !isSymbolInstance &&
    ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text'].includes(el.type)

  const applyFillMode = (m: 'none' | 'solid' | 'linear' | 'radial') => {
    if (attrsUiLocked) return
    if (m === 'none') {
      setElementAttrs(el.id, { fill: 'none' })
      return
    }
    if (m === 'solid') {
      setElementAttrs(el.id, { fill: solidFillHex })
      return
    }
    const base =
      typeof el.attrs.fill === 'string' && el.attrs.fill.startsWith('#')
        ? el.attrs.fill
        : '#d1d5db'
    const gid = `grad_${nanoid(8)}`
    if (m === 'linear') {
      const def: LinearGradientDef = {
        id: gid,
        kind: 'linear',
        x1: 0,
        y1: 0,
        x2: project.width,
        y2: 0,
        gradientUnits: 'userSpaceOnUse',
        stops: [
          { offset: 0, color: base },
          { offset: 1, color: '#5b8def' }
        ]
      }
      upsertGradient(def)
      setElementAttrs(el.id, { fill: `url(#${gid})` })
      return
    }
    const defR: RadialGradientDef = {
      id: gid,
      kind: 'radial',
      cx: project.width / 2,
      cy: project.height / 2,
      r: Math.min(project.width, project.height) / 2,
      gradientUnits: 'userSpaceOnUse',
      stops: [
        { offset: 0, color: base },
        { offset: 1, color: '#5b8def' }
      ]
    }
    upsertGradient(defR)
    setElementAttrs(el.id, { fill: `url(#${gid})` })
  }

  const patchGradientStop = (idx: number, patch: { color?: string; offset?: number }) => {
    if (!activeGradient || el.locked) return
    const stops = activeGradient.stops.map((s, i) =>
      i === idx ? { ...s, ...patch } : s
    )
    upsertGradient({ ...activeGradient, stops })
  }

  const patchLinearAxes = (partial: Partial<Pick<LinearGradientDef, 'x1' | 'y1' | 'x2' | 'y2'>>) => {
    if (activeGradient?.kind !== 'linear') return
    upsertGradient({ ...activeGradient, ...partial })
  }

  const patchRadial = (partial: Partial<Pick<RadialGradientDef, 'cx' | 'cy' | 'r'>>) => {
    if (activeGradient?.kind !== 'radial') return
    upsertGradient({ ...activeGradient, ...partial })
  }

  const motionPathActive =
    typeof el.attrs.__motionPathId === 'string' &&
    el.attrs.__motionPathId.trim() !== ''

  const numAttr = (key: string, fallback = 0) => {
    const raw = el.attrs[key]
    const n = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(n) ? n : fallback
  }

  type PropKey = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'skewX' | 'skewY' | 'opacity'
  const transformKeysByType: Record<typeof el.type, PropKey[]> = {
    group: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    path: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    rect: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    circle: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    ellipse: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    line: ['x', 'y', 'rotation', 'opacity'],
    text: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    image: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'],
    polygon: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    polyline: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'opacity'],
    symbolInstance: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']
  }
  const activeTransformKeys = transformKeysByType[el.type]
  const transformLabel: Record<PropKey, string> = {
    x: 'X',
    y: 'Y',
    scaleX: 'Scale X',
    scaleY: 'Scale Y',
    rotation: 'Rotation',
    skewX: 'Skew X',
    skewY: 'Skew Y',
    opacity: 'Opacity'
  }

  const row = (label: string, key: PropKey) => (
    <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="number"
        step={key === 'opacity' ? 0.05 : key === 'rotation' ? 1 : 1}
        value={Number(tr[key].toFixed(4))}
        disabled={attrsUiLocked}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) updateTransform(el.id, { [key]: v })
        }}
      />
    </label>
  )

  const blurFx = Math.max(0, numAttr('__fxBlur', 0))
  const shadowXFx = numAttr('__fxShadowX', 0)
  const shadowYFx = numAttr('__fxShadowY', 0)
  const shadowBlurFx = Math.max(0, numAttr('__fxShadowBlur', 0))
  const shadowColorFx =
    typeof el.attrs.__fxShadowColor === 'string' ? el.attrs.__fxShadowColor : '#000000'
  const effectsActive =
    blurFx > 0 || shadowBlurFx > 0 || Math.abs(shadowXFx) > 0 || Math.abs(shadowYFx) > 0

  /** Single-element view reuses the shared alignment routine. */
  const alignSelected = alignSelectedShared

  const geometryTypeOnlyTransform = ['group', 'polygon', 'polyline', 'text'].includes(el.type)
  const geometrySectionDisabled = attrsUiLocked || geometryTypeOnlyTransform
  const geometrySectionReason = el.locked
    ? 'Layer is locked.'
    : mode === 'export'
      ? 'Export mode is read-only.'
      : geometryTypeOnlyTransform
        ? 'This layer type has no separate geometry fields—use Transform.'
        : undefined
  const appearanceSectionDisabled = isSymbolInstance || attrsUiLocked
  const appearanceSectionReason = isSymbolInstance
    ? 'Edit appearance on the symbol master.'
    : el.locked
      ? 'Layer is locked.'
      : mode === 'export'
        ? 'Export mode is read-only.'
        : undefined
  const typographySectionDisabled = !canTypography
  const typographySectionReason = 'Typography applies to text layers only.'

  return (
    <aside className="area-inspector">
      <div className="inspector-panel">
        <InspectorCollapsibleSection
          sectionId="layer"
          title="Layer"
          expanded={openSections.layer}
          onToggle={() => toggleSection('layer')}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              disabled={mode === 'preview' || mode === 'export'}
              onClick={() => useEditorStore.getState().duplicateSelection()}
              style={{ fontSize: 12 }}
            >
              Duplicate layer
            </button>
          </div>
        </InspectorCollapsibleSection>
        <InspectorCollapsibleSection
          sectionId="transform"
          title="Transform"
          expanded={openSections.transform}
          onToggle={() => toggleSection('transform')}
          disabled={attrsUiLocked}
          disabledReason={
            el.locked ? 'Layer is locked.' : mode === 'export' ? 'Export mode is read-only.' : undefined
          }
          info={
            motionPathActive ? (
              <>
                Motion path is active. The layer rides along the guide path; <strong>X/Y</strong> now act as a
                constant offset added on top of the path point. Set them to 0 to snap exactly onto the path.
              </>
            ) : undefined
          }
        >
          {activeTransformKeys.map((key) => row(transformLabel[key], key))}
        </InspectorCollapsibleSection>
        {(
          <InspectorCollapsibleSection
            sectionId="animation"
            title="Animation"
            expanded={openSections.animation}
            onToggle={() => toggleSection('animation')}
            disabled={attrsUiLocked}
            disabledReason={
              el.locked ? 'Layer is locked.' : mode === 'export' ? 'Export mode is read-only.' : undefined
            }
            info={
              <>
                Motion path and path morph controls. Offset keyframes require{' '}
                <strong>Animate</strong> or <strong>Preview</strong> mode.
                {isSymbolInstance && (
                  <>
                    <br />
                    <br />
                    For symbol instances the motion path drives the whole instance on the main
                    canvas. The symbol's own internal animation (set on the symbol master) still
                    plays inside the instance.
                  </>
                )}
              </>
            }
          >
            <button
              type="button"
              className="primary"
              disabled={attrsUiLocked}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                width: '100%',
                marginBottom: 10
              }}
              onClick={() => setPresetsOpen(true)}
            >
              <FontAwesomeIcon icon={faWandMagicSparkles} />
              Browse animation presets…
            </button>
            <div className="inspector-subsection-title">Motion path</div>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Guide path</span>
              <select
                value={
                  typeof el.attrs.__motionPathId === 'string' ? el.attrs.__motionPathId : ''
                }
                disabled={attrsUiLocked}
                onChange={(e) => {
                  const nextId = e.target.value || ''
                  const prevId =
                    typeof el.attrs.__motionPathId === 'string' ? el.attrs.__motionPathId : ''
                  if (prevId === nextId) return
                  const flat = flattenForLayers(elements)
                  const getAnchor = (pathId: string): { x: number; y: number } | null => {
                    if (!pathId) return null
                    const pathEl = flat.find((x) => x.el.id === pathId)?.el
                    if (!pathEl || pathEl.type !== 'path') return null
                    const dAttr = typeof pathEl.attrs.d === 'string' ? pathEl.attrs.d : ''
                    if (!dAttr) return null
                    try {
                      const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path')
                      tmp.setAttribute('d', dAttr)
                      const pt = tmp.getPointAtLength(0)
                      return {
                        x: (pathEl.transform?.x ?? 0) + pt.x,
                        y: (pathEl.transform?.y ?? 0) + pt.y
                      }
                    } catch {
                      return null
                    }
                  }
                  /**
                   * Motion path translates a layer by treating `(tr.x, tr.y)` as a
                   * USER offset from the path anchor (see motionPathApply.ts), so
                   * the three transitions below need different bookkeeping:
                   *
                   *   1. none → path  Clear `(tr.x, tr.y)` so the element snaps to
                   *      the path start. This also wipes any pivot-preserving
                   *      compensation that `updateTransform` may have baked into
                   *      x/y from earlier rotation/scale changes — otherwise that
                   *      compensation would be treated as user-nudge and yank the
                   *      element off-canvas (the rotated-rect bug).
                   *   2. path → path  Preserve the current visual position by
                   *      shifting `(tr.x, tr.y)` by `(prevAnchor − nextAnchor)`.
                   *   3. path → none  Promote the anchor-relative offset back to
                   *      absolute coordinates so the element stays where it last
                   *      rendered, instead of teleporting to (0, 0).
                   */
                  setElementAttrs(el.id, { __motionPathId: nextId })
                  if (!prevId && nextId) {
                    updateTransform(el.id, { x: 0, y: 0 })
                  } else if (prevId && nextId) {
                    const prevAnchor = getAnchor(prevId) ?? { x: 0, y: 0 }
                    const nextAnchor = getAnchor(nextId) ?? { x: 0, y: 0 }
                    updateTransform(el.id, {
                      x: tr.x + (prevAnchor.x - nextAnchor.x),
                      y: tr.y + (prevAnchor.y - nextAnchor.y)
                    })
                  } else if (prevId && !nextId) {
                    /**
                     * Detach: convert anchor-relative offset to absolute world
                     * coords. We also subtract the rotation/scale-induced shift
                     * of the local-bbox centre from the local origin so the
                     * element doesn't visibly jump by that vector when the path
                     * is removed (motion-path mode pivots about the centre,
                     * pathless mode renders from the local origin).
                     */
                    const prevAnchor = getAnchor(prevId) ?? { x: 0, y: 0 }
                    const center = getLocalShapeCenter(el)
                    let dxFromOrigin = 0
                    let dyFromOrigin = 0
                    if (center) {
                      const rad = (tr.rotation * Math.PI) / 180
                      const cosR = Math.cos(rad)
                      const sinR = Math.sin(rad)
                      const cxs = center.x * tr.scaleX
                      const cys = center.y * tr.scaleY
                      dxFromOrigin = cxs * cosR - cys * sinR
                      dyFromOrigin = cxs * sinR + cys * cosR
                    }
                    updateTransform(el.id, {
                      x: tr.x + prevAnchor.x - dxFromOrigin,
                      y: tr.y + prevAnchor.y - dyFromOrigin
                    })
                  }
                }}
                style={{ maxWidth: '100%' }}
              >
                <option value="">None</option>
                {pathLayersForMotion
                  .filter((p) => p.el.id !== el.id)
                  .map((p) => (
                    <option key={p.el.id} value={p.el.id}>
                      {p.el.name || 'Path'} · {p.el.id}
                    </option>
                  ))}
              </select>
            </label>
            {typeof el.attrs.__motionPathId === 'string' &&
              el.attrs.__motionPathId !== '' &&
              !pathLayersForMotion.some((p) => p.el.id === el.attrs.__motionPathId) && (
                <p style={{ fontSize: 11, color: 'var(--danger)', margin: '0 0 8px' }}>
                  Guide path is missing or not a path layer — choose another in the list.
                </p>
              )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={el.attrs.__motionPathRotate === true || el.attrs.__motionPathRotate === 1}
                disabled={attrsUiLocked || !el.attrs.__motionPathId}
                onChange={(e) => setElementAttrs(el.id, { __motionPathRotate: e.target.checked })}
              />
              <span style={{ fontSize: 12 }}>Rotate to path tangent</span>
            </label>
            {(() => {
              if (!el.attrs.__motionPathId || typeof el.attrs.__motionPathId !== 'string') return null
              const offsetTrack = tracks.find(
                (t) => t.elementId === el.id && t.property === 'motionPathOffset'
              )
              const sampled =
                offsetTrack && offsetTrack.keyframes.length > 0
                  ? (sampleTrack(offsetTrack, currentTime) ?? 0)
                  : 0
              const offsetVal = Math.max(0, Math.min(1, sampled))
              const canKey = mode === 'animate' || mode === 'preview'
              const conflictingTransformTracks = tracks.filter(
                (t) =>
                  t.elementId === el.id &&
                  t.keyframes.length > 0 &&
                  (t.property === 'x' || t.property === 'y' || t.property === 'rotation')
              )
              const replaceMotionTracks = (next: { time: number; value: number }[]) => {
                const others = useEditorStore
                  .getState()
                  .tracks.filter((t) => !(t.elementId === el.id && t.property === 'motionPathOffset'))
                if (next.length === 0) {
                  setTracks(others)
                  return
                }
                const newTrack = {
                  id: nanoid(8),
                  elementId: el.id,
                  property: 'motionPathOffset' as const,
                  keyframes: next.map((k) => ({
                    id: nanoid(8),
                    time: Math.max(0, Math.min(duration, k.time)),
                    value: Math.max(0, Math.min(1, k.value))
                  }))
                }
                setTracks([...others, newTrack])
              }
              const clearTransformKeysForElement = () => {
                const next = useEditorStore
                  .getState()
                  .tracks.filter(
                    (t) =>
                      !(
                        t.elementId === el.id &&
                        (t.property === 'x' || t.property === 'y' || t.property === 'rotation')
                      )
                  )
                setTracks(next)
              }
              return (
                <>
                  {!canKey ? (
                    <p className="inspector-section-hint">Switch to Animate or Preview to edit motion offset keyframes.</p>
                  ) : null}
                  <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <Tooltip content="0 = path start, 1 = path end">
                      <span style={{ color: 'var(--text-muted)' }}>Offset</span>
                    </Tooltip>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={offsetVal}
                        disabled={attrsUiLocked || !canKey}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(1, Number(e.target.value)))
                          upsertKeyframe(el.id, 'motionPathOffset', currentTime, v)
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={Number(offsetVal.toFixed(3))}
                        disabled={attrsUiLocked || !canKey}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(1, Number(e.target.value)))
                          if (Number.isFinite(v)) upsertKeyframe(el.id, 'motionPathOffset', currentTime, v)
                        }}
                        style={{ width: 64 }}
                      />
                    </div>
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    <Tooltip content="Replace existing offset keyframes with 0 at start and 1 at end of timeline">
                      <button
                        type="button"
                        disabled={attrsUiLocked || !canKey || duration <= 0}
                        onClick={() => {
                          replaceMotionTracks([
                            { time: 0, value: 0 },
                            { time: duration, value: 1 }
                          ])
                        }}
                      >
                        Set 0→1 over duration
                      </button>
                    </Tooltip>
                    <Tooltip content="Add a keyframe at the playhead with the current offset">
                      <button
                        type="button"
                        disabled={attrsUiLocked || !canKey}
                        onClick={() => upsertKeyframe(el.id, 'motionPathOffset', currentTime, offsetVal)}
                      >
                        + Keyframe
                      </button>
                    </Tooltip>
                    <Tooltip content="Remove all motion offset keyframes for this layer">
                      <button
                        type="button"
                        disabled={
                          attrsUiLocked || !offsetTrack || (offsetTrack?.keyframes.length ?? 0) === 0
                        }
                        onClick={() => replaceMotionTracks([])}
                      >
                        Clear offset keys
                      </button>
                    </Tooltip>
                    <Tooltip content="Reset X/Y/rotation to 0 (and remove their keyframes) so this layer sits exactly on the path">
                      <button
                        type="button"
                        disabled={attrsUiLocked}
                        onClick={() => {
                          pushHistory()
                          updateTransform(el.id, { x: 0, y: 0, rotation: 0 }, { skipHistory: true })
                          clearTransformKeysForElement()
                        }}
                      >
                        Snap onto path
                      </button>
                    </Tooltip>
                  </div>
                  {conflictingTransformTracks.length > 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        background: 'rgba(255,180,0,0.08)',
                        border: '1px solid rgba(255,180,0,0.35)',
                        borderRadius: 6,
                        padding: '6px 8px',
                        marginBottom: 8,
                        lineHeight: 1.45
                      }}
                    >
                      <strong>Heads up:</strong> this layer has{' '}
                      {conflictingTransformTracks.map((t) => t.property).join(' / ')} keyframes that
                      animate position/rotation alongside the motion path — usually one or the
                      other, not both.
                      <button
                        type="button"
                        style={{
                          display: 'block',
                          marginTop: 6,
                          fontSize: 11,
                          padding: '3px 8px'
                        }}
                        disabled={attrsUiLocked}
                        onClick={clearTransformKeysForElement}
                      >
                        Clear x / y / rotation keyframes for this layer
                      </button>
                    </div>
                  )}
                </>
              )
            })()}
          </InspectorCollapsibleSection>
        )}
        <InspectorCollapsibleSection
          sectionId="noise"
          title="Noise"
          expanded={openSections.noise}
          onToggle={() => toggleSection('noise')}
          info={
            <>
              Adds smooth pseudo-random "wiggle" to a transform property while the
              playhead is inside the noise window. Layered on top of any keyframes,
              so use it to add organic jitter, idle motion, camera shake, etc.
              <br />
              <br />
              Each entry has a property, a time range (from / to in seconds), a
              value range (min / max) the wobble oscillates between, and a
              frequency in Hz.
            </>
          }
        >
          <NoiseEditor
            element={el}
            projectDuration={duration}
            onChange={(next) => setElementNoise(el.id, next)}
            disabled={attrsUiLocked}
          />
        </InspectorCollapsibleSection>
        {TEXTURE_BRUSH_ELIGIBLE_TYPES.includes(el.type) && (
          <InspectorCollapsibleSection
            sectionId="texture"
            title="Texture brush"
            expanded={openSections.texture}
            onToggle={() => toggleSection('texture')}
            info={
              <>
                Treats this path as a guide and lays small stamp shapes along
                it — pencil, charcoal, brush, marker, crayon, ink, fur or
                grass. Each stamp rotates with the path tangent and randomises
                its scale / scatter / opacity, so a curve looks like a real
                stroke instead of a vector line.
                <br />
                <br />
                Tip: set the host's stroke colour to <code>none</code> to leave
                only the texture, or keep a stroke for a layered "ink over
                line" look.
              </>
            }
          >
            <TextureBrushEditor
              element={el}
              onChange={(next) => setElementTextureBrush(el.id, next)}
              disabled={attrsUiLocked}
            />
          </InspectorCollapsibleSection>
        )}
        {isSymbolInstance ? (
          <InspectorCollapsibleSection
            sectionId="symbol"
            title={symbolMaster ? `Symbol · ${symbolMaster.name}` : 'Symbol instance'}
            expanded={openSections.symbol}
            onToggle={() => toggleSection('symbol')}
            info={
              symbolMaster ? (
                <>
                  Symbol instance linked to master <strong>{symbolMaster.name}</strong>. Edits to the master apply
                  to every instance.
                </>
              ) : (
                <>Symbol instance with a missing master.</>
              )
            }
          >
            {symbolMaster ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Tooltip
                  content={
                    symbolEditing
                      ? 'Finish symbol editing first'
                      : 'Open symbol master on its own canvas'
                  }
                >
                  <button
                    type="button"
                    className="primary"
                    disabled={el.locked || symbolEditing || mode !== 'draw'}
                    onClick={() => beginSymbolEdit(symbolMaster.id)}
                  >
                    Edit symbol…
                  </button>
                </Tooltip>
                <Tooltip
                  content={
                    symbolEditing
                      ? 'Finish symbol editing first'
                      : 'Turn into normal group (no longer linked)'
                  }
                >
                  <button
                    type="button"
                    disabled={el.locked || symbolEditing || mode !== 'draw'}
                    onClick={() => detachSymbolInstance(el.id)}
                  >
                    Detach instance
                  </button>
                </Tooltip>
              </div>
            ) : (
              <p className="inspector-section-hint">Symbol master not found.</p>
            )}
          </InspectorCollapsibleSection>
        ) : null}
        {!isSymbolInstance ? (
          <InspectorCollapsibleSection
            sectionId="geometry"
            title="Geometry"
            expanded={openSections.geometry}
            onToggle={() => toggleSection('geometry')}
            disabled={geometrySectionDisabled}
            disabledReason={geometrySectionReason}
            info={
              geometryTypeOnlyTransform ? <>Use transform controls for this layer type.</> : undefined
            }
          >
            {canCornerRadius ? (
              <>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Corner RX</span>
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(cornerRadiusXValue) ? cornerRadiusXValue : 0}
                disabled={attrsUiLocked}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) {
                    setElementAttrs(el.id, { rx: Math.max(0, v) })
                  }
                }}
              />
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>RY</span>
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(cornerRadiusYValue) ? cornerRadiusYValue : 0}
                disabled={attrsUiLocked}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) {
                    setElementAttrs(el.id, { ry: Math.max(0, v) })
                  }
                }}
              />
            </label>
              </>
            ) : null}
            {el.type === 'rect' && (
              <>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Width</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.max(1, numAttr('width', 1))}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) setElementAttrs(el.id, { width: Math.max(1, v) })
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Height</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.max(1, numAttr('height', 1))}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) setElementAttrs(el.id, { height: Math.max(1, v) })
                    }}
                  />
                </label>
              </>
            )}
            {el.type === 'circle' && (
              <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Radius</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={Math.max(1, numAttr('r', 1))}
                  disabled={attrsUiLocked}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setElementAttrs(el.id, { r: Math.max(1, v) })
                  }}
                />
              </label>
            )}
            {el.type === 'ellipse' && (
              <>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>RX</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.max(1, numAttr('rx', 1))}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) setElementAttrs(el.id, { rx: Math.max(1, v) })
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>RY</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.max(1, numAttr('ry', 1))}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) setElementAttrs(el.id, { ry: Math.max(1, v) })
                    }}
                  />
                </label>
              </>
            )}
            {el.type === 'line' && (
              <>
                {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
                  <label key={k} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: k !== 'y2' ? 8 : 0 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{k.toUpperCase()}</span>
                    <input
                      type="number"
                      step={1}
                      value={numAttr(k, 0)}
                      disabled={attrsUiLocked}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isFinite(v)) setElementAttrs(el.id, { [k]: v })
                      }}
                    />
                  </label>
                ))}
              </>
            )}
            {el.type === 'image' && (
              <>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Width</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.max(1, numAttr('width', 1))}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) setElementAttrs(el.id, { width: Math.max(1, v) })
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Height</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Math.max(1, numAttr('height', 1))}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) setElementAttrs(el.id, { height: Math.max(1, v) })
                    }}
                  />
                </label>
              </>
            )}
            {el.type === 'path' && (
              <>
                <div className="inspector-subsection-title">Path editing</div>
                <p className="inspector-section-hint">Use Path Edit (Draw) to change points and curves.</p>
                {!isSymbolInstance && (
                  <>
                    <div className="inspector-subsection-header">
                      <div className="inspector-subsection-title">Path morph</div>
                      <InspectorHelpIcon label="About path morph">
                        <>
                          Animate the <code style={{ fontSize: 10 }}>d</code> attribute between keyframes on the{' '}
                          <strong>pathD</strong> timeline track. Shapes blend approximately (same point count along
                          length works best). Transforms are separate: align layers in Draw if needed.
                          <br />
                          <br />
                          <strong>Point animation:</strong> in <strong>Animate</strong> or <strong>Preview</strong>,
                          use <strong>Path Edit (N)</strong>, scrub the playhead, drag anchors or handles, then release
                          — a <strong>pathD</strong> keyframe is saved at that time. Scrub again, reshape, release for
                          the next pose; playback morphs between those shapes.
                          <br />
                          <br />
                          Switch to <strong>Animate</strong> or <strong>Preview</strong> to edit path morph keys.
                        </>
                      </InspectorHelpIcon>
                    </div>
                    <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Morph toward</span>
                      <select
                        value={morphTargetPathId}
                        disabled={attrsUiLocked}
                        onChange={(e) => setMorphTargetPathId(e.target.value)}
                        style={{ maxWidth: '100%' }}
                      >
                        <option value="">Choose a path…</option>
                        {pathLayersForMotion
                          .filter((p) => p.el.id !== el.id)
                          .map((p) => (
                            <option key={p.el.id} value={p.el.id}>
                              {p.el.name || 'Path'} · {p.el.id}
                            </option>
                          ))}
                      </select>
                    </label>
                    {(() => {
                      const canKey = mode === 'animate' || mode === 'preview'
                      const pathDTrack = tracks.find((t) => t.elementId === el.id && t.property === 'pathD')
                      const dSelf0 = mergedPathDForLayer(elements, tracks, el.id, 0, gsapCanvasDriver)
                      const dTargetEnd =
                        morphTargetPathId.length > 0
                          ? mergedPathDForLayer(elements, tracks, morphTargetPathId, duration, gsapCanvasDriver)
                          : ''
                      const replacePathDMorphKeys = (next: { time: number; valueText: string }[]) => {
                        const others = useEditorStore
                          .getState()
                          .tracks.filter((t) => !(t.elementId === el.id && t.property === 'pathD'))
                        if (next.length === 0) {
                          setTracks(others)
                          return
                        }
                        setTracks([
                          ...others,
                          {
                            id: nanoid(8),
                            elementId: el.id,
                            property: 'pathD',
                            keyframes: next.map((k) => ({
                              id: nanoid(8),
                              time: Math.max(0, Math.min(duration, k.time)),
                              value: 0,
                              valueText: k.valueText
                            }))
                          }
                        ])
                      }
                      const dSelfAtPlayhead = mergedPathDForLayer(elements, tracks, el.id, currentTime, gsapCanvasDriver)
                      const dTargetAtPlayhead =
                        morphTargetPathId.length > 0
                          ? mergedPathDForLayer(elements, tracks, morphTargetPathId, currentTime, gsapCanvasDriver)
                          : ''
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                          {!canKey ? (
                            <p className="inspector-section-hint">Switch to Animate or Preview to edit path morph keyframes.</p>
                          ) : null}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Tooltip content="Replace pathD keys: this layer at t=0 → target path’s shape at t=duration">
                              <button
                                type="button"
                                disabled={
                                  attrsUiLocked ||
                                  !canKey ||
                                  duration <= 0 ||
                                  !morphTargetPathId ||
                                  !dSelf0 ||
                                  !dTargetEnd
                                }
                                onClick={() => {
                                  replacePathDMorphKeys([
                                    { time: 0, valueText: dSelf0 },
                                    { time: duration, valueText: dTargetEnd }
                                  ])
                                }}
                              >
                                Morph to target over duration
                              </button>
                            </Tooltip>
                            <Tooltip content="pathD keyframe at playhead with this layer’s current shape">
                              <button
                                type="button"
                                disabled={attrsUiLocked || !canKey || !dSelfAtPlayhead}
                                onClick={() =>
                                  upsertKeyframe(el.id, 'pathD', currentTime, 0, undefined, {
                                    valueText: dSelfAtPlayhead
                                  })
                                }
                              >
                                + Keyframe this shape
                              </button>
                            </Tooltip>
                            <Tooltip content="pathD keyframe at playhead using the target path’s shape (same timeline time)">
                              <button
                                type="button"
                                disabled={
                                  attrsUiLocked || !canKey || !morphTargetPathId || !dTargetAtPlayhead
                                }
                                onClick={() =>
                                  upsertKeyframe(el.id, 'pathD', currentTime, 0, undefined, {
                                    valueText: dTargetAtPlayhead
                                  })
                                }
                              >
                                + Keyframe target shape
                              </button>
                            </Tooltip>
                            <Tooltip content="Remove all pathD keyframes for this layer">
                              <button
                                type="button"
                                disabled={
                                  attrsUiLocked || !pathDTrack || pathDTrack.keyframes.length === 0
                                }
                                onClick={() => replacePathDMorphKeys([])}
                              >
                                Clear pathD keys
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}
              </>
            )}
          </InspectorCollapsibleSection>
        ) : null}

        {!isSymbolInstance ? (
          <InspectorCollapsibleSection
            sectionId="appearance"
            title="Appearance"
            expanded={openSections.appearance}
            onToggle={() => toggleSection('appearance')}
            disabled={appearanceSectionDisabled}
            disabledReason={appearanceSectionReason}
          >
            <div className="inspector-subsection-title">Fill</div>
        {canFillGradient && (
          <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>Fill</span>
            <select
              value={fillMode}
              disabled={attrsUiLocked}
              onChange={(e) => applyFillMode(e.target.value as 'none' | 'solid' | 'linear' | 'radial')}
            >
              <option value="none">No fill</option>
              <option value="solid">Solid</option>
              <option value="linear">Linear gradient</option>
              <option value="radial">Radial gradient</option>
            </select>
          </label>
        )}
        {fillMode === 'solid' && (
          <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Color</span>
            <input
              type="color"
              value={solidFillHex}
              disabled={attrsUiLocked}
              onChange={(e) => setElementAttrs(el.id, { fill: e.target.value })}
            />
          </label>
        )}
        {!canFillGradient && !isSymbolInstance && (
          <>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Style</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={fillNone}
                  disabled={attrsUiLocked}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setElementAttrs(el.id, { fill: 'none' })
                    } else {
                      setElementAttrs(el.id, { fill: '#d1d5db' })
                    }
                  }}
                />
                No Fill
              </label>
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Color</span>
              <input
                type="color"
                value={fillValue.startsWith('#') ? fillValue : '#d1d5db'}
                disabled={attrsUiLocked || fillNone}
                onChange={(e) => setElementAttrs(el.id, { fill: e.target.value })}
              />
            </label>
          </>
        )}
        {(fillMode === 'linear' || fillMode === 'radial') && activeGradient && (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gradient stops</span>
            {activeGradient.stops.slice(0, 2).map((s, idx) => (
              <label key={`stop-${idx}`} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{idx === 0 ? 'Start' : 'End'}</span>
                <input
                  type="color"
                  value={s.color.startsWith('#') ? s.color : '#888888'}
                  disabled={attrsUiLocked}
                  onChange={(e) => patchGradientStop(idx, { color: e.target.value })}
                />
              </label>
            ))}
            {activeGradient.kind === 'linear' && (
              <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>X₂</span>
                <input
                  type="number"
                  step={1}
                  value={activeGradient.x2}
                  disabled={attrsUiLocked}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) patchLinearAxes({ x2: v })
                  }}
                />
              </label>
            )}
            {activeGradient.kind === 'radial' && (
              <>
                <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Radius</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={activeGradient.r}
                    disabled={attrsUiLocked}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) patchRadial({ r: Math.max(1, v) })
                    }}
                  />
                </label>
              </>
            )}
          </div>
        )}

            <div className="inspector-subsection-title">Stroke</div>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Color</span>
              <input
                type="color"
                value={strokeValue.startsWith('#') ? strokeValue : '#5b8def'}
                disabled={attrsUiLocked}
                onChange={(e) => setElementAttrs(el.id, { stroke: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Width</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={Number.isFinite(strokeWidthValue) ? strokeWidthValue : 2}
                disabled={attrsUiLocked}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setElementAttrs(el.id, { 'stroke-width': Math.max(0, v) })
                }}
              />
            </label>

        </InspectorCollapsibleSection>
        ) : null}

        <InspectorCollapsibleSection
          sectionId="typography"
          title="Typography"
          expanded={openSections.typography}
          onToggle={() => toggleSection('typography')}
          disabled={typographySectionDisabled}
          disabledReason={typographySectionReason}
          info={!canTypography ? <>Select a text layer to edit typography.</> : undefined}
        >
        {canTypography ? (
          <>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Content</span>
              <input
                type="text"
                value={textContent}
                disabled={attrsUiLocked}
                onChange={(e) => setElementAttrs(el.id, { __textContent: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Size</span>
              <input
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(fontSizeValue) ? fontSizeValue : 24}
                disabled={attrsUiLocked}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setElementAttrs(el.id, { 'font-size': Math.max(1, v) })
                }}
              />
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Weight</span>
              <input
                type="number"
                min={100}
                max={900}
                step={100}
                value={Number.isFinite(fontWeightValue) ? fontWeightValue : 400}
                disabled={attrsUiLocked}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) {
                    const clamped = Math.max(100, Math.min(900, Math.round(v / 100) * 100))
                    setElementAttrs(el.id, { 'font-weight': clamped })
                  }
                }}
              />
            </label>
          </>
        ) : null}
        </InspectorCollapsibleSection>

        <InspectorCollapsibleSection
          sectionId="effects"
          title="Effects"
          expanded={openSections.effects}
          onToggle={() => toggleSection('effects')}
          disabled={attrsUiLocked}
          disabledReason={el.locked ? 'Layer is locked.' : mode === 'export' ? 'Export mode is read-only.' : undefined}
        >
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Enabled</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={effectsActive}
              disabled={attrsUiLocked}
              onChange={(e) => {
                if (e.target.checked) {
                  setElementAttrs(el.id, {
                    __fxBlur: Math.max(blurFx, 2),
                    __fxShadowX: shadowXFx,
                    __fxShadowY: shadowYFx,
                    __fxShadowBlur: Math.max(shadowBlurFx, 6),
                    __fxShadowColor: shadowColorFx
                  })
                } else {
                  setElementAttrs(el.id, { __fxBlur: 0, __fxShadowX: 0, __fxShadowY: 0, __fxShadowBlur: 0 })
                }
              }}
            />
            Apply effects
          </label>
        </label>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Blur</span>
          <div className="slider-group">
            <input
              type="range"
              min={0}
              max={30}
              step={0.5}
              value={blurFx}
              disabled={attrsUiLocked}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) setElementAttrs(el.id, { __fxBlur: Math.max(0, v) })
              }}
            />
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={Number(blurFx.toFixed(2))}
              disabled={attrsUiLocked}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) {
                  setElementAttrs(el.id, { __fxBlur: Math.max(0, Math.min(30, v)) })
                }
              }}
            />
          </div>
        </label>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Shadow</span>
          <input
            type="color"
            value={shadowColorFx.startsWith('#') ? shadowColorFx : '#000000'}
            disabled={attrsUiLocked || !effectsActive}
            onChange={(e) => setElementAttrs(el.id, { __fxShadowColor: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Offset X</span>
          <input
            type="number"
            step={1}
            value={shadowXFx}
            disabled={attrsUiLocked || !effectsActive}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) setElementAttrs(el.id, { __fxShadowX: v })
            }}
          />
        </label>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Offset Y</span>
          <input
            type="number"
            step={1}
            value={shadowYFx}
            disabled={attrsUiLocked || !effectsActive}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) setElementAttrs(el.id, { __fxShadowY: v })
            }}
          />
        </label>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Spread</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={shadowBlurFx}
            disabled={attrsUiLocked || !effectsActive}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) setElementAttrs(el.id, { __fxShadowBlur: Math.max(0, v) })
            }}
          />
        </label>

        </InspectorCollapsibleSection>

        {!isSymbolInstance ? (
          <InspectorCollapsibleSection
            sectionId="advanced"
            title="Mask / clip / SVG filter"
            expanded={openSections.advanced}
            onToggle={() => toggleSection('advanced')}
            disabled={attrsUiLocked}
            disabledReason={el.locked ? 'Layer is locked.' : mode === 'export' ? 'Export mode is read-only.' : undefined}
            info={
              <>
                Presentation attributes (e.g. <code style={{ fontSize: 10 }}>url(#myMask)</code>). Keyframe{' '}
                <code style={{ fontSize: 10 }}>mask</code>, <code style={{ fontSize: 10 }}>clipPath</code>,{' '}
                <code style={{ fontSize: 10 }}>svgFilter</code> on the timeline.
              </>
            }
          >
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>mask</span>
              <input
                type="text"
                value={typeof el.attrs.mask === 'string' ? el.attrs.mask : ''}
                disabled={attrsUiLocked}
                onChange={(e) => setElementAttrs(el.id, { mask: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>clip-path</span>
              <input
                type="text"
                value={typeof el.attrs['clip-path'] === 'string' ? el.attrs['clip-path'] : ''}
                disabled={attrsUiLocked}
                onChange={(e) => setElementAttrs(el.id, { 'clip-path': e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>filter</span>
              <input
                type="text"
                placeholder='url(#filterId)'
                value={typeof el.attrs.filter === 'string' ? el.attrs.filter : ''}
                disabled={attrsUiLocked}
                onChange={(e) => setElementAttrs(el.id, { filter: e.target.value })}
              />
            </label>
          </InspectorCollapsibleSection>
        ) : null}

        <InspectorCollapsibleSection
          sectionId="layout"
          title="Layout"
          expanded={openSections.layout}
          onToggle={() => toggleSection('layout')}
        >
          <div className="inspector-subsection-title">Alignment</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <button type="button" disabled={!canAlign} onClick={() => alignSelected('x', 'start')}>Left</button>
            <button type="button" disabled={!canAlign} onClick={() => alignSelected('x', 'center')}>Center</button>
            <button type="button" disabled={!canAlign} onClick={() => alignSelected('x', 'end')}>Right</button>
            <button type="button" disabled={!canAlign} onClick={() => alignSelected('y', 'start')}>Top</button>
            <button type="button" disabled={!canAlign} onClick={() => alignSelected('y', 'center')}>Middle</button>
            <button type="button" disabled={!canAlign} onClick={() => alignSelected('y', 'end')}>Bottom</button>
          </div>

          <div className="inspector-subsection-title">Shape builder</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            <button
              type="button"
              disabled={!canShapeBoolean}
              onClick={() => applyBooleanOperation('union')}
            >
              Merge
            </button>
            <button
              type="button"
              disabled={!canShapeBoolean}
              onClick={() => applyBooleanOperation('subtract')}
            >
              Subtract
            </button>
            <button
              type="button"
              disabled={!canShapeBoolean}
              onClick={() => applyBooleanOperation('intersect')}
            >
              Intersect
            </button>
            <button
              type="button"
              disabled={!canShapeBoolean}
              onClick={() => applyBooleanOperation('xor')}
            >
              Exclude
            </button>
          </div>
        </InspectorCollapsibleSection>
      </div>
      <AnimationPresetsModal open={presetsOpen} onClose={() => setPresetsOpen(false)} />
    </aside>
  )
}

/**
 * Editor for the per-element noise (wiggle) effects. Each entry is editable in
 * place; the parent owns the array via `onChange` so undo/redo plays nicely with
 * the store's history.
 */
function NoiseEditor({
  element,
  projectDuration,
  onChange,
  disabled
}: {
  element: VectorElement
  projectDuration: number
  onChange: (next: NoiseDef[]) => void
  disabled?: boolean
}) {
  const noises = element.noise ?? []

  const defaultsForProperty = (
    property: NoiseProperty,
    base: VectorElement
  ): { min: number; max: number } => {
    /** Sensible ranges so the first preview is visibly noisy without being absurd. */
    const cur = (base.transform as unknown as Record<string, number>)[property] ?? 0
    switch (property) {
      case 'x':
      case 'y':
        return { min: cur - 10, max: cur + 10 }
      case 'rotation':
      case 'skewX':
      case 'skewY':
        return { min: cur - 15, max: cur + 15 }
      case 'scaleX':
      case 'scaleY':
        return { min: Math.max(0.01, cur * 0.9), max: cur * 1.1 }
      case 'opacity':
        return { min: 0.4, max: 1 }
      default:
        return { min: cur - 5, max: cur + 5 }
    }
  }

  const addNoise = () => {
    if (disabled) return
    const property: NoiseProperty = 'rotation'
    const range = defaultsForProperty(property, element)
    const next: NoiseDef = {
      id: nanoid(8),
      property,
      from: 0,
      to: Math.max(1, projectDuration),
      min: range.min,
      max: range.max,
      frequency: 3
    }
    onChange([...noises, next])
  }

  const updateNoise = (id: string, patch: Partial<NoiseDef>) => {
    if (disabled) return
    onChange(
      noises.map((n) =>
        n.id === id
          ? ({
              ...n,
              ...patch,
              /** Property change → reset min/max to property-appropriate defaults so old numbers don't surprise. */
              ...(patch.property && patch.property !== n.property
                ? defaultsForProperty(patch.property, element)
                : {})
            } as NoiseDef)
          : n
      )
    )
  }

  const removeNoise = (id: string) => {
    if (disabled) return
    onChange(noises.filter((n) => n.id !== id))
  }

  if (noises.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          No noise effects yet. Add one to make a property wobble between two values
          over a time window.
        </p>
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={addNoise}
        >
          Add noise effect
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {noises.map((n, idx) => (
        <div
          key={n.id}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>Noise {idx + 1}</strong>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeNoise(n.id)}
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                padding: '2px 8px',
                color: 'var(--danger, #e5484d)'
              }}
            >
              Remove
            </button>
          </div>

          <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>Property</span>
            <select
              value={n.property}
              disabled={disabled}
              onChange={(e) => updateNoise(n.id, { property: e.target.value as NoiseProperty })}
            >
              {NOISE_PROPERTIES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>From (s)</span>
              <input
                type="number"
                step={0.1}
                min={0}
                max={n.to}
                value={n.from}
                disabled={disabled}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) updateNoise(n.id, { from: Math.max(0, Math.min(n.to, v)) })
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>To (s)</span>
              <input
                type="number"
                step={0.1}
                min={n.from}
                value={n.to}
                disabled={disabled}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) updateNoise(n.id, { to: Math.max(n.from, v) })
                }}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>Min value</span>
              <input
                type="number"
                step={0.1}
                value={n.min}
                disabled={disabled}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) updateNoise(n.id, { min: v })
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>Max value</span>
              <input
                type="number"
                step={0.1}
                value={n.max}
                disabled={disabled}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) updateNoise(n.id, { max: v })
                }}
              />
            </label>
          </div>

          <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>Speed (Hz)</span>
            <div className="slider-group">
              <input
                type="range"
                min={0.1}
                max={20}
                step={0.1}
                value={n.frequency}
                disabled={disabled}
                onChange={(e) => updateNoise(n.id, { frequency: Number(e.target.value) })}
              />
              <input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={n.frequency}
                disabled={disabled}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) updateNoise(n.id, { frequency: Math.max(0.1, Math.min(20, v)) })
                }}
              />
            </div>
          </label>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={addNoise}
      >
        Add another noise
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Texture brush editor                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tiny SVG preview shown in the preset grid. Renders a single horizontal sweep
 * through `sampleTextureStamps` so the user can recognise the look before
 * clicking. Kept self-contained (no Canvas/store dependency) so it can live
 * directly in the inspector tile grid.
 */
function TextureBrushPresetPreview({ preset }: { preset: TextureBrushPresetId }) {
  const def = getTextureBrushPreset(preset)
  const stampColor = '#dbe1ee'
  const previewBrush = useMemo<TextureBrush>(
    () => ({ preset, seed: 42, ...def.defaults }),
    [preset, def]
  )
  return (
    <svg width={84} height={28} viewBox="-2 -14 86 28" aria-hidden>
      <rect x={-2} y={-14} width={86} height={28} fill="#0e1422" />
      <PresetPreviewSweep brush={previewBrush} color={stampColor} />
    </svg>
  )
}

function PresetPreviewSweep({ brush, color }: { brush: TextureBrush; color: string }) {
  /**
   * A straight horizontal guide path keeps the preview comparable across
   * presets (length, tangent variation, etc.). Looks like an "alphabet swatch".
   */
  const guideD = 'M 2 0 L 80 0'
  const preset = getTextureBrushPreset(brush.preset)
  const stamps = sampleTextureStamps(guideD, brush)
  return (
    <g>
      {stamps.map((s) => (
        <g
          key={s.index}
          transform={`translate(${s.x.toFixed(3)} ${s.y.toFixed(3)}) rotate(${s.rotation.toFixed(2)}) scale(${s.scale.toFixed(3)})`}
          opacity={s.alpha}
        >
          {preset.stamp.map((shape, j) => (
            <path key={j} d={shape.d} fill={color} fillRule={shape.fillRule ?? 'nonzero'} stroke="none" />
          ))}
        </g>
      ))}
    </g>
  )
}

function TextureBrushEditor({
  element,
  onChange,
  disabled
}: {
  element: VectorElement
  onChange: (next: TextureBrush | undefined) => void
  disabled?: boolean
}) {
  const brush = element.textureBrush

  const update = (patch: Partial<TextureBrush>) => {
    if (disabled || !brush) return
    onChange({ ...brush, ...patch })
  }

  const choosePreset = (preset: TextureBrushPresetId) => {
    if (disabled) return
    /** Switching preset re-seeds with the new defaults; carrying the old jitter
     * knobs would produce a completely off-character stamp pattern. */
    onChange(defaultTextureBrush(preset, brush?.seed))
  }

  /** Single source of truth for the "no brush yet" empty state. */
  if (!brush) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          Drop a texture along this path — pick a preset to begin.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {TEXTURE_BRUSH_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => choosePreset(p.id)}
              title={p.description}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 4,
                padding: 6,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'transparent',
                cursor: disabled ? 'default' : 'pointer'
              }}
            >
              <TextureBrushPresetPreview preset={p.id} />
              <span style={{ fontSize: 11, color: 'var(--text)' }}>{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  /**
   * Helper for the standard "label + slider + numeric box" row. We use the same
   * `.slider-group` class noise/effects rows use so the inspector keeps a
   * consistent look.
   */
  const slider = (
    label: string,
    key: keyof TextureBrush,
    min: number,
    max: number,
    step: number
  ) => (
    <label key={key} style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="slider-group">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number(brush[key])}
          disabled={disabled}
          onChange={(e) => update({ [key]: Number(e.target.value) } as Partial<TextureBrush>)}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(brush[key])}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) update({ [key]: Math.max(min, Math.min(max, v)) } as Partial<TextureBrush>)
          }}
        />
      </div>
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
          Preset
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {TEXTURE_BRUSH_PRESETS.map((p) => {
            const active = p.id === brush.preset
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() => choosePreset(p.id)}
                title={p.description}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 4,
                  padding: 6,
                  border: active ? '1px solid var(--accent, #5b8def)' : '1px solid var(--border)',
                  borderRadius: 6,
                  background: active ? 'rgba(91,141,239,0.10)' : 'transparent',
                  cursor: disabled ? 'default' : 'pointer'
                }}
              >
                <TextureBrushPresetPreview preset={p.id} />
                <span style={{ fontSize: 11, color: 'var(--text)' }}>{p.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {slider('Spacing', 'spacing', 0.25, 12, 0.05)}
      {slider('Scale', 'scale', 0.1, 4, 0.05)}
      {slider('Scale jitter', 'scaleJitter', 0, 1, 0.05)}
      {slider('Rotate jitter', 'rotationJitter', 0, 360, 1)}
      {slider('Scatter', 'scatter', 0, 8, 0.1)}
      {slider('Opacity', 'opacity', 0, 1, 0.05)}
      {slider('Alpha jitter', 'opacityJitter', 0, 1, 0.05)}

      <label style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>Orient</span>
        <select
          value={brush.orient}
          disabled={disabled}
          onChange={(e) => update({ orient: e.target.value as TextureBrush['orient'] })}
        >
          <option value="tangent">Follow path tangent</option>
          <option value="upright">Stay upright</option>
        </select>
      </label>

      <label style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: 8, alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>Color</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="color"
            value={brush.color ?? '#222831'}
            disabled={disabled}
            onChange={(e) => update({ color: e.target.value })}
          />
          <button
            type="button"
            disabled={disabled || !brush.color}
            onClick={() => update({ color: undefined })}
            title="Inherit the host element's stroke / fill"
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            Inherit
          </button>
        </div>
      </label>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => update({ seed: Math.floor(Math.random() * 1_000_000) })}
          title="Re-roll the random placement seed"
          style={{ fontSize: 11 }}
        >
          Reshuffle
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(undefined)}
          style={{ fontSize: 11, color: 'var(--danger, #e5484d)' }}
        >
          Remove brush
        </button>
      </div>
    </div>
  )
}
