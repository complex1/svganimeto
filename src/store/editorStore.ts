import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  defaultTransform,
  type Project,
  type SymbolDefinition,
  type Transform,
  type VectorAttrValue,
  type VectorElement
} from '@/types/document'
import type { GradientDef } from '@/types/gradient'
import type {
  AnimatableProperty,
  AnimationTrack,
  EasingId,
  Keyframe,
  KeyframeClipboardEntry,
  KeyframeSelectionEntry
} from '@/types/animation'
import { mergeTransformFromTracks, sampleTrack } from '@/engines/animation/interpolate'
import {
  ATTR_TEXT_STEP_PROPERTIES,
  hexToPackedRgb,
  mergeAttrsFromTracks
} from '@/engines/animation/attrAnimation'
import { importSvgString } from '@/engines/importer/svgImporter'
import { duplicateSelectedInDocument } from '@/engines/document/duplicateElements'
import { groupSelectedElements } from '@/engines/document/groupElements'
import {
  findAncestorChain,
  findElement,
  flattenForLayers,
  insertElement,
  purgeElementsByIds,
  removeElementById,
  reorderSiblings,
  stripSymbolInstancesByMasterId,
  updateElementById
} from '@/engines/document/tree'
import type { MultiPolygon } from 'polygon-clipping'
import { difference, intersection, union, xor } from '@/engines/geometry/polygonClippingApi'
import type { BooleanOpKind } from '@/engines/geometry/pathBooleanEngine'
import {
  elementToWorldMultiPolygon,
  multiPolygonToPathD
} from '@/engines/geometry/pathBooleanEngine'
import { multiplyWorldMatrices } from '@/engines/geometry/svgWorldTransform'
import { applyEraserClipToTree } from '@/engines/geometry/eraserApply'
import { strokeOutlineRing } from '@/engines/geometry/pathFlatten'
import type { HistorySnapshot } from '@/types/history'
import { dialogAlert, dialogConfirm } from '@/store/dialogStore'
import { deepCloneElementNewIds, unlockElementTree } from '@/engines/document/symbolClone'
import type { CanvasGuideType, GuidePointNorm } from '@/types/canvasGuide'

export type EditorMode = 'draw' | 'animate' | 'preview' | 'export'
export type DrawTool =
  | 'select'
  | 'hand'
  | 'shape-builder'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'pencil'
  | 'path-edit'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'text'

const HISTORY_MAX = 80

function clampGuideCoord(v: number) {
  return Math.max(-5, Math.min(5, v))
}

const emptyProject = (): Project => ({
  id: nanoid(),
  name: 'Untitled',
  width: 800,
  height: 600,
  elements: [],
  assets: [],
  gradients: [],
  symbols: []
})

/** Selection must be root-level layers only (not nested, not symbol instances). */
/** Saved document/editor slice while editing a symbol master on an isolated canvas. */
export type SymbolEditRestoreSnapshot = {
  project: Project
  projectPath: string | null
  tracks: AnimationTrack[]
  selectedIds: string[]
  viewBox: { x: number; y: number; width: number; height: number }
  zoom: number
  mode: EditorMode
  activeTool: DrawTool
  historyPast: HistorySnapshot[]
  historyFuture: HistorySnapshot[]
  currentTime: number
  duration: number
  fps: number
  playbackSpeed: number
  loop: boolean
  autoKeyframe: boolean
  isPlaying: boolean
  selectedKeyframes: KeyframeSelectionEntry[]
  keyframeClipboard: KeyframeClipboardEntry[] | null
}

export type SymbolEditBackup = {
  symbolId: string
  symbolName: string
  restore: SymbolEditRestoreSnapshot
}

function collectRootSelectionsForSymbol(
  roots: VectorElement[],
  ids: string[]
): VectorElement[] | null {
  if (ids.length === 0) return null
  const out: VectorElement[] = []
  for (const id of ids) {
    const loc = findElement(roots, id)
    if (!loc || loc.parent !== null) return null
    if (loc.node.type === 'symbolInstance') return null
    out.push(loc.node)
  }
  return out
}

type EditorState = {
  project: Project
  projectPath: string | null
  selectedIds: string[]
  tracks: AnimationTrack[]
  currentTime: number
  duration: number
  fps: number
  /** Playback rate multiplier (1 = real-time). */
  playbackSpeed: number
  isPlaying: boolean
  loop: boolean
  /**
   * Dev / migration: drive canvas + inspector from a compiled `gsap.timeline()` (see `gsapTrackCompiler`).
   * Not persisted in project JSON.
   */
  gsapCanvasDriver: boolean
  mode: EditorMode
  activeTool: DrawTool
  autoKeyframe: boolean
  /** Root SVG viewBox: x y width height in artboard space */
  viewBox: { x: number; y: number; width: number; height: number }
  zoom: number

  /** View-only construction guides (not exported). */
  canvasGuideType: CanvasGuideType
  canvasGuideSpacing: number
  canvasGuideOpacity: number
  canvasGuideColor: string
  /** Show guide lines (eye toggle). */
  canvasGuideOverlayVisible: boolean
  /** Collapse the guides control panel to a compact bar. */
  canvasGuidePanelCollapsed: boolean
  /** Horizon helper — synced with VP vertical position when adjusted via slider. */
  canvasGuideHorizon: number
  canvasGuideVp1: GuidePointNorm
  canvasGuideVpLeft: GuidePointNorm
  canvasGuideVpRight: GuidePointNorm
  canvasGuideVpTop: GuidePointNorm
  canvasGuideFisheyeCenter: GuidePointNorm

  historyPast: HistorySnapshot[]
  historyFuture: HistorySnapshot[]

  /** When set, the editor canvas shows only this symbol's master for isolated editing. */
  symbolEditBackup: SymbolEditBackup | null

  /** Timeline keyframe multi-selection (UI only). */
  selectedKeyframes: KeyframeSelectionEntry[]
  keyframeClipboard: KeyframeClipboardEntry[] | null

  pushHistory: () => void
  undo: () => void
  redo: () => void
  clearHistory: () => void
  /** Drop document + timeline + history without clearing project path (memory relief before huge import). */
  evictToEmptyProject: () => void

  newProject: () => void
  setProject: (p: Project, path?: string | null) => void
  importSvgFromString: (
    svg: string,
    name?: string,
    opts?: { resetHistory?: boolean }
  ) => void
  /** Locked reference image only — trace paths manually with Pen / Pencil on top (or elsewhere). */
  importRasterManualReference: (dataUrl: string, width: number, height: number, projectName: string) => void
  setElements: (elements: VectorElement[], opts?: { skipHistory?: boolean }) => void
  setProjectMeta: (partial: Partial<Pick<Project, 'name' | 'width' | 'height'>>, opts?: { skipHistory?: boolean }) => void
  /** Artboard size; resets viewBox to the full canvas (0,0,w,h). */
  setCanvasSize: (width: number, height: number, opts?: { skipHistory?: boolean }) => void

  select: (ids: string[]) => void
  addToSelection: (id: string) => void
  clearSelection: () => void

  setMode: (m: EditorMode) => void
  setActiveTool: (tool: DrawTool) => void
  setAutoKeyframe: (v: boolean) => void
  setViewBox: (vb: { x: number; y: number; width: number; height: number }) => void
  setZoom: (z: number) => void
  panBy: (dx: number, dy: number) => void

  setCanvasGuideType: (t: CanvasGuideType) => void
  setCanvasGuideSpacing: (n: number) => void
  setCanvasGuideOpacity: (n: number) => void
  setCanvasGuideColor: (c: string) => void
  setCanvasGuideOverlayVisible: (v: boolean) => void
  setCanvasGuidePanelCollapsed: (v: boolean) => void
  setCanvasGuideHorizon: (n: number) => void
  setCanvasGuideVp1: (p: Partial<GuidePointNorm>) => void
  setCanvasGuideVpLeft: (p: Partial<GuidePointNorm>) => void
  setCanvasGuideVpRight: (p: Partial<GuidePointNorm>) => void
  setCanvasGuideVpTop: (p: Partial<GuidePointNorm>) => void
  setCanvasGuideFisheyeCenter: (p: Partial<GuidePointNorm>) => void

  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setFps: (f: number) => void
  setPlaybackSpeed: (n: number) => void
  setLoop: (v: boolean) => void
  setIsPlaying: (v: boolean) => void
  setGsapCanvasDriver: (v: boolean) => void

  updateTransform: (id: string, partial: Partial<Transform>, opts?: { skipHistory?: boolean }) => void
  setElementName: (id: string, name: string, opts?: { skipHistory?: boolean }) => void
  setElementAttrs: (
    id: string,
    attrs: Record<string, VectorAttrValue>,
    opts?: { skipHistory?: boolean }
  ) => void
  toggleVisible: (id: string, opts?: { skipHistory?: boolean }) => void
  toggleLock: (id: string, opts?: { skipHistory?: boolean }) => void
  reorderLayers: (dragId: string, targetId: string, place: 'before' | 'after', opts?: { skipHistory?: boolean }) => void
  deleteSelected: (opts?: { skipHistory?: boolean }) => void
  deleteLayerById: (id: string, opts?: { skipHistory?: boolean }) => void
  /** Wraps 2+ selected sibling layers in a new group (preserves child ids and tracks). */
  groupSelection: () => void
  /** Clones selected layer roots (new ids); copies tracks; inserts copies after originals. */
  duplicateSelection: () => void
  addElement: (element: VectorElement, opts?: { skipHistory?: boolean; select?: boolean }) => void

  ensureTrack: (elementId: string, property: AnimatableProperty) => string
  upsertKeyframe: (
    elementId: string,
    property: AnimatableProperty,
    time: number,
    value: number,
    easing?: EasingId,
    opts?: { skipHistory?: boolean; valueText?: string }
  ) => void
  removeKeyframe: (trackId: string, keyframeId: string, opts?: { skipHistory?: boolean }) => void
  moveKeyframe: (trackId: string, keyframeId: string, time: number, opts?: { skipHistory?: boolean }) => void
  setTracks: (tracks: AnimationTrack[], opts?: { skipHistory?: boolean }) => void
  pruneTracksForElement: (elementId: string, opts?: { skipHistory?: boolean }) => void

  setSelectedKeyframes: (entries: KeyframeSelectionEntry[]) => void
  clearKeyframeSelection: () => void
  setKeyframeEasing: (trackId: string, keyframeId: string, easing: EasingId) => void
  copySelectedKeyframes: () => void
  pasteKeyframesAtTime: (anchorTime?: number) => void
  nudgeSelectedKeyframes: (deltaSec: number) => void
  deleteSelectedKeyframes: () => void
  addKeyframeAtPlayhead: (elementId: string, property: AnimatableProperty) => void
  jumpToPrevKeyframe: () => void
  jumpToNextKeyframe: () => void

  upsertGradient: (g: GradientDef, opts?: { skipHistory?: boolean }) => void
  applyBooleanOperation: (op: BooleanOpKind) => void
  applyEraserStroke: (samples: Array<{ x: number; y: number }>, width: number) => void

  createSymbolFromSelection: (name?: string) => void
  updateSymbolTemplateFromSelection: (symbolId: string) => void
  deleteSymbol: (symbolId: string) => void
  placeSymbolInstance: (symbolId: string) => void
  beginSymbolEdit: (symbolId: string) => void
  commitSymbolEdit: () => void
  cancelSymbolEdit: () => void
  detachSymbolInstance: (instanceId: string) => void

  serializeProject: () => string
  hydrateFromJson: (json: string) => void
}

