# Architecture and modules

This document maps the **svgAnimeto** repository: runtime split, folders, and how major pieces interact. Paths are relative to the project root.

---

## High-level runtime

```mermaid
flowchart LR
  subgraph electron_shell [Electron shell]
    main[electron/main.ts]
    preload[electron/preload.ts]
  end
  subgraph renderer [Renderer Vite + React]
    app[src/App.tsx]
    pages[src/pages]
    store[src/store]
    engines[src/engines]
  end
  main --> preload
  preload -->|"contextBridge window.api"| app
  app --> pages
  pages --> store
  store --> engines
```

- **Main process** (`electron/main.ts`): creates `BrowserWindow`, application menu, delegates file dialogs and IPC registration.
- **Preload** (`electron/preload.ts`): exposes a typed, minimal `window.api` via `contextBridge`.
- **Renderer** (`src/`): React UI, Zustand stores, pure TS **engines** for geometry, import/export, and animation math.

---

## Electron: main, preload, and IPC

| File | Role |
|------|------|
| `electron/main.ts` | Window lifecycle, menu (New / Open / Save / Import SVG / Import raster), shell integration. |
| `electron/preload.ts` | Defines `ElectronAPI`: `openProject`, `saveProject`, `projectLibrary` (list/read/write/delete/openFromDialog), `importSvg`, `importRaster`, `exportSvg`, `saveExport`, `onMenuAction`, `onImportSvgData`, `onImportRasterData`. |
| `electron/ipc.ts` | Registers `ipcMain` handlers invoked by preload (`dialog:*`, `projectLibrary:*`). |
| `electron/projectLibrary.ts` | Project records on disk / app user data (implementation details for library persistence). |

**Security posture**: no `nodeIntegration` in the renderer; capability is narrow IPC only. See comments in preload for early subscription to import events.

---

## Build and configuration

| File | Role |
|------|------|
| `electron.vite.config.ts` | electron-vite entries for **main**, **preload**, and **renderer**. |
| `tsconfig.json` | Base TypeScript options; web/electron splits in `tsconfig.web.json`, `tsconfig.node.json`, `tsconfig.electron.json`. |
| `package.json` | Scripts, dependencies, `electron-builder` metadata under `"build"`. |
| `eslint.config.js` | Lint rules for TS/TSX. |

Compiled output for production lives under `out/` (main + preload + renderer bundles).

---

## Renderer entry and routing

| Path | Role |
|------|------|
| `src/main.tsx` | React root mount. |
| `src/App.tsx` | `HashRouter`, routes: home and editor. |
| `src/navigation.ts` | Route path helpers (`routes`, `editorPath`, `navigateApp`) and global navigate binding. |
| `src/components/NavigationBinder.tsx` | Connects React Router `useNavigate` to `setAppNavigate` for non-React modules (IPC helpers) that need navigation. |

**Routes**

- `/` → `HomePage` — project library UI.
- `/editor/:projectId` → `EditorPage` — loads project JSON by id from storage.

---

## Pages

| Path | Role |
|------|------|
| `src/pages/HomePage.tsx` | Wraps `HomeScreen` + `DialogHost`. |
| `src/pages/EditorPage.tsx` | Full editor chrome: loads project on `projectId`, wires menu IPC, keyboard shortcuts, layout grid, `Canvas`, `TopBar`, panels, export dialog, preview overlay, symbol banner, dev GSAP panel. |

---

## State management (`src/store/`)

| Module | Role |
|--------|------|
| `editorStore.ts` | **Primary document + timeline store**: `project` (`elements`, `symbols`, `gradients`, …), `tracks`, `currentTime`, `duration`, `mode`, `activeTool`, selection, history (undo/redo), symbol-edit backup, canvas guides, keyframe selection/clipboard, import helpers, serialization (`serializeProject`, `hydrateFromJson`). |
| `sessionStore.ts` | **Active project storage URI** — ties the open editor tab to `ProjectStoragePort` read/write. |
| `dialogStore.ts` | Modal alert/confirm API used across IPC and UI. |
| `traceOverlayStore.ts` | Raster trace progress overlay state. |
| `rasterImportModalStore.ts` | Raster import / vectorize wizard modal. |

