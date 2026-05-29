/**
 * Clipper2-WASM façade matching the surface the rest of the editor used to
 * import from `polygon-clipping`. The intentionally tiny API (union /
 * intersection / xor / difference over `MultiPolygon`) lets us drop this in
 * behind the existing call sites without disturbing them.
 *
 * Coordinate handling
 * ===================
 * The editor's geometry uses float SVG coordinates (typical magnitudes 0–4096
 * with sub-pixel precision). Clipper requires integer coordinates because its
 * sweep-line algorithm needs exact equality between point comparisons.
 *
 * `SCALE = 1000` shifts three decimal places into the integer space — plenty
 * for shape-builder + eraser fidelity while staying far below Clipper's
 * `±9_007_199_254_740_991` limit. The same scale is reversed on the way out.
 *
 * Concurrency
 * ===========
 * The WASM instance is shared across all callers. Boolean ops are synchronous
 * once the module is up, so concurrent shape-builder + eraser operations are
 * naturally serialised by the JS event loop — no mutex needed.
 */
import type { MultiPolygon, Polygon, Pair } from 'polygon-clipping'
import type {
  ClipType,
  PolyFillType,
  IntPoint,
  Path,
  Paths,
  ClipperLibWrapper
} from 'js-angusj-clipper/web'
import { ensureClipperReady } from '@/wasm/clipper/loader'

/**
 * String literals matching `ClipType.*` / `PolyFillType.*`. We use literals
 * (rather than importing the runtime enums) so the Clipper2 module stays
 * fully code-split and the main bundle never references it. The enums in
 * `js-angusj-clipper` are TypeScript string enums whose values are exactly
 * these strings, so this is value-for-value compatible.
 */
const CLIP_TYPE_UNION = 'union' as ClipType
const CLIP_TYPE_INTERSECTION = 'intersection' as ClipType
const CLIP_TYPE_DIFFERENCE = 'difference' as ClipType
const CLIP_TYPE_XOR = 'xor' as ClipType
const POLY_FILL_NONZERO = 'nonZero' as PolyFillType

const SCALE = 1000
const INV_SCALE = 1 / SCALE

let readyInstance: ClipperLibWrapper | null = null

/**
 * Kick off the WASM boot. Safe to call early (e.g. when the editor mounts) so
 * the first shape-builder click feels instant; safe to skip too — the first
 * `runOp` call awaits this internally.
 */
export function primeClipperEngine(): void {
  void ensureClipperReady().then((inst) => {
    readyInstance = inst
  })
}

function isReadyForSync(): boolean {
  return readyInstance !== null
}

function ringToPath(ring: ReadonlyArray<Pair>): Path {
  /**
   * Polygon-clipping closes its rings by repeating the first point. Clipper
   * treats input as implicitly closed, so we strip the trailing duplicate to
   * avoid degenerate edges that would otherwise be cleaned up internally
   * (cheap, but adds noise to the output).
   */
  const last = ring.length - 1
  const closeMatches =
    ring.length > 1 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
  const len = closeMatches ? last : ring.length
  const out: Path = new Array(len)
  for (let i = 0; i < len; i++) {
    const [x, y] = ring[i]
    out[i] = { x: Math.round(x * SCALE), y: Math.round(y * SCALE) }
  }
  return out
}

function multiPolygonToPaths(mp: MultiPolygon): Paths {
  /**
   * Flatten outer-then-holes ordering matches what Clipper expects when you
   * declare `PolyFillType.EvenOdd` — holes will be detected by orientation
   * rather than requiring nesting hints.
   */
  const out: Paths = []
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 2) continue
      out.push(ringToPath(ring))
    }
  }
  return out
}

function pathToRing(path: ReadonlyArray<IntPoint>): Pair[] {
  /**
   * Restore the trailing duplicate so downstream code (which still talks the
   * polygon-clipping vocabulary) sees a properly-closed ring.
   */
  const len = path.length
  if (len === 0) return []
  const ring: Pair[] = new Array(len + 1)
  for (let i = 0; i < len; i++) {
    const p = path[i]
    ring[i] = [p.x * INV_SCALE, p.y * INV_SCALE]
  }
  ring[len] = ring[0]
  return ring
}

function pathsToMultiPolygon(paths: ReadonlyArray<ReadonlyArray<IntPoint>>): MultiPolygon {
  /**
   * polygon-clipping's MultiPolygon expects `[outer, ...holes][]`. Clipper2
   * returns a flat list of rings whose orientation tells us "outer" vs "hole".
   * The shape-builder pipeline ignores holes vs outers and merges everything
   * into evenodd-filled paths downstream, so we conservatively wrap each ring
   * as its own polygon. That matches what `polygon-clipping`'s output looked
   * like for unions/differences in the common single-shape case.
   */
  const out: MultiPolygon = []
  for (const path of paths) {
    if (path.length < 3) continue
    const ring = pathToRing(path)
    out.push([ring] as Polygon)
  }
  return out
}

