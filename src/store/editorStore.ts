import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Project, Transform, VectorAttrValue, VectorElement } from '@/types/document'
import type { AnimatableProperty, AnimationTrack, EasingId, Keyframe } from '@/types/animation'
import { importSvgString } from '@/engines/importer/svgImporter'
import {
  flattenForLayers,
  removeElementById,
  reorderSiblings,
  updateElementById
} from '@/engines/document/tree'
import type { HistorySnapshot } from '@/types/history'

export type EditorMode = 'draw' | 'animate' | 'preview' | 'export'
export type DrawTool =
  | 'select'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'path-edit'
  | 'brush'
  | 'text'

const HISTORY_MAX = 80

const emptyProject = (): Project => ({
  id: nanoid(),
  name: 'Untitled',
  width: 800,
  height: 600,
  elements: [],
  assets: []
})

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

  historyPast: HistorySnapshot[]
  historyFuture: HistorySnapshot[]

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

  serializeProject: () => string
  hydrateFromJson: (json: string) => void
}

function captureHistory(state: EditorState): HistorySnapshot {
  return {
    elements: structuredClone(state.project.elements),
    tracks: structuredClone(state.tracks)
  }
}

function applyHistory(state: EditorState, snap: HistorySnapshot): Partial<EditorState> {
  return {
    project: { ...state.project, elements: snap.elements },
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

    historyPast: [],
    historyFuture: [],

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
      set({
        project: p,
        projectPath: path ?? null,
        viewBox: { x: 0, y: 0, width: p.width, height: p.height },
        historyPast: [],
        historyFuture: []
      })
    },

    importSvgFromString: (svg, name) => {
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
        animations: s.tracks,
        currentTime: s.currentTime,
        duration: s.duration
      }
      return JSON.stringify(payload, null, 2)
    },

    hydrateFromJson: (json) => {
      const data = JSON.parse(json) as {
        version?: number
        id?: string
        name?: string
        width?: number
        height?: number
        elements?: VectorElement[]
        assets?: Project['assets']
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
        assets: data.assets ?? []
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