---

## IPC and file orchestration (`src/ipc/`)

| Module | Role |
|--------|------|
| `fileActions.ts` | **User-facing file ops**: `openProjectFile`, `saveProjectFile`, `newProjectFile`, `importSvgFile`, `applyImportedSvg`, raster wizard entry (`openRasterVectorizeWizard`, `importRasterTraceFile`), trace overlay coordination, clipboard fallbacks when `window.api` is missing. |
| `projectActions.ts` | **Project lifecycle**: `loadProjectForEditor`, `createNewProjectAndOpen`, `openStoredProject`, `openProjectFromDialog`, `importProjectJsonFromFile`, `saveActiveProject`, `returnToHome`. Guards symbol-edit mode where needed. |

These modules call `getProjectStorage()` and `window.api` without importing Node APIs (renderer-safe).

---

## Project storage (`src/services/projectStorage/`)

Abstracts “where projects live” so the UI stays identical in Electron and browser.

| Module | Role |
|--------|------|
| `types.ts` | `ProjectRecord`, `ProjectStorageUri`, `ProjectStoragePort` interface. |
| `getProjectStorage.ts` | Returns **electron** library adapter when `window.api.projectLibrary` exists; otherwise **IndexedDB** adapter. |
| `electronProjectStorage.ts` | IPC-backed list/read/write/delete + open from OS dialog. |
| `indexedDbProjectStorage.ts` | Browser-local persistence for the same record shape. |
| `projectCodec.ts` | Small JSON helpers (`projectNameFromJson`, `ensureProjectIdInJson`, …). |
| `resolveProject.ts` | Resolve a `ProjectRecord` by id from the active backend. |

---

## Types (`src/types/`)

| File | Contents |
|------|----------|
| `document.ts` | `Project`, `VectorElement`, `Transform`, `SymbolDefinition`, element types, path points. |
| `animation.ts` | `AnimationTrack`, `Keyframe`, `AnimatableProperty`, `EasingId`, clipboard types. |
| `gradient.ts` | Gradient definitions used by the document model. |
| `canvasGuide.ts` | Guide types and normalized guide points. |
| `history.ts` | Undo/redo snapshot typing. |
| `electron.d.ts` | Augments `Window` with optional `api` matching preload. |

---

## Engines (`src/engines/`)

Pure (or mostly pure) logic — no React. Grouped by domain.

### `engines/animation/`

| Module | Role |
|--------|------|
| `interpolate.ts` | Sample tracks, merge transforms from keyframes. |
| `attrAnimation.ts` | Attribute-driven animation (text steps, packed colors, etc.). |
| `gsapTrackCompiler.ts` | Dev-oriented compilation of tracks to GSAP timeline (optional `gsapCanvasDriver` path). |
| `motionPathApply.ts` | Apply motion-path offset along SVG paths. |
| `syncDocument.ts` | Keep document state in sync with playback sampling when needed. |

### `engines/document/`

| Module | Role |
|--------|------|
| `tree.ts` | Find, insert, remove, reorder, flatten for layers, purge by ids. |
| `duplicateElements.ts` | Duplicate selected subtrees with new ids. |
| `groupElements.ts` | Group selected root elements. |
| `symbolClone.ts` | Deep clone / unlock for symbol templates and instances. |

### `engines/export/`

| Module | Role |
|--------|------|
| `exportSvg.ts` | Build animated SVG string with embedded CSS keyframes. |
| `exportHtml.ts` | Standalone HTML export. |
| `keyframeCss.ts` | CSS generation helpers for keyframed properties. |
| `rasterizeAnimation.ts` | Frame rasterization for GIF/video export (uses project + tracks + duration). |

### `engines/geometry/`

