import type { CSSProperties } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { flattenForLayers } from '@/engines/document/tree'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { bboxInSvgRootSpace } from '@/components/canvas/svgBounds'

export function RightInspector() {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const elements = useEditorStore((s) => s.project.elements)
  const tracks = useEditorStore((s) => s.tracks)
  const currentTime = useEditorStore((s) => s.currentTime)
  const updateTransform = useEditorStore((s) => s.updateTransform)
  const pushHistory = useEditorStore((s) => s.pushHistory)
  const setElementAttrs = useEditorStore((s) => s.setElementAttrs)
  const mode = useEditorStore((s) => s.mode)

  const id = selectedIds[0]
  const el = id ? flattenForLayers(elements).find((x) => x.el.id === id)?.el : undefined
  if (!el) {
    return (
      <aside className="area-inspector">
        <div className="panel-section-title">Inspector</div>
        <p style={{ padding: 12, color: 'var(--text-muted)' }}>Select a layer</p>
      </aside>
    )
  }

  const tr = mergeTransformFromTracks(el.transform, el.id, tracks, currentTime)
  const fillValue = typeof el.attrs.fill === 'string' ? el.attrs.fill : '#d1d5db'
  const fillNone = fillValue === 'none' || fillValue === 'transparent'
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
  const canAlign = selectedIds.length > 1 && mode === 'draw'

  const sectionTitleStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    margin: '14px 0 8px'
  }

  type PropKey = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'
  const row = (label: string, key: PropKey) => (
    <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="number"
        step={key === 'opacity' ? 0.05 : key === 'rotation' ? 1 : 1}
        value={Number(tr[key].toFixed(4))}
        disabled={el.locked || mode === 'preview' || mode === 'export'}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) updateTransform(el.id, { [key]: v })
        }}
      />
    </label>
  )

  const alignSelected = (
    axis: 'x' | 'y',
    anchor: 'start' | 'center' | 'end'
  ) => {
    if (!canAlign) return
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
      .filter((v): v is { id: string; box: { x: number; y: number; width: number; height: number }; el: typeof el } => Boolean(v))

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

  return (
    <aside className="area-inspector">
      <div style={{ padding: 12 }}>
        <div style={{ ...sectionTitleStyle, marginTop: 0 }}>Transform</div>
        {row('X', 'x')}
        {row('Y', 'y')}
        {row('Scale X', 'scaleX')}
        {row('Scale Y', 'scaleY')}
        {row('Rotation', 'rotation')}
        {row('Opacity', 'opacity')}
        {canCornerRadius && (
          <>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>RX</span>
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(cornerRadiusXValue) ? cornerRadiusXValue : 0}
                disabled={el.locked || mode !== 'draw'}
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
                disabled={el.locked || mode !== 'draw'}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) {
                    setElementAttrs(el.id, { ry: Math.max(0, v) })
                  }
                }}
              />
            </label>
          </>
        )}

        <div style={sectionTitleStyle}>Fill</div>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Style</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={fillNone}
              disabled={el.locked || mode !== 'draw'}
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
            disabled={el.locked || mode !== 'draw' || fillNone}
            onChange={(e) => setElementAttrs(el.id, { fill: e.target.value })}
            style={{ width: '100%', height: 30, padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </label>

        <div style={sectionTitleStyle}>Stroke</div>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Color</span>
          <input
            type="color"
            value={strokeValue.startsWith('#') ? strokeValue : '#5b8def'}
            disabled={el.locked || mode !== 'draw'}
            onChange={(e) => setElementAttrs(el.id, { stroke: e.target.value })}
            style={{ width: '100%', height: 30, padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </label>
        <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Width</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={Number.isFinite(strokeWidthValue) ? strokeWidthValue : 2}
            disabled={el.locked || mode !== 'draw'}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) setElementAttrs(el.id, { 'stroke-width': Math.max(0, v) })
            }}
          />
        </label>

        <div style={sectionTitleStyle}>Typography</div>
        {!canTypography ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
            Select a text layer to edit typography.
          </p>
        ) : (
          <>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Content</span>
              <input
                type="text"
                value={textContent}
                disabled={el.locked || mode !== 'draw'}
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
                disabled={el.locked || mode !== 'draw'}
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
                disabled={el.locked || mode !== 'draw'}
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
        )}

        <div style={sectionTitleStyle}>Effects</div>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
          Blur, gaussian blur, and shadow controls will be added in the next pass.
        </p>

        <div style={sectionTitleStyle}>Alignment</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <button type="button" disabled={!canAlign} title="Align Left" onClick={() => alignSelected('x', 'start')}>Left</button>
          <button type="button" disabled={!canAlign} title="Align Center" onClick={() => alignSelected('x', 'center')}>Center</button>
          <button type="button" disabled={!canAlign} title="Align Right" onClick={() => alignSelected('x', 'end')}>Right</button>
          <button type="button" disabled={!canAlign} title="Align Top" onClick={() => alignSelected('y', 'start')}>Top</button>
          <button type="button" disabled={!canAlign} title="Align Middle" onClick={() => alignSelected('y', 'center')}>Middle</button>
          <button type="button" disabled={!canAlign} title="Align Bottom" onClick={() => alignSelected('y', 'end')}>Bottom</button>
        </div>

        <div style={sectionTitleStyle}>Boolean operations</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          <button type="button" disabled title="Union">Union</button>
          <button type="button" disabled title="Subtract">Subtract</button>
          <button type="button" disabled title="Intersect">Intersect</button>
          <button type="button" disabled title="Exclude">Exclude</button>
        </div>
      </div>
    </aside>
  )
}