function clipTypeFor(op: 'union' | 'intersection' | 'difference' | 'xor'): ClipType {
  switch (op) {
    case 'union':
      return CLIP_TYPE_UNION
    case 'intersection':
      return CLIP_TYPE_INTERSECTION
    case 'difference':
      return CLIP_TYPE_DIFFERENCE
    case 'xor':
      return CLIP_TYPE_XOR
  }
}

function runOpSync(
  inst: ClipperLibWrapper,
  op: 'union' | 'intersection' | 'difference' | 'xor',
  subject: MultiPolygon,
  clips: MultiPolygon[]
): MultiPolygon {
  const subjectPaths = multiPolygonToPaths(subject)
  if (subjectPaths.length === 0) {
    if (op === 'union' && clips.length > 0) {
      const unionPaths = clips.reduce<Paths>((acc, mp) => acc.concat(multiPolygonToPaths(mp)), [])
      if (unionPaths.length === 0) return []
      const r = inst.clipToPaths({
        clipType: CLIP_TYPE_UNION,
        subjectFillType: POLY_FILL_NONZERO,
        subjectInputs: [{ data: unionPaths, closed: true }]
      })
      return pathsToMultiPolygon(r)
    }
    /**
     * Empty subject for difference/intersection/xor short-circuits to empty —
     * matches polygon-clipping's behaviour.
     */
    return []
  }
  /**
   * For unions we treat every input as a subject (Clipper unions all subject
   * inputs together). For the asymmetric ops the original subject stays the
   * subject and everything else becomes the clip.
   */
  if (op === 'union') {
    const allPaths = [
      subjectPaths,
      ...clips.map((c) => multiPolygonToPaths(c))
    ].flat()
    const r = inst.clipToPaths({
      clipType: CLIP_TYPE_UNION,
      subjectFillType: POLY_FILL_NONZERO,
      subjectInputs: [{ data: allPaths, closed: true }]
    })
    return pathsToMultiPolygon(r)
  }
  const clipPaths = clips.reduce<Paths>((acc, mp) => acc.concat(multiPolygonToPaths(mp)), [])
  if (clipPaths.length === 0) {
    /**
     * No clips → identity for difference / intersection / xor. (intersection &
     * xor with nothing also reduce to "subject" in the polygon-clipping API.)
     */
    return pathsToMultiPolygon(subjectPaths)
  }
  const r = inst.clipToPaths({
    clipType: clipTypeFor(op),
    subjectFillType: POLY_FILL_NONZERO,
    clipFillType: POLY_FILL_NONZERO,
    subjectInputs: [{ data: subjectPaths, closed: true }],
    clipInputs: [{ data: clipPaths }]
  })
  return pathsToMultiPolygon(r)
}

function callerForOp(op: 'union' | 'intersection' | 'difference' | 'xor') {
  return (subject: Polygon | MultiPolygon, ...more: (Polygon | MultiPolygon)[]): MultiPolygon => {
    if (!isReadyForSync() || readyInstance === null) {
      throw new Error('[wasm/clipper] not ready — call ensureClipperReady() first')
    }
    const subjectMp = ensureMultiPolygon(subject)
    const others = more.map(ensureMultiPolygon)
    return runOpSync(readyInstance, op, subjectMp, others)
  }
}

function ensureMultiPolygon(geom: Polygon | MultiPolygon): MultiPolygon {
  /**
   * polygon-clipping ops accept `Polygon | MultiPolygon` interchangeably.
   * We promote bare polygons here so the rest of the code only ever talks
   * MultiPolygons.
   */
  if (!Array.isArray(geom) || geom.length === 0) return []
  const first = geom[0]
  if (!Array.isArray(first)) return []
  const firstInner = first[0]
  /**
   * `MultiPolygon` is `Polygon[]`, where `Polygon = Ring[]`, and `Ring =
   * [x,y][]`. So inspect the innermost type to disambiguate.
   */
  if (Array.isArray(firstInner) && typeof firstInner[0] === 'number') {
    return [geom as Polygon]
  }
  return geom as MultiPolygon
}

export const clipperUnion = callerForOp('union')
export const clipperIntersection = callerForOp('intersection')
export const clipperDifference = callerForOp('difference')
export const clipperXor = callerForOp('xor')

/**
 * Tells the façade caller whether the synchronous boolean ops above are
 * actually usable right now. When this returns `false`, callers should fall
 * back to the legacy `polygon-clipping` implementation (which is still
 * imported in `polygonClippingApi.ts`).
 */
export function clipperReadySync(): boolean {
  return isReadyForSync()
}
