import { nanoid } from 'nanoid'
import type { Project, VectorElement, VectorElementType } from '@/types/document'
import { defaultTransform } from '@/types/document'

const IMPORT_TAGS = new Set([
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'text',
  'image',
  'polygon',
  'polyline'
])

let nameCounters: Record<string, number> = {}

function resetNamingCounters() {
  nameCounters = {}
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s
}

/** path_01 -> Path 1, g_03 -> Group 3 */
export function smartLayerName(tag: string, idAttr: string | null | undefined): string {
  if (idAttr) {
    const m = idAttr.match(/^([a-zA-Z]+)_0*(\d+)$/)
    if (m) {
      const base = m[1].toLowerCase()
      const mapTag: Record<string, string> = {
        path: 'Path',
        g: 'Group',
        rect: 'Rectangle',
        circle: 'Circle',
        ellipse: 'Ellipse',
        line: 'Line',
        text: 'Text',
        image: 'Image',
        polygon: 'Polygon',
        polyline: 'Polyline'
      }
      const label = mapTag[base] ?? capitalize(base)
      return `${label} ${Number(m[2])}`
    }
    if (idAttr.trim()) return idAttr.replace(/[-_]/g, ' ')
  }
  const key = tag
  nameCounters[key] = (nameCounters[key] ?? 0) + 1
  const label =
    tag === 'g'
      ? 'Group'
      : tag === 'rect'
        ? 'Rectangle'
        : tag === 'circle'
          ? 'Circle'
          : capitalize(tag)
  return `${label} ${nameCounters[key]}`
}

function attrsFromElement(el: Element): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'id') continue
    out[a.name] = a.value
  }
  return out
}

function inferType(tag: string): VectorElementType {
  if (tag === 'g') return 'group'
  if (tag === 'rect') return 'rect'
  if (tag === 'circle') return 'circle'
  if (tag === 'ellipse') return 'ellipse'
  if (tag === 'line') return 'line'
  if (tag === 'path') return 'path'
  if (tag === 'text') return 'text'
  if (tag === 'image') return 'image'
  if (tag === 'polygon') return 'polygon'
  if (tag === 'polyline') return 'polyline'
  return 'group'
}

/** Skip whole subtrees; do not recurse (avoid HTML inside foreignObject). */
const SKIP_SUBTREE = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'foreignobject', 'script'])

/** Collect drawable roots: known shapes/groups, or recurse through benign wrappers (e.g. `<a><path/></a>`). */
function collectElements(parent: Element): VectorElement[] {
  const out: VectorElement[] = []
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName.toLowerCase()
    if (SKIP_SUBTREE.has(tag)) continue
    const el = convertNode(child)
    if (el) {
      out.push(el)
      continue
    }
    out.push(...collectElements(child))
  }
  return out
}

function parseSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.getAttribute('viewBox')
  if (vb) {
    const p = vb.trim().split(/\s+/)
    if (p.length === 4) {
      const w = Number(p[2])
      const h = Number(p[3])
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h }
    }
  }
  const w = parseFloat(svg.getAttribute('width') || '800')
  const h = parseFloat(svg.getAttribute('height') || '600')
  return { width: w || 800, height: h || 600 }
}

function convertNode(node: Element): VectorElement | null {
  const tag = node.tagName.toLowerCase()
  if (!IMPORT_TAGS.has(tag)) return null

  const domId = node.getAttribute('id')
  const id = nanoid(10)
  const name = smartLayerName(tag, domId)
  const type = inferType(tag)
  const attrs = attrsFromElement(node)

  if (type === 'group') {
    const children: VectorElement[] = []
    for (const child of Array.from(node.children)) {
      const c = convertNode(child)
      if (c) children.push(c)
    }
    return {
      id,
      name,
      type: 'group',
      attrs,
      transform: defaultTransform(),
      children,
      visible: true,
      locked: false
    }
  }

  if (type === 'text') {
    attrs['__textContent'] = node.textContent ?? ''
  }

  return {
    id,
    name,
    type,
    attrs,
    transform: defaultTransform(),
    visible: true,
    locked: false
  }
}

function parseSvgAttributeChunk(header: string): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const re = /([:A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header))) {
    const key = m[1]
    const val = m[3] ?? m[4] ?? ''
    if (key.toLowerCase() === 'id') continue
    out[key] = val
  }
  return out
}

/**
 * ImageTracer SVG is flat `<path … d="…" />` tags. DOMParser duplicates the whole string as a DOM tree
 * and can OOM the Electron renderer; this path only allocates our `VectorElement[]`.
 */
function importImageTracerSvgAsProject(svgString: string, projectName: string): Project {
  resetNamingCounters()
  let width = 800
  let height = 600
  const vb = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/i.exec(svgString)
  if (vb) {
    width = parseFloat(vb[1]) || width
    height = parseFloat(vb[2]) || height
  } else {
    const wm = /width="\s*([\d.]+)\s*"/i.exec(svgString)
    const hm = /height="\s*([\d.]+)\s*"/i.exec(svgString)
    if (wm) width = parseFloat(wm[1]) || width
    if (hm) height = parseFloat(hm[1]) || height
  }

  const elements: VectorElement[] = []
  let i = 0
  while (i < svgString.length) {
    const p = svgString.toLowerCase().indexOf('<path ', i)
    if (p < 0) break
    const attrsStart = p + 6
    const dPos = svgString.indexOf('d="', attrsStart)
    if (dPos < 0) break
    const header = svgString.slice(attrsStart, dPos).trim()
    const attrs = parseSvgAttributeChunk(header)
    const valueStart = dPos + 3
    let q = valueStart
    while (q < svgString.length) {
      if (svgString[q] === '"' && svgString[q - 1] !== '\\') break
      q += 1
    }
    attrs.d = svgString.slice(valueStart, q)
    const close = svgString.indexOf('/>', q)
    if (close < 0) break

    const id = nanoid(10)
    const name = smartLayerName('path', null)
    elements.push({
      id,
      name,
      type: 'path',
      attrs,
      transform: defaultTransform(),
      visible: true,
      locked: false
    })
    i = close + 2
  }

  return {
    id: nanoid(),
    name: projectName,
    width,
    height,
    elements,
    assets: [],
    gradients: [],
    symbols: []
  }
}

export function importSvgString(svgString: string, projectName = 'Imported'): Project {
  if (svgString.includes('imagetracer.js version')) {
    const fast = importImageTracerSvgAsProject(svgString, projectName)
    if (fast.elements.length > 0) return fast
    console.warn('[svgImporter] ImageTracer fast parse produced 0 paths; falling back to DOMParser')
  }

  resetNamingCounters()
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  const parserErr = doc.querySelector('parsererror')
  if (parserErr) {
    console.warn('[svgImporter] DOMParser reported malformed SVG; trying text/html fallback')
  }
  let svg = doc.querySelector('svg') as SVGSVGElement | null
  if (!svg && !parserErr) {
    const htmlDoc = new DOMParser().parseFromString(svgString, 'text/html')
    svg = htmlDoc.querySelector('svg') as SVGSVGElement | null
  }
  if (!svg) {
    return {
      id: nanoid(),
      name: projectName,
      width: 800,
      height: 600,
      elements: [],
      assets: [],
      gradients: [],
      symbols: []
    }
  }
  const { width, height } = parseSize(svg)
  const elements = collectElements(svg)
  return {
    id: nanoid(),
    name: projectName,
    width,
    height,
    elements,
    assets: [],
    gradients: [],
    symbols: []
  }
}