/**
 * Walk the element tree and, for every layer that has any animation track, fold
 * the t=0 sample into the layer's base `transform` / `attrs`. Tracks are left
 * untouched, so playback in Animate/Preview still looks identical. The only
 * observable effect: Draw view (which always renders `el.transform` / `el.attrs`)
 * now shows the animation's starting frame instead of whatever state the user
 * happened to scrub to.
 */
function bakeTracksAtZero(roots: VectorElement[], tracks: AnimationTrack[]): VectorElement[] {
  if (tracks.length === 0) return roots
  /** Group tracks by element so each per-layer lookup is O(1). */
  const tracksByEl = new Map<string, AnimationTrack[]>()
  for (const t of tracks) {
    if (t.keyframes.length === 0) continue
    const list = tracksByEl.get(t.elementId) ?? []
    list.push(t)
    tracksByEl.set(t.elementId, list)
  }
  if (tracksByEl.size === 0) return roots
  let mutated = false
  const walk = (els: VectorElement[]): VectorElement[] => {
    let listChanged = false
    const next = els.map((el) => {
      const ts = tracksByEl.get(el.id)
      let curr = el
      if (ts && ts.length > 0) {
        const bakedTransform = mergeTransformFromTracks(el.transform, el.id, ts, 0)
        const bakedAttrs = mergeAttrsFromTracks(el.attrs, el.id, ts, 0)
        const transformChanged = (Object.keys(bakedTransform) as (keyof Transform)[]).some(
          (k) => bakedTransform[k] !== el.transform[k]
        )
        /** mergeAttrsFromTracks returns a new object — compare by value to avoid spurious clones. */
        let attrsChanged = false
        for (const k of Object.keys(bakedAttrs)) {
          if (bakedAttrs[k] !== el.attrs[k]) {
            attrsChanged = true
            break
          }
        }
        if (transformChanged || attrsChanged) {
          curr = {
            ...el,
            transform: transformChanged ? bakedTransform : el.transform,
            attrs: attrsChanged ? bakedAttrs : el.attrs
          }
          mutated = true
        }
      }
      if (curr.children && curr.children.length > 0) {
        const nextKids = walk(curr.children)
        if (nextKids !== curr.children) {
          curr = { ...curr, children: nextKids }
          mutated = true
        }
      }
      if (curr !== el) listChanged = true
      return curr
    })
    return listChanged ? next : els
  }
  const result = walk(roots)
  return mutated ? result : roots
}

function captureHistory(state: EditorState): HistorySnapshot {
  return {
    elements: structuredClone(state.project.elements),
    tracks: structuredClone(state.tracks),
    gradients: structuredClone(state.project.gradients),
    symbols: structuredClone(state.project.symbols)
  }
}

function applyHistory(state: EditorState, snap: HistorySnapshot): Partial<EditorState> {
  return {
    project: {
      ...state.project,
      elements: snap.elements,
      gradients: snap.gradients,
      symbols: snap.symbols
    },
    tracks: snap.tracks
  }
}

function upsertKeyframeInTracks(
  tracks: AnimationTrack[],
  elementId: string,
  property: AnimatableProperty,
  time: number,
  value: number,
  easing?: EasingId,
  valueText?: string
): AnimationTrack[] {
  const EPS = 1e-4
  let tid = tracks.find((t) => t.elementId === elementId && t.property === property)?.id
  const next = [...tracks]
  if (!tid) {
    tid = nanoid(8)
    next.push({ id: tid, elementId, property, keyframes: [] })
  }
  return next.map((tr) => {
    if (tr.id !== tid) return tr
    const kfs = [...tr.keyframes]
    const idx = kfs.findIndex((k) => Math.abs(k.time - time) < EPS)
    const prev = idx >= 0 ? kfs[idx] : undefined
    const k: Keyframe = {
      id: idx >= 0 ? kfs[idx]!.id : nanoid(8),
      time,
      value,
      easing: easing ?? prev?.easing
    }
    if (ATTR_TEXT_STEP_PROPERTIES.has(property)) {
      k.valueText = valueText ?? prev?.valueText ?? ''
    } else if (valueText !== undefined) {
      k.valueText = valueText
    }
    if (idx >= 0) kfs[idx] = k
    else kfs.push(k)
    kfs.sort((a, b) => a.time - b.time)
    return { ...tr, keyframes: kfs }
  })
}

