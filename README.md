# svgAnimeto

**svgAnimeto** is a desktop-first visual editor for SVG design and timeline-based animation. You can import or draw vector artwork, animate properties with keyframes, preview playback, and export animated SVG (CSS `@keyframes`), HTML, GIF, or video.

## Features at a glance

- **Vector editing**: shapes, pen, pencil, path editing, brush, fill, eraser, text, shape builder (boolean-style operations on paths).
- **Animation**: per-property tracks (`x`, `y`, rotation, opacity, colors, path `d`, motion path, effects, and more), scrubbable timeline, optional auto-keyframing at the playhead.
- **Preview**: fullscreen preview driven by the same timeline engine.
- **Export**: animated SVG, standalone HTML, GIF, or raster video (see [User guide — Export](docs/user-guide.md#export)).
- **Projects**: library on the home screen; `.svgmotion` JSON for save/open (Electron) or IndexedDB in the browser build.
- **Import**: SVG files; raster images with optional trace wizard or manual reference tracing.

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
