# svgAnimeto (MVP 1)

Desktop app for importing SVGs, editing transforms, keyframe animation on a timeline, preview playback, and exporting a self-contained animated SVG with CSS `@keyframes`.

## Stack

- **React 18** + **TypeScript** + **Vite** (renderer)
- **Electron** + **electron-vite** (main + preload)
- **Zustand** (`editorStore` — document, selection, timeline, animation tracks, UI, undo/redo)

## Scripts

```bash
npm install
npm run dev          # Electron + Vite dev (HMR for renderer)
npm run build        # Compile main, preload, renderer → out/
npm run dist         # Build + electron-builder (mac dmg, win nsis, linux AppImage)
npm run lint
npm run format       # Prettier
```

## Usage

- **Import SVG**: top bar **Import SVG…** (Electron uses native dialog; browser/dev uses a file picker). **File → Import SVG** / **⌘/Ctrl+I** also works in the desktop app.
- **Draw / Animate / Preview / Export**: top bar modes. Bottom panel shows **Layers** in Draw mode; **Layers + Timeline** in Animate/Preview.
- **Animate** + **Auto keyframe**: moving/scaling/rotating a selection or editing the inspector writes keyframes at the playhead.
- **Timeline**: drag the ruler to scrub; **Alt+click** a keyframe dot to delete; drag a dot to move in time.
- **Export**: animated SVG + embedded `<style>` (CSS keyframes). **Save to file** uses the system dialog when running in Electron.

## Project file

Save/load **`.svgmotion`** JSON via **File → Save** / **Open** (or **⌘S** / **⌘O**). Format includes `elements`, `animations` (tracks), duration, and `currentTime`.

## Security

Preload exposes a minimal `contextBridge` API (`openProject`, `saveProject`, `importSvg`, `exportSvg`, `onMenuAction`). Main process uses `contextIsolation` and `sandbox` for the `BrowserWindow`.

## Roadmap

See [REQUREMENT.md](REQUREMENT.md) for drawing tools, presets, motion path, stroke draw, React/Vue export, and interactive state machines.