| Module | Role |
|--------|------|
| `svgWorldTransform.ts` | World matrices for SVG elements. |
| `pathBooleanEngine.ts` / `polygonClippingApi.ts` | Path booleans via polygon clipping. |
| `eraserApply.ts` | Apply eraser using clipping tree updates. |
| `rasterBucketFill.ts` / `pointInMultiPolygon.ts` | Fill tool hit testing and flood regions. |
| `pathFlatten.ts` | Stroke outline / flattening utilities. |
| `pencilPath.ts` | Pencil stroke simplification / path building. |
| `shapeToPath.ts` | Convert primitives to path data. |
| `svgPathMotion.ts` | Motion along path geometry. |
| `transformMultiPolygon.ts` | Transform multipolygons for ops. |

### `engines/importer/`

| Module | Role |
|--------|------|
| `svgImporter.ts` | Parse SVG string into internal `VectorElement` trees. |
| `rasterTrace.ts` / `rasterTraceOptions.ts` / `rasterTraceSettings.ts` | Bitmap-to-vector tracing pipeline and wizard settings. |
| `imagePreprocess.ts` | Preprocess steps before trace. |

### `engines/preview/`

| Module | Role |
|--------|------|
| `previewEngine.ts` | Drive preview playback sampling (used by preview overlay). |

---

## Workers (`src/workers/`)

| File | Role |
|------|------|
| `rasterTrace.worker.ts` | Off-main-thread raster tracing to keep UI responsive. |

---

## React components (`src/components/`)

High-level grouping (not every file listed):

| Area | Examples | Role |
|------|----------|------|
| Canvas | `canvas/Canvas.tsx`, `ElementRenderer.tsx`, `SelectionOverlay.tsx`, `CanvasGuideOverlay.tsx` | Render SVG document, selection handles, guides. |
| Toolbar / chrome | `LeftToolbar.tsx`, `TopBar.tsx`, `ResizeHandle.tsx` | Modes, tools, import/save, layout. |
| Panels | `LayersPanel.tsx`, `SymbolsPanel.tsx`, `Timeline/TimelinePanel.tsx` | Structure and time editing. |
| Inspector | `RightInspector.tsx` | Selection + animation + guides UI. |
| Modals / dialogs | `ExportDialog.tsx`, `RasterImportModal.tsx`, `DialogHost.tsx`, `TraceOverlay.tsx` | Export flow, raster wizard, global dialogs, trace progress. |
| Preview | `preview/PreviewFullscreenOverlay.tsx` | Fullscreen playback UI. |
| Dev | `dev/GsapTimelineDevPanel.tsx` | Development aid for GSAP timeline. |
| Brand | `brand/SvgAnimetoLogo.tsx`, `constants/brand.ts` | Naming / logo. |

---

## Hooks (`src/hooks/`)

| Hook | Role |
|------|------|
| `usePlaybackLoop.ts` | RAF or timer-driven playback tick tied to `editorStore` (`isPlaying`, `currentTime`, …). |
| `useWorkspaceLayout.ts` | Persisted sizes for inspector / bottom panels. |

---

## Vendor

| Path | Role |
|------|------|
| `src/vendor/imagetracer_v1.2.6.js` | Image tracing library (legacy script bundled for trace). |

---

## Data flow summary

1. **User** edits canvas → events in `Canvas` / overlays → **`editorStore`** mutations (often after **engines** compute new geometry).
2. **Playback** → `usePlaybackLoop` advances `currentTime` → sampling via **`interpolate`** / **`attrAnimation`** updates derived view or synced document (depending on mode).
3. **Save** → `serializeProject()` JSON → **`ProjectStoragePort.write`** or Electron **`saveProject`** dialog path.
4. **Export** → `ExportDialog` calls **`exportSvg` / `exportHtml` / `rasterizeAnimation`** → `window.api.saveExport` or browser download.

---

## Adding a new feature (checklist)

1. **Types**: extend `document.ts` or `animation.ts` if the file format changes.
2. **Engine**: put deterministic logic under `src/engines/...` and unit-test if you add tests later.
3. **Store**: expose actions on `editorStore`; push history where user-visible edits occur.
4. **UI**: wire React components; keep IPC in `src/ipc/` only.
5. **Docs**: update [user-guide.md](user-guide.md) and this file when behavior or layout changes.

---

## Related files

- Root [README.md](../README.md)
- [REQUREMENT.md](../REQUREMENT.md)
