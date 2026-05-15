# svgAnimeto user guide

This guide describes the product as implemented today: screens, modes, tools, panels, and file workflows.

---

## Home screen

When you launch the app you land on the **project home**.

- **New project**: creates a blank artboard, registers the project in storage, and opens the editor.
- **Open from disk**: on desktop, uses the system dialog when the project library API is available; otherwise a hidden file picker lets you choose a `.svgmotion` (or compatible JSON) file.
- **Recent projects**: cards for projects stored in the library (Electron uses the integrated library; in a plain browser build, **IndexedDB** backs the same abstraction).
- **Delete**: removes a stored project from the library after confirmation.
- **Refresh**: reloads the project list from storage.

Double-click a project card or use its open control to enter the editor for that project’s id.

---

## Editor layout

After opening a project, the **editor** shows:

- **Top bar**: app branding, project name (double-click to rename), **mode** switcher (Draw / Animate / Preview / Export), **canvas size** presets, **Import SVG**, **Import raster**, save, and navigation **home**.
- **Left toolbar**: drawing and navigation tools (availability depends on mode; see [Modes](#modes)).
- **Center**: **canvas** — the artboard and SVG elements.
- **Right**: **inspector** — selection properties, animation tracks, guides, and context-specific controls.
- **Bottom**: **Layers** (and **Timeline** when not only in Draw-only bottom layout); width/height of these regions can be adjusted with splitters where provided.

While **editing a symbol** in isolation, some top-bar actions (like switching modes) are restricted until you finish or cancel symbol editing; a banner explains this state.

---

## Modes

### Draw

Full access to all **left toolbar** tools. Use this mode to create and edit geometry, text, groups, and symbols. The bottom area emphasizes **Layers** (and related panels).

**Typical workflow**: select or create shapes → adjust in the inspector → organize in the layers list.

### Animate

Timeline and keyframe editing are primary. **Auto keyframe** (when enabled) records keyframes at the current **playhead** when you transform the selection or change supported inspector values.

**Toolbar in Animate**: **Select**, **Hand**, and **Path edit** stay available so you can adjust paths without leaving animation mode.

**Typical workflow**: move the playhead → change properties (or drag on-canvas handles) → refine keyframes in the timeline (move, delete, easing).

### Preview

Fullscreen **preview** playback using the same animation data as the timeline. Editor chrome is minimized so you can review motion at full size.

**Toolbar in Preview**: **Select**, **Hand**, and **Path edit** only — for minor path tweaks while reviewing.

### Export

Choosing **Export** in the top bar opens the **export dialog** (see [Export](#export)). You can close the dialog to return to another mode.

---

## Tools (left toolbar)

Shortcuts below work when the editor has focus and you are **not** typing in an input. In **Draw** mode, single-letter shortcuts match the tool (see [Keyboard shortcuts](#keyboard-shortcuts)).

### Navigate

| Tool | Shortcut | Purpose |
|------|----------|---------|
| **Select** | `V` | Pick, marquee, and transform selections; drag elements. |
| **Hand** | `H` | Pan the canvas view. |

### Shapes

| Tool | Shortcut | Purpose |
|------|----------|---------|
| **Shape builder** | `G` | Combine or cut overlapping paths (boolean-style workflow on vector geometry). |
| **Rectangle** | `R` | Draw axis-aligned rectangles. |
| **Circle** | `O` | Draw circles from center or corner drag (implementation follows canvas drag conventions). |
| **Ellipse** | `E` | Draw ellipses. |
| **Line** | `L` | Draw straight line segments. |

### Paths

| Tool | Shortcut | Purpose |
|------|----------|---------|
| **Pen** | `P` | Place Bézier points and handles for precise paths. |
| **Pencil** | `I` | Freehand strokes converted to paths. |
| **Path edit** | `N` | Edit existing path points and handles on selected paths. |
| **Brush** | `B` | Paint strokes as paths or brush-like geometry (depending on implementation). |

### Paint

| Tool | Shortcut | Purpose |
|------|----------|---------|
| **Fill** | `F` | Flood-style fill inside regions (raster bucket / polygon-based fill pipeline). |
| **Eraser** | `X` | Erase portions of filled geometry using path clipping. |

### Type

| Tool | Shortcut | Purpose |
|------|----------|---------|
| **Text** | `T` | Create or edit text elements. |

---

## Canvas and selection

- **Zoom** and **pan** are driven by the editor view state (hand tool or equivalent navigation).
- **Selection overlay** shows bounds and handles for the current selection when using the select tool.
- **Guides** (perspective, grid, horizon, etc.) are optional overlays from the inspector; they are **view aids** and are not part of normal SVG export unless explicitly included by a future feature.

Path editing and live previews (e.g. while dragging) are handled in the canvas layer; if something looks wrong, try **undo** (`⌘/Ctrl+Z`).

---

## Layers panel

- Reorder **root-level** layers.
- Toggle visibility / lock where supported.
- Rename elements for clarity.

Selection for certain operations (for example **symbol** workflows) may require **root-level** layers only — the app enforces this where documented in UI or tooltips.

---

## Symbols panel

**Symbols** let you define a reusable **master** subtree and place **instances** on the canvas.

- Create and manage symbol definitions from the symbols UI.
- **Edit symbol** opens an isolated canvas for the master; finish or cancel to return to the main document.

While editing a symbol, the app keeps a **restore snapshot** so your main document state can be reapplied when you exit symbol isolation.

---

## Timeline

Visible in **Animate** (and combined layouts when applicable):

- **Duration**, **FPS**, **playback speed**, and **loop** control how time maps to playback.
- **Scrub** by dragging the time ruler or playhead.
- **Keyframes** appear per **track** (each track is `element` + `property`).
- **Alt+click** a keyframe to delete (per existing README behavior).
- Drag a keyframe dot to change its time.
- **Multi-select** keyframes where supported for batch operations.

Supported animated properties include transform components, opacity, fill/stroke colors, stroke width, path `d`, motion path position, blur/shadow “fx” fields, mask, clip-path, SVG filter references, and more — see the inspector when a selection is active.

---

## Inspector (right panel)

The inspector adapts to **selection** and **mode**. Typical sections include:

- **Transform**: position, scale, rotation, skew, opacity.
- **Appearance**: fill, stroke, gradients where applicable.
- **Text** properties for text nodes.
- **Animation**: track list, add/remove tracks, keyframe values, easing.
- **Canvas guides**: type, spacing, opacity, color, vanishing points, etc.

Exact labels follow the live UI; this guide does not duplicate every control name.

---

## Import

### SVG

- **Top bar**: Import SVG, or **File → Import SVG** / **`⌘/Ctrl+I`** on desktop when the menu is wired.
- Parsed elements become editor-native **vector elements** (paths, groups, basic shapes, text where supported).

### Raster (trace or reference)

- **Import raster** from the top bar or menu (desktop) opens a workflow:
  - **Trace wizard**: configurable vectorization with progress UI (may use a Web Worker for heavy traces).
  - **Manual reference**: place a locked reference image and trace with **Pen** / **Pencil** on top.

If a feature is unavailable in your environment (for example no Electron `importRaster`), the UI may fall back to a file picker or show a message.

---

## Export

Open **Export** mode from the top bar to launch the **export dialog**.

| Format | Typical use |
|--------|----------------|
| **SVG** | Single self-contained animated SVG with embedded `<style>` using CSS `@keyframes`. Good for web or tools that accept animated SVG. |
| **HTML** | Standalone page wrapping the same animation for easy preview or embedding. |
| **GIF** | Raster animated GIF (palette-based encoder). |
| **Video** | Raster video export (codec/container depends on build and browser/Electron capabilities). |

Options often include **loop**, **minify** (for text formats), **FPS**, and **max side** for raster exports. Use **Save to file** on desktop (native dialog) or download behavior in the web build.

---

## Projects and saving

- **Save** (`⌘/Ctrl+S`): writes the current document and timeline to the active **storage URI** (library slot or last saved path).
- **Open** (`⌘/Ctrl+O`): opens a project via dialog and registers it in the library when using desktop APIs.
- **New** (`⌘/Ctrl+N`): new blank project and editor session.

The on-disk JSON convention uses the **`.svgmotion`** extension. The serialized payload includes `elements`, `animations` (tracks), timing fields (`duration`, `currentTime`), and related metadata. Treat these files as the **source of truth** for a project.

---

## Keyboard shortcuts (reference)

Global editor (when not focused in a text field):

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl+Z` | Undo |
| `⌘/Ctrl+Shift+Z` | Redo |
| `⌘/Ctrl+S` | Save project |
| `⌘/Ctrl+O` | Open project |
| `⌘/Ctrl+I` | Import SVG (when Electron import is not used, may trigger web picker path) |
| `Delete` / `Backspace` | Delete selection (disabled in Preview) |
| `⌘/Ctrl+Shift+G` | Group selection (Draw / Animate) |
| `⌘/Ctrl+D` | Duplicate selection (Draw / Animate) |

Draw mode tool letters: `V` H G R O E L P I N B X F T as listed in [Tools](#tools-left-toolbar).

Timeline tip: **`Alt`+click** a keyframe to delete it.

---

## Troubleshooting

- **Nothing saves on Save**: In a non-Electron environment without storage, the app may copy JSON to the clipboard and show an alert — use **Open from disk** / file picker workflows or run the desktop app.
- **Import did nothing**: Check file type (SVG text; raster supported formats). On Electron, ensure the dialog completed successfully.
- **Symbol editing blocked actions**: Finish or cancel symbol editing from the banner controls first.

---

## Further reading

- [Architecture and modules](architecture-and-modules.md) — source layout for contributors.
- [REQUREMENT.md](../REQUREMENT.md) — roadmap items and future ideas.
