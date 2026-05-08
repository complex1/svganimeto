import type { Project, VectorElement } from '@/types/document'
import type { AnimatableProperty, AnimationTrack } from '@/types/animation'
import { transformToSvgString } from '@/engines/transform/matrix'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { mergeAttrsFromTracks } from '@/engines/animation/attrAnimation'
import { flattenTimesForElement } from '@/engines/export/keyframeCss'
import { cloneSymbolTemplateForInstance } from '@/engines/document/symbolClone'

function allElements(roots: VectorElement[]): VectorElement[] {
  const out: VectorElement[] = []
  const walk = (el: VectorElement) => {
    out.push(el)
    el.children?.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function attrsToString(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(' ')
}

function readNumberAttr(attrs: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = attrs[key]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function effectStyleFromAttrs(attrs: Record<string, unknown>): string {
  const blur = Math.max(0, readNumberAttr(attrs, '__fxBlur', 0))
  const sx = readNumberAttr(attrs, '__fxShadowX', 0)
  const sy = readNumberAttr(attrs, '__fxShadowY', 0)
  const sb = Math.max(0, readNumberAttr(attrs, '__fxShadowBlur', 0))
  const sc = typeof attrs.__fxShadowColor === 'string' ? attrs.__fxShadowColor : '#000000'
  const parts: string[] = []
  if (blur > 0.01) parts.push(`blur(${blur.toFixed(2)}px)`)
  if (sb > 0.01 || Math.abs(sx) > 0.01 || Math.abs(sy) > 0.01) {
    parts.push(`drop-shadow(${sx.toFixed(2)}px ${sy.toFixed(2)}px ${sb.toFixed(2)}px ${escapeXml(sc)})`)
  }
  return parts.join(' ')
}

const PAINT_ANIM_PROPS: AnimatableProperty[] = ['fill', 'stroke', 'strokeWidth', 'pathD']

function hasPaintAnimation(elId: string, tracks: AnimationTrack[]): boolean {
  return tracks.some(
    (t) =>
      t.elementId === elId && t.keyframes.length > 0 && PAINT_ANIM_PROPS.includes(t.property)
  )
}

function paintTargetId(el: VectorElement): string {
  return `paint_el_${el.id}`
}

function renderInner(
  el: VectorElement,
  project: Project,
  tracks: AnimationTrack[] | undefined,
  timeSec: number
): string {
  const merged = tracks
    ? (mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<string, string | number>)
    : (el.attrs as Record<string, string | number>)
  const idAttr = ` id="${escapeXml(paintTargetId(el))}"`
  if (el.type === 'symbolInstance') {
    const sid = String(el.attrs.__symbolId ?? '')
    const def = project.symbols.find((s) => s.id === sid)
    if (!def) return ''
    const clone = cloneSymbolTemplateForInstance(def.template, el.id)
    return renderInner(clone, project, tracks, timeSec)
  }
  if (el.type === 'group') {
    const kids = (el.children ?? []).map((c) => renderElement(c, project, tracks, timeSec)).join('')
    return `<g${idAttr} ${attrsToString(merged)}>${kids}</g>`
  }
  if (el.type === 'text') {
    const { __textContent, ...rest } = merged as Record<string, string | number>
    const inner = typeof __textContent === 'string' ? __textContent : ''
    return `<text${idAttr} ${attrsToString(rest)}>${escapeXml(inner)}</text>`
  }
  const tag =
    el.type === 'polygon' ? 'polygon' : el.type === 'polyline' ? 'polyline' : el.type
  return `<${tag}${idAttr} ${attrsToString(merged)} />`
}

function renderElement(
  el: VectorElement,
  project: Project,
  tracks: AnimationTrack[] | undefined,
  timeSec: number
): string {
  const t = el.transform
  const editorT = transformToSvgString(t)
  const op = t.opacity !== 1 ? ` opacity="${t.opacity}"` : ''
  const attrForFx = tracks
    ? (mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<string, unknown>)
    : (el.attrs as Record<string, unknown>)
  const effectStyle = effectStyleFromAttrs(attrForFx)
  const style = effectStyle ? ` style="filter:${effectStyle};"` : ''
  const inner = renderInner(el, project, tracks, timeSec)
  return `<g id="el_${el.id}" transform="${escapeXml(editorT)}"${op}${style}>${inner}</g>`
}

function renderGradientDefs(project: Project): string {
  const defs = project.gradients ?? []
  if (defs.length === 0) return ''
  const chunks = defs.map((g) => {
    const stops = g.stops
      .map(
        (s) =>
          `<stop offset="${Math.round(Math.max(0, Math.min(1, s.offset)) * 100)}%" stop-color="${escapeXml(s.color)}" stop-opacity="${s.opacity ?? 1}"/>`
      )
      .join('')
    if (g.kind === 'linear') {
      return `<linearGradient id="${escapeXml(g.id)}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" gradientUnits="${g.gradientUnits}">${stops}</linearGradient>`
    }
    const fx = g.fx !== undefined ? ` fx="${g.fx}"` : ''
    const fy = g.fy !== undefined ? ` fy="${g.fy}"` : ''
    return `<radialGradient id="${escapeXml(g.id)}" cx="${g.cx}" cy="${g.cy}" r="${g.r}"${fx}${fy} gradientUnits="${g.gradientUnits}">${stops}</radialGradient>`
  })
  return `<defs>\n${chunks.join('\n')}\n</defs>\n`
}

function buildKeyframesCss(
  elements: VectorElement[],
  tracks: AnimationTrack[],
  durationSec: number,
  loop: boolean
): string {
  if (durationSec <= 0) return ''
  const rules: string[] = []
  const iter = allElements(elements)
  const animCommon = `animation-duration: ${durationSec}s; animation-fill-mode: both; animation-iteration-count: ${loop ? 'infinite' : '1'}`

  for (const el of iter) {
    const times = flattenTimesForElement(el.id, tracks, durationSec)
    const hasAnim = tracks.some((t) => t.elementId === el.id && t.keyframes.length > 0)
    if (!hasAnim) continue

    const name = `xfm_el_${el.id}`
    const keyframeBlocks = times.map((time) => {
      const pct = durationSec > 0 ? ((time / durationSec) * 100).toFixed(4) : '0'
      const mergedT = mergeTransformFromTracks(el.transform, el.id, tracks, time)
      const tr = transformToSvgString(mergedT)
      const op = mergedT.opacity !== 1 ? `opacity:${mergedT.opacity};` : ''
      const mergedAttrs = mergeAttrsFromTracks(el.attrs, el.id, tracks, time) as Record<string, unknown>
      const fx = effectStyleFromAttrs(mergedAttrs)
      const filt = fx ? `filter:${fx};` : ''
      return `  ${pct}% { transform:${tr}; ${op} ${filt} }`
    })
    rules.push(`@keyframes ${name} {\n${keyframeBlocks.join('\n')}\n}`)
    rules.push(
      `#el_${el.id} { animation-name: ${name}; ${animCommon}; transform-box: fill-box; transform-origin: center; }`
    )

    if (hasPaintAnimation(el.id, tracks)) {
      const pname = `paint_el_${el.id}`
      const paintBlocks = times.map((time) => {
        const pct = durationSec > 0 ? ((time / durationSec) * 100).toFixed(4) : '0'
        const mergedAttrs = mergeAttrsFromTracks(el.attrs, el.id, tracks, time) as Record<string, unknown>
        const decls: string[] = []
        if (typeof mergedAttrs.fill === 'string') decls.push(`fill:${mergedAttrs.fill}`)
        if (typeof mergedAttrs.stroke === 'string') decls.push(`stroke:${mergedAttrs.stroke}`)
        const sw = mergedAttrs['stroke-width']
        if (typeof sw === 'number' || (typeof sw === 'string' && sw !== '')) {
          decls.push(`stroke-width:${sw}`)
        }
        if (typeof mergedAttrs.d === 'string' && mergedAttrs.d.length > 0) {
          decls.push(`d:path(${JSON.stringify(mergedAttrs.d)})`)
        }
        return `  ${pct}% { ${decls.join(';')} }`
      })
      rules.push(`@keyframes ${pname} {\n${paintBlocks.join('\n')}\n}`)
      rules.push(`#${pname} { animation-name: ${pname}; ${animCommon}; }`)
    }
  }
  return rules.join('\n\n')
}

/** Single frame SVG (no CSS animation); transforms sampled at `timeSec`. */
export function exportStillFrameSvg(project: Project, tracks: AnimationTrack[], timeSec: number): string {
  function renderInnerAtTime(el: VectorElement): string {
    if (el.type === 'symbolInstance') {
      const sid = String(el.attrs.__symbolId ?? '')
      const def = project.symbols.find((s) => s.id === sid)
      if (!def) return ''
      const clone = cloneSymbolTemplateForInstance(def.template, el.id)
      return renderInnerAtTime(clone)
    }
    if (el.type === 'group') {
      const merged = mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<
        string,
        string | number
      >
      const kids = (el.children ?? []).map((c) => renderElementAtTime(c)).join('')
      return `<g id="${escapeXml(paintTargetId(el))}" ${attrsToString(merged)}>${kids}</g>`
    }
    if (el.type === 'text') {
      const merged = mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<
        string,
        string | number
      >
      const { __textContent, ...rest } = merged
      const inner = typeof __textContent === 'string' ? __textContent : ''
      return `<text id="${escapeXml(paintTargetId(el))}" ${attrsToString(rest)}>${escapeXml(inner)}</text>`
    }
    const mergedA = mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<
      string,
      string | number
    >
    const tag =
      el.type === 'polygon' ? 'polygon' : el.type === 'polyline' ? 'polyline' : el.type
    return `<${tag} id="${escapeXml(paintTargetId(el))}" ${attrsToString(mergedA)} />`
  }

  function renderElementAtTime(el: VectorElement): string {
    const merged = mergeTransformFromTracks(el.transform, el.id, tracks, timeSec)
    const editorT = transformToSvgString(merged)
    const op = merged.opacity !== 1 ? ` opacity="${merged.opacity}"` : ''
    const mergedFx = mergeAttrsFromTracks(el.attrs, el.id, tracks, timeSec) as Record<string, unknown>
    const effectStyle = effectStyleFromAttrs(mergedFx)
    const style = effectStyle ? ` style="filter:${effectStyle};"` : ''
    const inner = renderInnerAtTime(el)
    return `<g id="el_${el.id}" transform="${escapeXml(editorT)}"${op}${style}>${inner}</g>`
  }

  const { width, height } = project
  const defs = renderGradientDefs(project)
  const body = project.elements.map((el) => renderElementAtTime(el)).join('\n')
  const bg = `<rect x="0" y="0" width="${width}" height="${height}" fill="#f4f5f7" stroke="#d0d4dc" />`

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">\n${defs}${bg}\n${body}\n</svg>`
}

export function exportAnimatedSvg(
  project: Project,
  tracks: AnimationTrack[],
  durationSec: number,
  options?: { loop?: boolean; minify?: boolean }
): string {
  const { width, height } = project
  const defs = renderGradientDefs(project)
  const body = project.elements.map((el) => renderElement(el, project, tracks, 0)).join('\n')
  const css = buildKeyframesCss(project.elements, tracks, durationSec, options?.loop ?? false)

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${defs}<style>\n${css}\n</style>\n${body}\n</svg>`

  if (options?.minify !== false) {
    svg = svg.replace(/\n\s*\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  }
  return svg
}
