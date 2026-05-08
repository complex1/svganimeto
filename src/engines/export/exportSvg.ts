import type { Project, VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { transformToSvgString } from '@/engines/transform/matrix'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
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
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(' ')
}

function renderInner(el: VectorElement, project: Project): string {
  if (el.type === 'symbolInstance') {
    const sid = String(el.attrs.__symbolId ?? '')
    const def = project.symbols.find((s) => s.id === sid)
    if (!def) return ''
    const clone = cloneSymbolTemplateForInstance(def.template, el.id)
    return renderInner(clone, project)
  }
  if (el.type === 'group') {
    const kids = (el.children ?? []).map((c) => renderElement(c, project)).join('')
    return `<g ${attrsToString(el.attrs as Record<string, string | number>)}>${kids}</g>`
  }
  if (el.type === 'text') {
    const { __textContent, ...rest } = el.attrs as Record<string, string | number>
    const inner = typeof __textContent === 'string' ? __textContent : ''
    return `<text ${attrsToString(rest)}>${escapeXml(inner)}</text>`
  }
  const tag =
    el.type === 'polygon' ? 'polygon' : el.type === 'polyline' ? 'polyline' : el.type
  return `<${tag} ${attrsToString(el.attrs as Record<string, string | number>)} />`
}

function renderElement(el: VectorElement, project: Project): string {
  const t = el.transform
  const editorT = transformToSvgString(t)
  const op = t.opacity !== 1 ? ` opacity="${t.opacity}"` : ''
  const inner = renderInner(el, project)
  return `<g id="el_${el.id}" transform="${escapeXml(editorT)}"${op}>${inner}</g>`
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

  for (const el of iter) {
    const times = flattenTimesForElement(el.id, tracks, durationSec)
    const hasAnim = tracks.some((t) => t.elementId === el.id && t.keyframes.length > 0)
    if (!hasAnim) continue

    const name = `xfm_el_${el.id}`
    const keyframeBlocks = times.map((time) => {
      const pct = durationSec > 0 ? ((time / durationSec) * 100).toFixed(4) : '0'
      const merged = mergeTransformFromTracks(el.transform, el.id, tracks, time)
      const tr = transformToSvgString(merged)
      const op = merged.opacity !== 1 ? `opacity:${merged.opacity};` : ''
      return `  ${pct}% { transform: ${tr}; ${op} }`
    })
    rules.push(`@keyframes ${name} {\n${keyframeBlocks.join('\n')}\n}`)
    rules.push(
      `#el_${el.id} { animation-name: ${name}; animation-duration: ${durationSec}s; animation-fill-mode: both; animation-iteration-count: ${loop ? 'infinite' : '1'}; transform-box: fill-box; transform-origin: center; }`
    )
  }
  return rules.join('\n\n')
}

export function exportAnimatedSvg(
  project: Project,
  tracks: AnimationTrack[],
  durationSec: number,
  options?: { loop?: boolean; minify?: boolean }
): string {
  const { width, height } = project
  const defs = renderGradientDefs(project)
  const body = project.elements.map((el) => renderElement(el, project)).join('\n')
  const css = buildKeyframesCss(project.elements, tracks, durationSec, options?.loop ?? false)

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${defs}<style>\n${css}\n</style>\n${body}\n</svg>`

  if (options?.minify !== false) {
    svg = svg.replace(/\n\s*\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  }
  return svg
}