export const useEditorStore = create<EditorState>((set, get) => {
  const withHistory =
    (fn: (s: EditorState) => Partial<EditorState>, opts?: { skipHistory?: boolean }) => {
      if (!opts?.skipHistory) {
        const snap = captureHistory(get())
        set((s) => ({
          ...fn(s),
          historyPast: [...s.historyPast, snap].slice(-HISTORY_MAX),
          historyFuture: []
        }))
      } else {
        set(fn)
      }
    }

  return {
    project: emptyProject(),
    projectPath: null,
    selectedIds: [],
    tracks: [],
    currentTime: 0,
    duration: 3,
    fps: 60,
    playbackSpeed: 1,
    isPlaying: false,
    loop: false,
    gsapCanvasDriver: false,
    mode: 'draw',
    activeTool: 'select',
    autoKeyframe: true,
    viewBox: { x: 0, y: 0, width: 800, height: 600 },
    zoom: 1,

    canvasGuideType: 'none',
    canvasGuideSpacing: 40,
    canvasGuideOpacity: 0.28,
    canvasGuideColor: '#94a3b8',
    canvasGuideOverlayVisible: true,
    canvasGuidePanelCollapsed: true,
    canvasGuideHorizon: 0.52,
    canvasGuideVp1: { nx: 0.5, ny: 0.52 },
    canvasGuideVpLeft: { nx: -0.35, ny: 0.52 },
    canvasGuideVpRight: { nx: 1.35, ny: 0.52 },
    canvasGuideVpTop: { nx: 0.5, ny: -0.45 },
    canvasGuideFisheyeCenter: { nx: 0.5, ny: 0.5 },

    historyPast: [],
    historyFuture: [],

    symbolEditBackup: null,

    selectedKeyframes: [],
    keyframeClipboard: null,

    pushHistory: () => {
      const snap = captureHistory(get())
      set((s) => ({
        historyPast: [...s.historyPast, snap].slice(-HISTORY_MAX),
        historyFuture: []
      }))
    },

    undo: () => {
      const { historyPast, historyFuture } = get()
      if (historyPast.length === 0) return
      const now = captureHistory(get())
      const prev = historyPast[historyPast.length - 1]
      set({
        ...applyHistory(get(), prev),
        historyPast: historyPast.slice(0, -1),
        historyFuture: [now, ...historyFuture]
      })
    },

    redo: () => {
      const { historyPast, historyFuture } = get()
      if (historyFuture.length === 0) return
      const now = captureHistory(get())
      const next = historyFuture[0]
      set({
        ...applyHistory(get(), next),
        historyPast: [...historyPast, now],
        historyFuture: historyFuture.slice(1)
      })
    },

    clearHistory: () => set({ historyPast: [], historyFuture: [] }),

    evictToEmptyProject: () => {
      if (get().symbolEditBackup) return
      const p = emptyProject()
      set({
        project: p,
        selectedIds: [],
        selectedKeyframes: [],
        keyframeClipboard: null,
        tracks: [],
        viewBox: { x: 0, y: 0, width: p.width, height: p.height },
        historyPast: [],
        historyFuture: []
      })
    },

    newProject: () => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish or cancel symbol editing before starting a new project.')
        return
      }
      const p = emptyProject()
      set({
        project: p,
        projectPath: null,
        activeTool: 'select',
        selectedIds: [],
        selectedKeyframes: [],
        keyframeClipboard: null,
        tracks: [],
        currentTime: 0,
        playbackSpeed: 1,
        gsapCanvasDriver: false,
        viewBox: { x: 0, y: 0, width: p.width, height: p.height },
        historyPast: [],
        historyFuture: []
      })
    },

    setProject: (p, path = null) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish or cancel symbol editing before loading a project.')
        return
      }
      set({
        project: {
          ...p,
          gradients: p.gradients ?? [],
          symbols: p.symbols ?? []
        },
        projectPath: path ?? null,
        selectedKeyframes: [],
        keyframeClipboard: null,
        viewBox: { x: 0, y: 0, width: p.width, height: p.height },
        historyPast: [],
        historyFuture: []
      })
    },

    importSvgFromString: (svg, name, opts) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish or cancel symbol editing before importing SVG.')
        return
      }
      const p = importSvgString(svg, name ?? 'Imported')
      // Raster traces can replace the doc with an enormous layer tree. Pushing a history snapshot
      // clones the previous project via structuredClone — peak memory can OOM the renderer.
      if (opts?.resetHistory) {
        set({
          project: p,
          selectedIds: [],
          selectedKeyframes: [],
          keyframeClipboard: null,
          tracks: [],
          viewBox: { x: 0, y: 0, width: p.width, height: p.height },
          historyPast: [],
          historyFuture: []
        })
      } else {
        withHistory(() => ({
          project: p,
          selectedIds: [],
          selectedKeyframes: [],
          keyframeClipboard: null,
          tracks: [],
          viewBox: { x: 0, y: 0, width: p.width, height: p.height }
        }))
      }
    },

    importRasterManualReference: (dataUrl, width, height, projectName) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish or cancel symbol editing before importing raster.')
        return
      }
      const id = nanoid(10)
      const img: VectorElement = {
        id,
        name: 'Raster reference',
        type: 'image',
        attrs: { href: dataUrl, width, height },
        transform: defaultTransform(),
        visible: true,
        locked: true
      }
      const p = emptyProject()
      p.name = projectName.trim() || 'Manual trace'
      p.width = width
      p.height = height
      p.elements = [img]
      set({
        project: p,
        projectPath: null,
        selectedIds: [id],
        selectedKeyframes: [],
        keyframeClipboard: null,
        tracks: [],
        viewBox: { x: 0, y: 0, width, height },
        historyPast: [],
        historyFuture: [],
        activeTool: 'pen',
        mode: 'draw'
      })
    },

    setElements: (elements, opts) =>
      withHistory(
        (s) => ({
          project: { ...s.project, elements }
        }),
        opts
      ),

    setProjectMeta: (partial, opts) =>
      withHistory(
        (s) => ({
          project: { ...s.project, ...partial }
        }),
        opts
      ),

    setCanvasSize: (width, height, opts) => {
      const w = Math.max(1, Math.round(width))
      const h = Math.max(1, Math.round(height))
      withHistory(
        (s) => ({
          project: { ...s.project, width: w, height: h },
          viewBox: { x: 0, y: 0, width: w, height: h }
        }),
        opts
      )
    },

    select: (ids) => set({ selectedIds: ids, selectedKeyframes: [] }),
    addToSelection: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id) ? s.selectedIds : [...s.selectedIds, id],
        selectedKeyframes: []
      })),
    clearSelection: () => set({ selectedIds: [], selectedKeyframes: [] }),

    setMode: (m) =>
      set((s) => {
        let nextTool = s.activeTool
        if (m === 'export') nextTool = 'select'
        else if (
          (m === 'animate' || m === 'preview') &&
          nextTool !== 'select' &&
          nextTool !== 'hand' &&
          nextTool !== 'path-edit'
        ) {
          nextTool = 'select'
        }
        /**
         * Crossing between Draw / Animate / Preview should give the user a clean
         * slate: stop playback, rewind to t=0, and drop the current selection so
         * the inspector and selection overlays don't carry stale state into the
         * new mode.
         */
        const modeChanged = m !== s.mode
        /**
         * When entering Draw mode, bake the t=0 sample of every animated property into
         * the layer's base `transform` / `attrs`. Draw view renders the resting pose
         * (`el.transform`), so without this step the user keeps seeing whatever frame
         * they scrubbed to in Animate. After baking, the resting pose IS the t=0 frame,
         * which is what users expect when they switch tabs.
         */
        const nextElements =
          modeChanged && m === 'draw' && s.tracks.length > 0
            ? bakeTracksAtZero(s.project.elements, s.tracks)
            : s.project.elements
        return {
          mode: m,
          activeTool: nextTool,
          ...(modeChanged
            ? {
                isPlaying: false,
                currentTime: 0,
                selectedIds: [],
                selectedKeyframes: []
              }
            : {}),
          ...(nextElements !== s.project.elements
            ? { project: { ...s.project, elements: nextElements } }
            : {})
        }
      }),
    setActiveTool: (tool) => set({ activeTool: tool }),
    setAutoKeyframe: (v) => set({ autoKeyframe: v }),
    setViewBox: (vb) => set({ viewBox: vb }),
    setZoom: (z) => set({ zoom: Math.max(0.05, Math.min(32, z)) }),
    panBy: (dx, dy) =>
      set((s) => ({
        viewBox: {
          ...s.viewBox,
          x: s.viewBox.x - dx / s.zoom,
          y: s.viewBox.y - dy / s.zoom
        }
      })),

    setCanvasGuideType: (t) => set({ canvasGuideType: t }),
    setCanvasGuideSpacing: (n) => set({ canvasGuideSpacing: Math.max(8, Math.min(200, n)) }),
    setCanvasGuideOpacity: (n) => set({ canvasGuideOpacity: Math.max(0.06, Math.min(0.55, n)) }),
    setCanvasGuideColor: (c) => set({ canvasGuideColor: c }),
    setCanvasGuideOverlayVisible: (v) => set({ canvasGuideOverlayVisible: v }),
    setCanvasGuidePanelCollapsed: (v) => set({ canvasGuidePanelCollapsed: v }),
    setCanvasGuideHorizon: (n) => {
      const ny = Math.max(0.08, Math.min(0.92, n))
      set((s) => ({
        canvasGuideHorizon: ny,
        canvasGuideVp1: { ...s.canvasGuideVp1, ny },
        canvasGuideVpLeft: { ...s.canvasGuideVpLeft, ny },
        canvasGuideVpRight: { ...s.canvasGuideVpRight, ny }
      }))
    },
    setCanvasGuideVp1: (p) =>
      set((s) => ({
        canvasGuideVp1: {
          nx: p.nx !== undefined ? clampGuideCoord(p.nx) : s.canvasGuideVp1.nx,
          ny: p.ny !== undefined ? clampGuideCoord(p.ny) : s.canvasGuideVp1.ny
        }
      })),
    setCanvasGuideVpLeft: (p) =>
      set((s) => {
        const nx = p.nx !== undefined ? clampGuideCoord(p.nx) : s.canvasGuideVpLeft.nx
        const ny = p.ny !== undefined ? clampGuideCoord(p.ny) : s.canvasGuideVpLeft.ny
        const syncNy = p.ny !== undefined
        return {
          canvasGuideVpLeft: { nx, ny },
          canvasGuideVpRight: syncNy ? { ...s.canvasGuideVpRight, ny } : s.canvasGuideVpRight
        }
      }),
    setCanvasGuideVpRight: (p) =>
      set((s) => {
        const nx = p.nx !== undefined ? clampGuideCoord(p.nx) : s.canvasGuideVpRight.nx
        const ny = p.ny !== undefined ? clampGuideCoord(p.ny) : s.canvasGuideVpRight.ny
        const syncNy = p.ny !== undefined
        return {
          canvasGuideVpRight: { nx, ny },
          canvasGuideVpLeft: syncNy ? { ...s.canvasGuideVpLeft, ny } : s.canvasGuideVpLeft
        }
      }),
    setCanvasGuideVpTop: (p) =>
      set((s) => ({
        canvasGuideVpTop: {
          nx: p.nx !== undefined ? clampGuideCoord(p.nx) : s.canvasGuideVpTop.nx,
          ny: p.ny !== undefined ? clampGuideCoord(p.ny) : s.canvasGuideVpTop.ny
        }
      })),
    setCanvasGuideFisheyeCenter: (p) =>
      set((s) => ({
        canvasGuideFisheyeCenter: {
          nx: p.nx !== undefined ? clampGuideCoord(p.nx) : s.canvasGuideFisheyeCenter.nx,
          ny: p.ny !== undefined ? clampGuideCoord(p.ny) : s.canvasGuideFisheyeCenter.ny
        }
      })),

    setCurrentTime: (t) => {
      const d = get().duration
      set({ currentTime: Math.max(0, Math.min(d, t)) })
    },
    setDuration: (d) =>
      set((s) => {
        const duration = Math.max(0.1, d)
        return {
          duration,
          currentTime: Math.min(s.currentTime, duration),
          tracks: s.tracks.map((tr) => ({
            ...tr,
            keyframes: tr.keyframes
              .map((k) => ({ ...k, time: Math.min(k.time, duration) }))
              .sort((a, b) => a.time - b.time)
          }))
        }
      }),
    setFps: (f) => set({ fps: Math.max(1, Math.min(120, f)) }),
    setPlaybackSpeed: (n) => set({ playbackSpeed: Math.max(0.05, Math.min(8, n)) }),
    setLoop: (v) => set({ loop: v }),
    setIsPlaying: (v) => set({ isPlaying: v }),
    setGsapCanvasDriver: (v) => set({ gsapCanvasDriver: v }),

    updateTransform: (id, partial, opts) => {
      const s0 = get()
      const inAnimateLikeMode = s0.mode === 'animate' || s0.mode === 'preview'
      const props = Object.keys(partial) as (keyof Transform)[]
      /**
       * In Animate / Preview, only the keyframe at the playhead changes — the layer's
       * BASE transform (`el.transform`) must stay untouched so that Draw view always
       * reflects the t=0 (or unanimated) state of every property. Otherwise scrubbing
       * in Animate silently rewrites the base and Draw view shows "random" frames.
       */
      const newEls = inAnimateLikeMode
        ? s0.project.elements
        : updateElementById(s0.project.elements, id, (el) => ({
            ...el,
            transform: { ...el.transform, ...partial }
          }))
      let newTracks = s0.tracks
      if (inAnimateLikeMode && !s0.isPlaying) {
        const fresh = flattenForLayers(s0.project.elements).find((x) => x.el.id === id)?.el
        if (fresh && !fresh.locked) {
          for (const key of props) {
            if (
              !['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'skewX', 'skewY'].includes(key)
            )
              continue
            const nextVal = (partial as Partial<Transform>)[key]
            if (typeof nextVal !== 'number') continue
            newTracks = upsertKeyframeInTracks(
              newTracks,
              id,
              key as AnimatableProperty,
              s0.currentTime,
              nextVal,
              undefined
            )
          }
        }
      }
      if (!opts?.skipHistory) {
        const snap = captureHistory(s0)
        set((s) => ({
          project: { ...s.project, elements: newEls },
          tracks: newTracks,
          historyPast: [...s.historyPast, snap].slice(-HISTORY_MAX),
          historyFuture: []
        }))
      } else {
        set({ project: { ...s0.project, elements: newEls }, tracks: newTracks })
      }
    },

    setElementName: (id, name, opts) =>
      withHistory(
        (s) => ({
          project: {
            ...s.project,
            elements: updateElementById(s.project.elements, id, (el) => ({ ...el, name }))
          }
        }),
        opts
      ),

    setElementAttrs: (id, attrs, opts) =>
      withHistory(
        (s) => {
          const newEls = updateElementById(s.project.elements, id, (el) => ({
            ...el,
            attrs: { ...el.attrs, ...attrs }
          }))
          let nextTracks = s.tracks
          if (
            (s.mode === 'animate' || s.mode === 'preview') &&
            !s.isPlaying &&
            !opts?.skipHistory
          ) {
            const fresh = flattenForLayers(newEls).find((x) => x.el.id === id)?.el
            if (fresh && !fresh.locked) {
              const t = s.currentTime
              const pushPackedColor = (prop: 'fill' | 'stroke' | 'fxShadowColor', key: string) => {
                if (!(key in attrs)) return
                const raw = attrs[key]
                if (typeof raw !== 'string' || !raw.startsWith('#')) return
                const p = hexToPackedRgb(raw)
                if (p !== undefined) {
                  nextTracks = upsertKeyframeInTracks(nextTracks, id, prop, t, p)
                }
              }
              pushPackedColor('fill', 'fill')
              pushPackedColor('stroke', 'stroke')
              pushPackedColor('fxShadowColor', '__fxShadowColor')
              if ('stroke-width' in attrs) {
                const sw = attrs['stroke-width']
                const n = typeof sw === 'number' ? sw : Number(sw)
                if (Number.isFinite(n)) {
                  nextTracks = upsertKeyframeInTracks(nextTracks, id, 'strokeWidth', t, n)
                }
              }
              if ('d' in attrs && typeof attrs.d === 'string') {
                nextTracks = upsertKeyframeInTracks(nextTracks, id, 'pathD', t, 0, undefined, attrs.d)
              }
              const numFx: Array<{ prop: AnimatableProperty; key: string }> = [
                { prop: 'fxBlur', key: '__fxBlur' },
                { prop: 'fxShadowX', key: '__fxShadowX' },
                { prop: 'fxShadowY', key: '__fxShadowY' },
                { prop: 'fxShadowBlur', key: '__fxShadowBlur' }
              ]
              for (const { prop, key } of numFx) {
                if (!(key in attrs)) continue
                const v = attrs[key]
                const n = typeof v === 'number' ? v : Number(v)
                if (Number.isFinite(n)) {
                  nextTracks = upsertKeyframeInTracks(nextTracks, id, prop, t, n)
                }
              }
              if ('mask' in attrs && typeof attrs.mask === 'string') {
                nextTracks = upsertKeyframeInTracks(nextTracks, id, 'mask', t, 0, undefined, attrs.mask)
              }
              if ('clip-path' in attrs && typeof attrs['clip-path'] === 'string') {
                nextTracks = upsertKeyframeInTracks(
                  nextTracks,
                  id,
                  'clipPath',
                  t,
                  0,
                  undefined,
                  attrs['clip-path']
                )
              }
              if ('filter' in attrs && typeof attrs.filter === 'string') {
                nextTracks = upsertKeyframeInTracks(nextTracks, id, 'svgFilter', t, 0, undefined, attrs.filter)
              }
            }
          }
          return {
            project: {
              ...s.project,
              elements: newEls
            },
            tracks: nextTracks
          }
        },
        opts
      ),

    toggleVisible: (id, opts) =>
      withHistory(
        (s) => ({
          project: {
            ...s.project,
            elements: updateElementById(s.project.elements, id, (el) => ({
              ...el,
              visible: el.visible === false ? true : false
            }))
          }
        }),
        opts
      ),

    toggleLock: (id, opts) =>
      withHistory(
        (s) => ({
          project: {
            ...s.project,
            elements: updateElementById(s.project.elements, id, (el) => ({
              ...el,
              locked: !el.locked
            }))
          }
        }),
        opts
      ),

    reorderLayers: (dragId, targetId, place, opts) =>
      withHistory(
        (s) => ({
          project: {
            ...s.project,
            elements: reorderSiblings(s.project.elements, dragId, targetId, place)
          }
        }),
        opts
      ),

    deleteSelected: (opts) => {
      const ids = get().selectedIds
      if (ids.length === 0) return
      withHistory(
        (s) => {
          let els = s.project.elements
          for (const id of ids) {
            els = removeElementById(els, id)
          }
          return {
            project: { ...s.project, elements: els },
            selectedIds: [],
            selectedKeyframes: s.selectedKeyframes.filter((sel) => {
              const tr = s.tracks.find((t) => t.id === sel.trackId)
              return tr && !ids.includes(tr.elementId)
            }),
            tracks: s.tracks.filter((tr) => !ids.includes(tr.elementId))
          }
        },
        opts
      )
    },

    deleteLayerById: (id, opts) =>
      withHistory(
        (s) => ({
          project: { ...s.project, elements: removeElementById(s.project.elements, id) },
          selectedIds: s.selectedIds.filter((sid) => sid !== id),
          selectedKeyframes: s.selectedKeyframes.filter((sel) => {
            const tr = s.tracks.find((t) => t.id === sel.trackId)
            return tr && tr.elementId !== id
          }),
          tracks: s.tracks.filter((tr) => tr.elementId !== id)
        }),
        opts
      ),

    groupSelection: () => {
      const s0 = get()
      if (s0.mode === 'preview' || s0.mode === 'export') return
      const result = groupSelectedElements(s0.project.elements, s0.selectedIds)
      if (!result) {
        void dialogAlert(
          'Select two or more sibling layers (same folder or root). Locked layers and symbol instances cannot be grouped.'
        )
        return
      }
      withHistory(() => ({
        project: { ...s0.project, elements: result.roots },
        selectedIds: [result.groupId],
        selectedKeyframes: []
      }))
    },

    duplicateSelection: () => {
      const s0 = get()
      if (s0.mode === 'preview' || s0.mode === 'export') return
      if (s0.selectedIds.length === 0) return
      const result = duplicateSelectedInDocument(s0.project.elements, s0.selectedIds, s0.tracks)
      if (!result || result.newSelectedIds.length === 0) return
      withHistory(() => ({
        project: { ...s0.project, elements: result.roots },
        tracks: result.tracks,
        selectedIds: result.newSelectedIds,
        selectedKeyframes: []
      }))
    },

    addElement: (element, opts) =>
      withHistory(
        (s) => ({
          project: {
            ...s.project,
            elements: [...s.project.elements, element]
          },
          selectedIds: opts?.select === false ? s.selectedIds : [element.id]
        }),
        opts
      ),

    ensureTrack: (elementId, property) => {
      const existing = get().tracks.find((t) => t.elementId === elementId && t.property === property)
      if (existing) return existing.id
      const id = nanoid(8)
      set((s) => ({ tracks: [...s.tracks, { id, elementId, property, keyframes: [] }] }))
      return id
    },

    upsertKeyframe: (elementId, property, time, value, easing, opts) => {
      const EPS = 1e-4
      const valueText = opts?.valueText
      const mut = (s: EditorState): Partial<EditorState> => {
        let tracks = s.tracks
        let tid = tracks.find((t) => t.elementId === elementId && t.property === property)?.id
        if (!tid) {
          tid = nanoid(8)
          tracks = [...tracks, { id: tid, elementId, property, keyframes: [] }]
        }
        const nextTracks = tracks.map((tr) => {
          if (tr.id !== tid) return tr
          const kfs = [...tr.keyframes]
          const idx = kfs.findIndex((k) => Math.abs(k.time - time) < EPS)
          const prev = idx >= 0 ? kfs[idx] : undefined
          const k: Keyframe = {
            id: idx >= 0 ? kfs[idx]!.id : nanoid(8),
            time,
            value,
            easing: easing ?? prev?.easing
          }
          if (ATTR_TEXT_STEP_PROPERTIES.has(property)) {
            k.valueText = valueText ?? prev?.valueText ?? ''
          } else if (valueText !== undefined) {
            k.valueText = valueText
          }
          if (idx >= 0) kfs[idx] = k
          else kfs.push(k)
          kfs.sort((a, b) => a.time - b.time)
          return { ...tr, keyframes: kfs }
        })
        return { tracks: nextTracks }
      }
      if (!opts?.skipHistory) {
        const snap = captureHistory(get())
        set((s) => ({
          ...mut(s),
          historyPast: [...s.historyPast, snap].slice(-HISTORY_MAX),
          historyFuture: []
        }))
      } else {
        set(mut)
      }
    },

    removeKeyframe: (trackId, keyframeId, opts) =>
      withHistory(
        (s) => ({
          tracks: s.tracks
            .map((tr) =>
              tr.id !== trackId
                ? tr
                : { ...tr, keyframes: tr.keyframes.filter((k) => k.id !== keyframeId) }
            )
            .filter((tr) => tr.keyframes.length > 0)
        }),
        opts
      ),

    moveKeyframe: (trackId, keyframeId, time, opts) =>
      withHistory(
        (s) => {
          const clamped = Math.max(0, Math.min(s.duration, time))
          return {
            tracks: s.tracks.map((tr) => {
              if (tr.id !== trackId) return tr
              return {
                ...tr,
                keyframes: tr.keyframes
                  .map((k) => (k.id === keyframeId ? { ...k, time: clamped } : k))
                  .sort((a, b) => a.time - b.time)
              }
            })
          }
        },
        opts
      ),

    setSelectedKeyframes: (entries) => set({ selectedKeyframes: entries }),

    clearKeyframeSelection: () => set({ selectedKeyframes: [] }),

    setKeyframeEasing: (trackId, keyframeId, easing) =>
      withHistory((s) => ({
        tracks: s.tracks.map((tr) => {
          if (tr.id !== trackId) return tr
          return {
            ...tr,
            keyframes: tr.keyframes.map((k) => (k.id === keyframeId ? { ...k, easing } : k))
          }
        })
      })),

    copySelectedKeyframes: () => {
      const s = get()
      if (s.selectedKeyframes.length === 0) {
        set({ keyframeClipboard: null })
        return
      }
      const items: KeyframeClipboardEntry[] = []
      let minT = Infinity
      for (const sel of s.selectedKeyframes) {
        const tr = s.tracks.find((t) => t.id === sel.trackId)
        const k = tr?.keyframes.find((x) => x.id === sel.keyframeId)
        if (tr && k) minT = Math.min(minT, k.time)
      }
      if (!Number.isFinite(minT)) {
        set({ keyframeClipboard: null })
        return
      }
      for (const sel of s.selectedKeyframes) {
        const tr = s.tracks.find((t) => t.id === sel.trackId)
        const k = tr?.keyframes.find((x) => x.id === sel.keyframeId)
        if (tr && k) {
          items.push({
            elementId: tr.elementId,
            property: tr.property,
            offsetFromAnchor: k.time - minT,
            value: k.value,
            valueText: k.valueText,
            easing: k.easing
          })
        }
      }
      items.sort((a, b) => a.offsetFromAnchor - b.offsetFromAnchor)
      set({ keyframeClipboard: items })
    },

    pasteKeyframesAtTime: (anchorTime) => {
      const s = get()
      const clip = s.keyframeClipboard
      if (!clip || clip.length === 0) return
      const t0 = anchorTime ?? s.currentTime
      get().pushHistory()
      const sorted = [...clip].sort((a, b) => a.offsetFromAnchor - b.offsetFromAnchor)
      for (const entry of sorted) {
        get().upsertKeyframe(
          entry.elementId,
          entry.property,
          t0 + entry.offsetFromAnchor,
          entry.value,
          entry.easing,
          { skipHistory: true, valueText: entry.valueText }
        )
      }
    },

    nudgeSelectedKeyframes: (deltaSec) => {
      const s0 = get()
      if (s0.selectedKeyframes.length === 0) return
      const d = s0.duration
      const byTrack = new Map<string, Set<string>>()
      for (const { trackId, keyframeId } of s0.selectedKeyframes) {
        if (!byTrack.has(trackId)) byTrack.set(trackId, new Set())
        byTrack.get(trackId)!.add(keyframeId)
      }
      get().pushHistory()
      for (const [trackId, idSet] of byTrack) {
        for (const keyframeId of idSet) {
          const tr = get().tracks.find((t) => t.id === trackId)
          const k = tr?.keyframes.find((x) => x.id === keyframeId)
          if (!k) continue
          const nt = Math.max(0, Math.min(d, k.time + deltaSec))
          get().moveKeyframe(trackId, keyframeId, nt, { skipHistory: true })
        }
      }
    },

    deleteSelectedKeyframes: () => {
      const s0 = get()
      if (s0.selectedKeyframes.length === 0) return
      const removeByTrack = new Map<string, Set<string>>()
      for (const { trackId, keyframeId } of s0.selectedKeyframes) {
        if (!removeByTrack.has(trackId)) removeByTrack.set(trackId, new Set())
        removeByTrack.get(trackId)!.add(keyframeId)
      }
      withHistory((s) => ({
        tracks: s.tracks
          .map((tr) => {
            const rm = removeByTrack.get(tr.id)
            if (!rm) return tr
            return { ...tr, keyframes: tr.keyframes.filter((k) => !rm.has(k.id)) }
          })
          .filter((tr) => tr.keyframes.length > 0),
        selectedKeyframes: []
      }))
    },

    addKeyframeAtPlayhead: (elementId, property) => {
      const s = get()
      const el = flattenForLayers(s.project.elements).find((x) => x.el.id === elementId)?.el
      if (!el) return
      const t = s.currentTime
      const tracks = s.tracks

      const transformKeys: AnimatableProperty[] = [
        'x',
        'y',
        'scaleX',
        'scaleY',
        'rotation',
        'opacity',
        'skewX',
        'skewY'
      ]
      if (transformKeys.includes(property)) {
        const merged = mergeTransformFromTracks(el.transform, elementId, tracks, t)
        const value = merged[property as keyof typeof merged] as number
        get().upsertKeyframe(elementId, property, t, value)
        return
      }

      const mergedAttrs = mergeAttrsFromTracks(el.attrs, elementId, tracks, t)

      if (property === 'fill' || property === 'stroke' || property === 'fxShadowColor') {
        const raw =
          property === 'fxShadowColor'
            ? mergedAttrs.__fxShadowColor
            : mergedAttrs[property]
        const s0 = typeof raw === 'string' ? raw : '#cccccc'
        const packed = hexToPackedRgb(s0.startsWith('#') ? s0 : '#cccccc')
        if (packed === undefined) return
        get().upsertKeyframe(elementId, property, t, packed)
        return
      }

      if (property === 'pathD') {
        const d = typeof mergedAttrs.d === 'string' ? mergedAttrs.d : ''
        get().upsertKeyframe(elementId, property, t, 0, undefined, { valueText: d })
        return
      }

      if (property === 'strokeWidth') {
        const sw = mergedAttrs['stroke-width']
        const n = typeof sw === 'number' ? sw : Number(sw)
        get().upsertKeyframe(elementId, property, t, Number.isFinite(n) ? n : 2)
        return
      }

      if (
        property === 'fxBlur' ||
        property === 'fxShadowX' ||
        property === 'fxShadowY' ||
        property === 'fxShadowBlur'
      ) {
        const map: Record<typeof property, string> = {
          fxBlur: '__fxBlur',
          fxShadowX: '__fxShadowX',
          fxShadowY: '__fxShadowY',
          fxShadowBlur: '__fxShadowBlur'
        }
        const k = map[property]
        const v = mergedAttrs[k as keyof typeof mergedAttrs]
        const n = typeof v === 'number' ? v : Number(v)
        get().upsertKeyframe(elementId, property, t, Number.isFinite(n) ? n : 0)
        return
      }

      if (property === 'motionPathOffset') {
        const trk = tracks.find((x) => x.elementId === elementId && x.property === 'motionPathOffset')
        let v = 0
        if (trk) {
          const s = sampleTrack(trk, t)
          if (s !== undefined) v = s
        }
        get().upsertKeyframe(elementId, property, t, Math.max(0, Math.min(1, v)))
        return
      }

      if (property === 'mask') {
        const raw = mergedAttrs.mask
        get().upsertKeyframe(elementId, property, t, 0, undefined, {
          valueText: typeof raw === 'string' ? raw : ''
        })
        return
      }

      if (property === 'clipPath') {
        const raw = mergedAttrs['clip-path']
        get().upsertKeyframe(elementId, property, t, 0, undefined, {
          valueText: typeof raw === 'string' ? raw : ''
        })
        return
      }

      if (property === 'svgFilter') {
        const raw = mergedAttrs.filter
        get().upsertKeyframe(elementId, property, t, 0, undefined, {
          valueText: typeof raw === 'string' ? raw : ''
        })
        return
      }
    },

    jumpToPrevKeyframe: () => {
      const s = get()
      const t = s.currentTime
      let best: number | null = null
      for (const tr of s.tracks) {
        for (const k of tr.keyframes) {
          if (k.time < t - 1e-6) {
            if (best === null || k.time > best) best = k.time
          }
        }
      }
      if (best !== null) set({ currentTime: best })
      else set({ currentTime: 0 })
    },

    jumpToNextKeyframe: () => {
      const s = get()
      const t = s.currentTime
      let best: number | null = null
      for (const tr of s.tracks) {
        for (const k of tr.keyframes) {
          if (k.time > t + 1e-6) {
            if (best === null || k.time < best) best = k.time
          }
        }
      }
      if (best !== null) set({ currentTime: Math.min(s.duration, best) })
      else set({ currentTime: s.duration })
    },

    setTracks: (nextTracks, opts) =>
      withHistory(() => ({ tracks: nextTracks }), opts),

    pruneTracksForElement: (elementId, opts) =>
      withHistory(
        (s) => ({
          tracks: s.tracks.filter((t) => t.elementId !== elementId)
        }),
        opts
      ),

    upsertGradient: (g, opts) =>
      withHistory(
        (s) => ({
          project: {
            ...s.project,
            gradients: [...s.project.gradients.filter((x) => x.id !== g.id), g]
          }
        }),
        opts
      ),

    applyBooleanOperation: (op) => {
      const BOOLEAN_TYPES = new Set([
        'path',
        'rect',
        'circle',
        'ellipse',
        'line',
        'polygon',
        'polyline'
      ])
      const s0 = get()
      const ids = s0.selectedIds
      if (ids.length < 2) return
      const locs = ids
        .map((id) => findElement(s0.project.elements, id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
      if (locs.length !== ids.length) return
      if (!locs.every((l) => BOOLEAN_TYPES.has(l.node.type))) {
        void dialogAlert('Boolean operations work on paths and basic shapes only.')
        return
      }
      const parentKey = (l: (typeof locs)[number]) => l.parent?.id ?? '__root__'
      const headLoc = locs[0]
      if (!headLoc) return
      const pk = parentKey(headLoc)
      if (!locs.every((l) => parentKey(l) === pk)) {
        void dialogAlert('Select shapes that share the same parent layer.')
        return
      }

      const mps: MultiPolygon[] = []
      for (const loc of locs) {
        const chain = findAncestorChain(s0.project.elements, loc.node.id)
        if (!chain) return
        const world = multiplyWorldMatrices(chain.map((n) => n.transform))
        const mp = elementToWorldMultiPolygon(loc.node, world)
        if (!mp?.length) {
          void dialogAlert('Could not build geometry for one of the selected shapes.')
          return
        }
        mps.push(mp)
      }

      if (mps.length < 2) return

      let result: MultiPolygon
      try {
        if (op === 'union') {
          let acc = mps[0]!
          for (let i = 1; i < mps.length; i++) acc = union(acc, mps[i]!)
          result = acc
        } else if (op === 'intersect') {
          let acc = mps[0]!
          for (let i = 1; i < mps.length; i++) acc = intersection(acc, mps[i]!)
          result = acc
        } else if (op === 'xor') {
          let acc = mps[0]!
          for (let i = 1; i < mps.length; i++) acc = xor(acc, mps[i]!)
          result = acc
        } else {
          const [first, ...rest] = mps
          if (rest.length === 0) result = first!
          else {
            let clip = rest[0]!
            for (let i = 1; i < rest.length; i++) clip = union(clip, rest[i]!)
            result = difference(first!, clip)
          }
        }
      } catch {
        void dialogAlert('Boolean operation failed (try simplifying paths).')
        return
      }

      const newD = multiPolygonToPathD(result)
      if (!newD) {
        void dialogAlert('Boolean result was empty.')
        return
      }

      const parentId = headLoc.parent?.id ?? null
      const insertIndex = Math.min(...locs.map((l) => l.index))
      const removeSet = new Set(ids)

      const newEl: VectorElement = {
        id: nanoid(10),
        name: `Merged ${s0.project.elements.length + 1}`,
        type: 'path',
        attrs: {
          d: newD,
          fill: '#d1d5db',
          stroke: '#5b8def',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'fill-rule': 'evenodd'
        },
        transform: defaultTransform(),
        visible: true,
        locked: false
      }

      let next = purgeElementsByIds(s0.project.elements, removeSet)
      next = insertElement(next, parentId, insertIndex, newEl)
      const nextTracks = s0.tracks.filter((t) => !removeSet.has(t.elementId))

      withHistory(() => ({
        project: { ...s0.project, elements: next },
        tracks: nextTracks,
        selectedIds: [newEl.id]
      }))
    },

    applyEraserStroke: (samples, width) => {
      if (samples.length < 2 || width <= 0) return
      const ring = strokeOutlineRing(samples, width)
      if (!ring) return
      const clip: MultiPolygon = [[ring]]
      withHistory((s) => ({
        project: {
          ...s.project,
          elements: applyEraserClipToTree(s.project.elements, clip)
        }
      }))
    },

    createSymbolFromSelection: (name) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish symbol editing before changing symbols on the main document.')
        return
      }
      const s0 = get()
      const roots = collectRootSelectionsForSymbol(s0.project.elements, s0.selectedIds)
      if (!roots) {
        void dialogAlert('Select one or more top-level layers (not nested groups, not symbol instances).')
        return
      }
      let template: VectorElement
      if (roots.length === 1) {
        template = deepCloneElementNewIds(roots[0]!)
      } else {
        template = {
          id: nanoid(10),
          name: name ?? 'Symbol',
          type: 'group',
          attrs: {},
          transform: defaultTransform(),
          visible: true,
          locked: false,
          children: roots.map((r) => deepCloneElementNewIds(r))
        }
      }
      const symName = name ?? roots[0]?.name ?? 'Symbol'
      const sym: SymbolDefinition = { id: nanoid(8), name: symName, template }
      const removeIds = new Set(roots.map((r) => r.id))
      withHistory((s) => {
        const nextElements = s.project.elements.filter((e) => !removeIds.has(e.id))
        const nextTracks = s.tracks.filter((t) => !removeIds.has(t.elementId))
        return {
          project: {
            ...s.project,
            elements: nextElements,
            symbols: [...s.project.symbols, sym]
          },
          tracks: nextTracks,
          selectedIds: []
        }
      })
    },

    updateSymbolTemplateFromSelection: (symbolId) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish symbol editing before changing symbols on the main document.')
        return
      }
      const s0 = get()
      if (!s0.project.symbols.some((x) => x.id === symbolId)) return
      const roots = collectRootSelectionsForSymbol(s0.project.elements, s0.selectedIds)
      if (!roots) {
        void dialogAlert('Select one or more top-level layers to use as the new master.')
        return
      }
      let template: VectorElement
      if (roots.length === 1) {
        template = deepCloneElementNewIds(roots[0]!)
      } else {
        template = {
          id: nanoid(10),
          name: 'Symbol',
          type: 'group',
          attrs: {},
          transform: defaultTransform(),
          visible: true,
          locked: false,
          children: roots.map((r) => deepCloneElementNewIds(r))
        }
      }
      withHistory((s) => ({
        project: {
          ...s.project,
          symbols: s.project.symbols.map((x) =>
            x.id === symbolId ? { ...x, template } : x
          )
        }
      }))
    },

    deleteSymbol: (symbolId) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish symbol editing before changing symbols on the main document.')
        return
      }
      withHistory((s) => {
        const { roots, removedIds } = stripSymbolInstancesByMasterId(s.project.elements, symbolId)
        const removeSet = new Set(removedIds)
        const nextTracks = s.tracks.filter((t) => !removeSet.has(t.elementId))
        return {
          project: {
            ...s.project,
            elements: roots,
            symbols: s.project.symbols.filter((x) => x.id !== symbolId)
          },
          tracks: nextTracks,
          selectedIds: s.selectedIds.filter((id) => !removeSet.has(id))
        }
      })
    },

    placeSymbolInstance: (symbolId) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish symbol editing to return to the main document first.')
        return
      }
      const s0 = get()
      const def = s0.project.symbols.find((x) => x.id === symbolId)
      if (!def) return
      const inst: VectorElement = {
        id: nanoid(10),
        name: def.name,
        type: 'symbolInstance',
        attrs: { __symbolId: def.id },
        transform: defaultTransform(),
        visible: true,
        locked: false
      }
      withHistory((s) => ({
        project: { ...s.project, elements: [...s.project.elements, inst] },
        selectedIds: [inst.id]
      }))
    },

    beginSymbolEdit: (symbolId) => {
      const s = get()
      if (s.symbolEditBackup) {
        void dialogAlert('Finish editing the current symbol first.')
        return
      }
      const sym = s.project.symbols.find((x) => x.id === symbolId)
      if (!sym) return
      const restore: SymbolEditRestoreSnapshot = {
        project: structuredClone(s.project),
        projectPath: s.projectPath,
        tracks: structuredClone(s.tracks),
        selectedIds: [...s.selectedIds],
        selectedKeyframes: [...s.selectedKeyframes],
        keyframeClipboard: s.keyframeClipboard ? structuredClone(s.keyframeClipboard) : null,
        viewBox: { ...s.viewBox },
        zoom: s.zoom,
        mode: s.mode,
        activeTool: s.activeTool,
        historyPast: structuredClone(s.historyPast),
        historyFuture: structuredClone(s.historyFuture),
        currentTime: s.currentTime,
        duration: s.duration,
        fps: s.fps,
        playbackSpeed: s.playbackSpeed,
        loop: s.loop,
        autoKeyframe: s.autoKeyframe,
        isPlaying: s.isPlaying
      }
      set({
        symbolEditBackup: { symbolId, symbolName: sym.name, restore },
        project: {
          ...s.project,
          name: `${sym.name} — editing symbol`,
          elements: [structuredClone(sym.template)],
          symbols: structuredClone(s.project.symbols)
        },
        tracks: [],
        selectedIds: [],
        selectedKeyframes: [],
        keyframeClipboard: null,
        historyPast: [],
        historyFuture: [],
        mode: 'draw',
        activeTool: 'select',
        viewBox: { x: 0, y: 0, width: s.project.width, height: s.project.height },
        zoom: 1,
        currentTime: 0,
        isPlaying: false
      })
    },

    commitSymbolEdit: () => {
      const b = get().symbolEditBackup
      if (!b) return
      const els = get().project.elements
      if (els.length === 0) {
        void dialogAlert('Nothing to save — add symbol artwork before finishing.')
        return
      }
      let template: VectorElement
      if (els.length === 1) {
        template = structuredClone(els[0]!)
      } else {
        template = {
          id: nanoid(10),
          name: b.symbolName,
          type: 'group',
          attrs: {},
          transform: defaultTransform(),
          visible: true,
          locked: false,
          children: structuredClone(els)
        }
      }
      const main = b.restore.project
      const nextSymbols = main.symbols.map((x) =>
        x.id === b.symbolId ? { ...x, template } : x
      )
      set({
        symbolEditBackup: null,
        project: { ...main, symbols: nextSymbols },
        projectPath: b.restore.projectPath,
        tracks: b.restore.tracks,
        selectedIds: b.restore.selectedIds,
        selectedKeyframes: b.restore.selectedKeyframes ?? [],
        keyframeClipboard: b.restore.keyframeClipboard ?? null,
        viewBox: b.restore.viewBox,
        zoom: b.restore.zoom,
        mode: b.restore.mode,
        activeTool: b.restore.activeTool,
        historyPast: b.restore.historyPast,
        historyFuture: b.restore.historyFuture,
        currentTime: b.restore.currentTime,
        duration: b.restore.duration,
        fps: b.restore.fps,
        playbackSpeed: b.restore.playbackSpeed ?? 1,
        loop: b.restore.loop,
        autoKeyframe: b.restore.autoKeyframe,
        isPlaying: b.restore.isPlaying
      })
    },

    cancelSymbolEdit: () => {
      const b = get().symbolEditBackup
      if (!b) return
      void dialogConfirm({
        message: 'Discard edits to this symbol?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing'
      }).then((ok) => {
        if (!ok) return
        const snap = get().symbolEditBackup
        if (!snap) return
        const r = snap.restore
        set({
          symbolEditBackup: null,
          project: r.project,
          projectPath: r.projectPath,
          tracks: r.tracks,
          selectedIds: r.selectedIds,
          selectedKeyframes: r.selectedKeyframes ?? [],
          keyframeClipboard: r.keyframeClipboard ?? null,
          viewBox: r.viewBox,
          zoom: r.zoom,
          mode: r.mode,
          activeTool: r.activeTool,
          historyPast: r.historyPast,
          historyFuture: r.historyFuture,
          currentTime: r.currentTime,
          duration: r.duration,
          fps: r.fps,
          playbackSpeed: r.playbackSpeed ?? 1,
          loop: r.loop,
          autoKeyframe: r.autoKeyframe,
          isPlaying: r.isPlaying
        })
      })
    },

    detachSymbolInstance: (instanceId) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish symbol editing before detaching instances.')
        return
      }
      const s0 = get()
      const loc = findElement(s0.project.elements, instanceId)
      if (!loc || loc.node.type !== 'symbolInstance') return
      const sid = String(loc.node.attrs.__symbolId ?? '')
      const def = s0.project.symbols.find((x) => x.id === sid)
      if (!def) {
        void dialogAlert('Could not find symbol definition for this instance.')
        return
      }
      const inner = unlockElementTree(deepCloneElementNewIds(def.template))
      const replacement: VectorElement = {
        id: nanoid(10),
        name: `${loc.node.name} (detached)`,
        type: 'group',
        attrs: {},
        transform: { ...loc.node.transform },
        visible: loc.node.visible !== false,
        locked: false,
        children: [inner]
      }
      const parentId = loc.parent?.id ?? null
      const insertIndex = loc.index
      withHistory((s) => {
        let els = removeElementById(s.project.elements, instanceId)
        els = insertElement(els, parentId, insertIndex, replacement)
        return {
          project: { ...s.project, elements: els },
          tracks: s.tracks.filter((t) => t.elementId !== instanceId),
          selectedIds: [replacement.id]
        }
      })
    },

    serializeProject: () => {
      const s = get()
      const payload = {
        version: 1 as const,
        id: s.project.id,
        name: s.project.name,
        width: s.project.width,
        height: s.project.height,
        elements: s.project.elements,
        assets: s.project.assets,
        gradients: s.project.gradients,
        symbols: s.project.symbols,
        animations: s.tracks,
        currentTime: s.currentTime,
        duration: s.duration
      }
      return JSON.stringify(payload, null, 2)
    },

    hydrateFromJson: (json) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish or cancel symbol editing before opening a project.')
        return
      }
      const data = JSON.parse(json) as {
        version?: number
        id?: string
        name?: string
        width?: number
        height?: number
        elements?: VectorElement[]
        assets?: Project['assets']
        gradients?: GradientDef[]
        symbols?: SymbolDefinition[]
        animations?: AnimationTrack[]
        currentTime?: number
        duration?: number
      }
      const project: Project = {
        id: data.id ?? nanoid(),
        name: data.name ?? 'Project',
        width: data.width ?? 800,
        height: data.height ?? 600,
        elements: data.elements ?? [],
        assets: data.assets ?? [],
        gradients: data.gradients ?? [],
        symbols: data.symbols ?? []
      }
      set({
        project,
        tracks: data.animations ?? [],
        currentTime: data.currentTime ?? 0,
        duration: data.duration ?? 3,
        selectedIds: [],
        selectedKeyframes: [],
        keyframeClipboard: null,
        playbackSpeed: 1,
        gsapCanvasDriver: false,
        viewBox: { x: 0, y: 0, width: project.width, height: project.height },
        historyPast: [],
        historyFuture: []
      })
    }
  }
})
