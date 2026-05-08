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
import type { AnimatableProperty, AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import { importSvgString } from '@/engines/importer/svgImporter'
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
  loop: boolean
  autoKeyframe: boolean
  isPlaying: boolean
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
  isPlaying: boolean
  loop: boolean
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

  pushHistory: () => void
  undo: () => void
  redo: () => void
  clearHistory: () => void

  newProject: () => void
  setProject: (p: Project, path?: string | null) => void
  importSvgFromString: (svg: string, name?: string) => void
  setElements: (elements: VectorElement[], opts?: { skipHistory?: boolean }) => void
  setProjectMeta: (partial: Partial<Pick<Project, 'name' | 'width' | 'height'>>, opts?: { skipHistory?: boolean }) => void

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
  setLoop: (v: boolean) => void
  setIsPlaying: (v: boolean) => void

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
  addElement: (element: VectorElement, opts?: { skipHistory?: boolean; select?: boolean }) => void

  ensureTrack: (elementId: string, property: AnimatableProperty) => string
  upsertKeyframe: (
    elementId: string,
    property: AnimatableProperty,
    time: number,
    value: number,
    easing?: EasingId,
    opts?: { skipHistory?: boolean }
  ) => void
  removeKeyframe: (trackId: string, keyframeId: string, opts?: { skipHistory?: boolean }) => void
  moveKeyframe: (trackId: string, keyframeId: string, time: number, opts?: { skipHistory?: boolean }) => void
  setTracks: (tracks: AnimationTrack[], opts?: { skipHistory?: boolean }) => void
  pruneTracksForElement: (elementId: string, opts?: { skipHistory?: boolean }) => void

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
  easing?: EasingId
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
    const k: Keyframe = {
      id: idx >= 0 ? kfs[idx].id : nanoid(8),
      time,
      value,
      easing: easing ?? kfs[idx]?.easing
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
    isPlaying: false,
    loop: false,
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
    canvasGuidePanelCollapsed: false,
    canvasGuideHorizon: 0.52,
    canvasGuideVp1: { nx: 0.5, ny: 0.52 },
    canvasGuideVpLeft: { nx: -0.35, ny: 0.52 },
    canvasGuideVpRight: { nx: 1.35, ny: 0.52 },
    canvasGuideVpTop: { nx: 0.5, ny: -0.45 },
    canvasGuideFisheyeCenter: { nx: 0.5, ny: 0.5 },

    historyPast: [],
    historyFuture: [],

    symbolEditBackup: null,

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
        tracks: [],
        currentTime: 0,
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
        viewBox: { x: 0, y: 0, width: p.width, height: p.height },
        historyPast: [],
        historyFuture: []
      })
    },

    importSvgFromString: (svg, name) => {
      if (get().symbolEditBackup) {
        void dialogAlert('Finish or cancel symbol editing before importing SVG.')
        return
      }
      const p = importSvgString(svg, name ?? 'Imported')
      withHistory(() => ({
        project: p,
        selectedIds: [],
        tracks: [],
        viewBox: { x: 0, y: 0, width: p.width, height: p.height }
      }))
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

    select: (ids) => set({ selectedIds: ids }),
    addToSelection: (id) =>
      set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds : [...s.selectedIds, id] })),
    clearSelection: () => set({ selectedIds: [] }),

    setMode: (m) => set({ mode: m }),
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
      set((s) => ({
        duration: Math.max(0.1, d),
        currentTime: Math.min(s.currentTime, Math.max(0.1, d))
      })),
    setFps: (f) => set({ fps: Math.max(1, Math.min(120, f)) }),
    setLoop: (v) => set({ loop: v }),
    setIsPlaying: (v) => set({ isPlaying: v }),

    updateTransform: (id, partial, opts) => {
      const s0 = get()
      const newEls = updateElementById(s0.project.elements, id, (el) => ({
        ...el,
        transform: { ...el.transform, ...partial }
      }))
      let newTracks = s0.tracks
      const props = Object.keys(partial) as (keyof Transform)[]
      if (
        !opts?.skipHistory &&
        s0.mode === 'animate' &&
        s0.autoKeyframe &&
        !s0.isPlaying
      ) {
        const fresh = flattenForLayers(newEls).find((x) => x.el.id === id)?.el
        if (fresh && !fresh.locked) {
          for (const key of props) {
            const prop = key as AnimatableProperty
            if (
              !['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'skewX', 'skewY'].includes(prop)
            )
              continue
            newTracks = upsertKeyframeInTracks(
              newTracks,
              id,
              prop,
              s0.currentTime,
              fresh.transform[prop],
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
        (s) => ({
          project: {
            ...s.project,
            elements: updateElementById(s.project.elements, id, (el) => ({
              ...el,
              attrs: { ...el.attrs, ...attrs }
            }))
          }
        }),
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
          tracks: s.tracks.filter((tr) => tr.elementId !== id)
        }),
        opts
      ),

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
          const k: Keyframe = {
            id: idx >= 0 ? kfs[idx].id : nanoid(8),
            time,
            value,
            easing: easing ?? kfs[idx]?.easing
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
        (s) => ({
          tracks: s.tracks.map((tr) => {
            if (tr.id !== trackId) return tr
            return {
              ...tr,
              keyframes: tr.keyframes
                .map((k) => (k.id === keyframeId ? { ...k, time: Math.max(0, time) } : k))
                .sort((a, b) => a.time - b.time)
            }
          })
        }),
        opts
      ),

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
        viewBox: { ...s.viewBox },
        zoom: s.zoom,
        mode: s.mode,
        activeTool: s.activeTool,
        historyPast: structuredClone(s.historyPast),
        historyFuture: structuredClone(s.historyFuture),
        currentTime: s.currentTime,
        duration: s.duration,
        fps: s.fps,
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
        viewBox: b.restore.viewBox,
        zoom: b.restore.zoom,
        mode: b.restore.mode,
        activeTool: b.restore.activeTool,
        historyPast: b.restore.historyPast,
        historyFuture: b.restore.historyFuture,
        currentTime: b.restore.currentTime,
        duration: b.restore.duration,
        fps: b.restore.fps,
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
          viewBox: r.viewBox,
          zoom: r.zoom,
          mode: r.mode,
          activeTool: r.activeTool,
          historyPast: r.historyPast,
          historyFuture: r.historyFuture,
          currentTime: r.currentTime,
          duration: r.duration,
          fps: r.fps,
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
        viewBox: { x: 0, y: 0, width: project.width, height: project.height },
        historyPast: [],
        historyFuture: []
      })
    }
  }
})
