import type { Project, VectorElement } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { transformToSvgString } from '@/engines/transform/matrix'
import { mergeTransformFromTracks } from '@/engines/animation/interpolate'
import { flattenTimesForElement } from '@/engines/export/keyframeCss'

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

function renderInner(el: VectorElement): string {
  if (el.type === 'group') {
    const kids = (el.children ?? []).map(renderElement).join('')
    return `<g ${attrsToString(el.attrs)}>${kids}</g>`
  }
  if (el.type === 'text') {
    const { __textContent, ...rest } = el.attrs as Record<string, string | number>
    const inner = typeof __textContent === 'string' ? __textContent : ''
    return `<text ${attrsToString(rest)}>${escapeXml(inner)}</text>`
  }
  const tag =
    el.type === 'polygon' ? 'polygon' : el.type === 'polyline' ? 'polyline' : el.type
  return `<${tag} ${attrsToString(el.attrs)} />`
}

function renderElement(el: VectorElement): string {
  const t = el.transform
  const editorT = transformToSvgString(t)
  const op = t.opacity !== 1 ? ` opacity="${t.opacity}"` : ''
  const inner = renderInner(el)
  return `<g id="el_${el.id}" transform="${escapeXml(editorT)}"${op}>${inner}</g>`
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
  const body = project.elements.map(renderElement).join('\n')
  const css = buildKeyframesCss(project.elements, tracks, durationSec, options?.loop ?? false)

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<style>\n${css}\n</style>\n${body}\n</svg>`

  if (options?.minify !== false) {
    svg = svg.replace(/\n\s*\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  }
  return svg
}
