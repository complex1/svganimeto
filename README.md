# svgAnimeto

**svgAnimeto** is a desktop-first visual editor for SVG design and timeline-based animation. You can import or draw vector artwork, animate properties with keyframes, preview playback, and export animated SVG (CSS `@keyframes`), HTML, GIF, or video.

**Live demo (web build):** [svganimeto-lq3j.vercel.app](https://svganimeto-lq3j.vercel.app/)

## Features at a glance

### Vector editing
- Shapes, pen, **pencil with editable Bézier anchors**, path editing, brush, fill, eraser, text, **shape builder** (booleans).
- **Texture brushes** along any path/polyline/line: pencil, charcoal, brush, marker, crayon, ink, fur, grass — each stamp rotates with the path tangent.
- Pivot-preserving rotation and scale (transform around the visible bbox centre instead of the local origin).
- Multi-select alignment + shape builder, canvas zoom controls, right-click → delete on path anchors.

### Animation
- Per-property tracks (`x`, `y`, rotation, opacity, colors, path `d`, motion path, blur/shadow, mask/clip/filter…), scrubbable timeline, optional auto-keyframing.
- **Animation presets**: configurable, previewable preset library you can apply to any selection.
- **Noise / wiggle** per element: layered organic jitter over transform properties for a chosen time window.
- **Symbols with their own timeline** that loop independently of the main playhead on every instance; converting a selection to a symbol carries its keyframes along.
- Centripetal Catmull–Rom path morphing and linear-light RGB colour interpolation for natural in-betweens.

### Preview
- Fullscreen **pre-rendered preview**: every frame is rasterised at the project FPS up-front, then played back like a video for jitter-free playback even on heavy scenes.
- Built-in scrub slider, loop, speed, and on-the-fly re-bake.

### Export
- Animated SVG (CSS `@keyframes`), standalone HTML, GIF, raster video (WebM / MP4 where supported).
- Hidden layers are filtered out; texture-brush stamps are baked into the output.

### Workspace
- **Landing page** (`#/`) + **Dashboard** (`#/dashboard`) project library + per-project editor route `#/editor/:projectId`.
- Resizable panels, collapsible inspector sections, editable project names, global tooltips.
- `.svgmotion` JSON for save/open (Electron) or IndexedDB in the browser build.

### Import
- SVG files merge as a new layer group (existing scene is preserved).
- Raster images with the trace wizard or a manual reference workflow.

## Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** (ships with Node)

## Install and run

```bash
npm install
npm run dev
```

This starts **electron-vite** in development mode: the Electron shell loads the Vite renderer with hot module replacement.

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development: Electron + Vite HMR |
| `npm run build` | Compile main, preload, and renderer into `out/` |
| `npm run preview` | Preview production build locally |
| `npm run dist` | Production build + **electron-builder** (macOS DMG, Windows NSIS, Linux AppImage) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier on `src/**/*.{ts,tsx,css}` and `electron/**/*.ts` |
| `npm run pack` | electron-builder `--dir` (unpackaged output for testing) |

Output installers land under `release/` when using `dist`.

## Documentation

| Document | Audience | Contents |
|----------|----------|----------|
| [docs/README.md](docs/README.md) | Everyone | Documentation index and quick links |
| [docs/user-guide.md](docs/user-guide.md) | Users | Modes, tools, panels, shortcuts, import/export, project workflow |
| [docs/architecture-and-modules.md](docs/architecture-and-modules.md) | Developers | Repository layout, Electron IPC, stores, engines, types, workers |

## Tech stack

- **React 18**, **TypeScript**, **Vite** (renderer)
- **Electron** + **electron-vite** (main process + preload)
- **Zustand** for editor and session state
- **GSAP** for optional dev compilation paths and playback-related logic
- **polygon-clipping**, custom geometry helpers for booleans, eraser, and fills

## Security (Electron)

The preload script exposes a minimal `contextBridge` API (`window.api`) for file dialogs, project library, export save, and menu-driven import events. The main window uses **context isolation** and **sandbox** where applicable. See [Architecture — Electron](docs/architecture-and-modules.md#electron-main-preload-and-ipc).

## Roadmap and requirements

Product direction and future ideas are tracked in [REQUREMENT.md](REQUREMENT.md).

## License

See the repository’s license file if present; otherwise treat usage terms as defined by the project owner.
