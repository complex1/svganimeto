# svgAnimeto user guide

This guide describes the product as implemented today: screens, modes, tools, panels, and file workflows.

---

## App routes at a glance

svgAnimeto runs in a HashRouter so it works identically in Electron and the browser build.

| Route | Screen | Purpose |
|-------|--------|---------|
| `#/` | **Landing page** | Marketing-style intro to the app, animated hero, feature grid, comparison table, GitHub link, and a "Go to dashboard" button. |
| `#/dashboard` | **Dashboard / project library** | Lists your saved projects, lets you create / open / delete them. |
| `#/editor/:projectId` | **Editor** | The full workspace (canvas, timeline, panels, inspector). |

Unknown routes redirect to `#/`.

---

## Dashboard (project library)

When you open `#/dashboard` (or click "Go to dashboard" from the landing page) you see the **project library**.

- **New project**: creates a blank artboard, registers the project in storage, and opens the editor.
- **Open from disk**: on desktop, uses the system dialog when the project library API is available; otherwise a hidden file picker lets you choose a `.svgmotion` (or compatible JSON) file.
- **Recent projects**: cards for projects stored in the library (Electron uses the integrated library; in a plain browser build, **IndexedDB** backs the same abstraction).
- **Delete**: removes a stored project from the library after confirmation.
- **Refresh**: reloads the project list from storage.

Double-click a project card or use its open control to enter the editor for that project's id. Each editor session has its own URL so you can bookmark or share it.

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

**Toolbar in Animate**: **Select**, **Hand**, and **Path edit** stay available so you can adjust paths without leaving animation mode. Drawing-only tools (shapes, brush, eraser, etc.) are hidden so they can't be activated by mistake.

**Switching modes resets transient state.** When you flip between Draw and Animate the playhead returns to `0`, playback stops, and the current selection is cleared so each mode starts in a known position. Entering **Draw** also bakes each layer's keyframe state at `t=0` into its base transform, so the Draw view always reflects the animation's starting pose (not whatever frame you were scrubbing).

**Typical workflow**: move the playhead → change properties (or drag on-canvas handles) → refine keyframes in the timeline (move, delete, easing). Right-click a track in the timeline and use the trash icon to remove that property's animation entirely.

### Preview

Fullscreen **preview** playback using the same animation data as the timeline. Editor chrome is minimised so you can review motion at full size.

**How it works.** When you enter Preview, the app **pre-renders every frame** at the project's FPS into `ImageBitmap`s, then plays the cached frames back like a video. A progress card shows `Frame X / Y` during the bake; once complete, playback auto-starts and a frame counter (e.g. `180 frames @ 30.0 fps`) appears in the header.

- **Play / Pause / Stop** (Space toggles play).
- **Loop** and **Speed** (0.25× – 8×).
- **Scrub slider** — drag to jump to any cached frame; every position is a single `drawImage`, so it stays smooth even on heavy scenes.
- **Re-render** in the header forces a fresh bake (useful after you change FPS).
- **Exit preview** with the header button or `Esc`.

Pre-rendering is what makes texture brushes, noise wiggle, motion paths, and many keyframes play at full FPS — the cost is paid once during the bake, not on every tick.

Two soft caps protect memory: the cache holds at most ~720 bitmaps (effective FPS is lowered if `fps × duration` would exceed that), and the bitmap canvas is capped at 1280 px on the long edge.

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
| **Pen** | `P` | Place Bézier points and handles for precise paths. **Double-click** or press `Enter` to finish the path (the double-click does not add an extra point). |
| **Pencil** | `I` | Freehand strokes. Each stroke is committed as a path **with editable Bézier anchors** — switch to Path edit and you can drag any anchor or its handles just like a pen path. |
| **Path edit** | `N` | Edit existing path points and handles on selected paths. Click on the stroke to insert a new point; right-click an anchor for a context menu with **Delete point** (red, disabled when fewer than 3 points remain). |
| **Brush** | `B` | Paint stamped strokes. On pen-up, **all stamps merge into a single `<path>`** (instead of a group of individual circles) for a clean, easily-styled output. |

Drawing tools intentionally let pointer events pass *through* existing layers, so you can place a pen point or start a pencil stroke on top of artwork already on the canvas. Use **Select** when you want clicks to grab a layer.

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

- **Zoom and pan**: scroll/pinch to zoom, or use the floating **zoom controls** in the bottom-right (`−`, percentage label, `+`, fit-to-screen). The percentage label also acts as a one-click reset to 100 %.
- **Selection overlay** shows the bounding box, transform handles, and the **pivot marker** for the current selection. Rotation and scale always happen around the pivot.
- **Pivot-preserving inspector edits**: when you change Rotation or Scale via the inspector inputs, the layer rotates / scales around its visible bbox centre instead of its local origin — so a typed `30°` doesn't fling the object across the canvas.
- **Hidden while playing**: the selection overlay automatically hides during animation playback so it doesn't obscure motion. It returns the moment you pause.
- **Guides** (perspective, grid, horizon, etc.) are optional overlays from the inspector; they are **view aids** in Draw mode and are not part of normal SVG export.

Path editing and live previews (e.g. while dragging) are handled in the canvas layer; if something looks wrong, try **undo** (`⌘/Ctrl+Z`).

---

## Layers panel

- **Visual stacking order**: the topmost row in the panel is the topmost layer on canvas. Drag a layer up/down to bring it to the front or send it behind.
- Reorder **root-level** layers; toggle visibility / lock; rename elements for clarity.

Selection for certain operations (for example **symbol** workflows) may require **root-level** layers only — the app enforces this where documented in UI or tooltips.

---

## Symbols panel

**Symbols** let you define a reusable **master** subtree and place **instances** on the canvas.

- Create and manage symbol definitions from the symbols UI.
- **Edit symbol** opens an isolated canvas for the master; finish or cancel to return to the main document.
- While editing a symbol you can switch between **Draw**, **Animate**, and **Preview** to author the symbol's own keyframes (only **Export** is blocked).
- A symbol can carry **its own timeline** with optional looping. Every instance on the main canvas plays that timeline on its own clock — perfect for spinners, blinking icons, idle motions. Set `loop` to `true` (default) for endless cycling, or `false` to play once and hold.
- **Convert to symbol** preserves animation: any tracks on the source layers move into the new symbol's timeline (with element IDs remapped), and the source tracks are removed from the main timeline so you don't end up with duplicate motion.

While editing a symbol, the app keeps a **restore snapshot** so your main document state can be reapplied when you exit symbol isolation.

---

## Timeline

Visible in **Animate** (and combined layouts when applicable):

- **Duration**, **FPS**, **playback speed**, and **loop** control how time maps to playback.
- **Scrub** by dragging the time ruler or playhead.
- **Keyframes** appear per **track** (each track is `element` + `property`).
- **Alt+click** a keyframe to delete it, or drag a keyframe dot to change its time.
- **Multi-select** keyframes where supported for batch operations.
- Each track row has a **trash icon** to delete the entire property animation in one click (history-tracked).

Supported animated properties include transform components, opacity, fill/stroke colours, stroke width, path `d`, motion path position, blur/shadow "fx" fields, mask, clip-path, SVG filter references, and more — see the inspector when a selection is active.

**Smoother interpolation.** Path morphing (animating `d` between two shapes) is computed with a **centripetal Catmull–Rom → cubic Bézier** pipeline so the in-betweens stay curvy instead of collapsing to edgy polylines. Colour animation is interpolated in **linear-light RGB** (gamma 2.4 round-trip), which avoids muddy midtones between, say, red and blue.

---

## Inspector (right panel)

The inspector adapts to **selection** and **mode**. Sections are individually collapsible — the panel itself is resizable.

Common sections:

- **Layer**: name, visibility, lock, duplicate, delete.
- **Layout** (multi-select): alignment (left / centre / right / top / middle / bottom / distribute) and **Shape builder** (boolean union / subtract / intersect) — both work on multiple selected layers, not just single shapes.
- **Transform**: position, scale, rotation, skew, opacity. Rotation/scale changes here are pivot-preserving (see [Canvas and selection](#canvas-and-selection)).
- **Appearance**: fill, stroke, gradients where applicable. Colour pickers and sliders use the dark theme; sliders pair with a numeric input so you can see / type exact values.
- **Animation**: per-property track list, add/remove tracks, keyframe values, easing — plus a **Browse animation presets…** button (see below).
- **Noise**: organic wiggle effects layered on top of keyframes (see below).
- **Texture brush**: stamp shapes along the host path/polyline/line (see below).
- **Symbol** (instance selected): jump to master, edit, swap, detach.
- **Canvas guides**: type, spacing, opacity, colour, vanishing points, etc.

Exact labels follow the live UI; this guide does not duplicate every control name.

---

## Animation presets

Click **Browse animation presets…** in the Animation section to open the **preset modal**.

- Two-pane layout: filterable **preset grid** on the left, **live preview + config** on the right.
- Each preset has parameters (duration, easing, distance, etc.) rendered as sliders / number inputs / selects.
- The preview loops on a placeholder shape so you can see the motion before applying.
- Choose whether the preset starts at **0 s** or the **current playhead**, and whether it **replaces** or **merges with** existing keyframes on the selection.

Presets are a fast way to add fades, slide-ins, bounces, rotations, etc., without hand-building every keyframe.

---

## Noise (organic wiggle per element)

Open the **Noise** section in the inspector to add one or more wiggle effects to the selected element.

Each entry is defined by:

| Field | Meaning |
|-------|---------|
| **Property** | Which transform property to wobble: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `skewX`, `skewY`, or `opacity`. |
| **From / To (s)** | The time window during which the wiggle is active. |
| **Min / Max** | The value range the wobble oscillates between. |
| **Speed (Hz)** | How quickly the wobble moves between min and max. |

Noise is **layered on top** of any keyframes (last-write-wins per property), uses a deterministic value-noise generator (smooth, no hard jumps), and never mutates your base transform or keyframes. Use it for idle motion, camera shake, flickering opacity, or organic jitter on shapes / text.

Click **Remove** to drop a single noise entry, or remove all of them to clear the effect entirely.

---

## Texture brush (stamps along a path)

Eligible host types: `path`, `polyline`, `polygon`, `line`. Open the **Texture brush** section in the inspector.

Pick from eight built-in presets, each tuned for a distinct media:

| Preset | Look |
|--------|------|
| **Pencil** | Granular graphite — small clustered dots with high opacity variance. |
| **Charcoal** | Smudgy, rough — big stamps with strong opacity & scale jitter. |
| **Brush** | Soft tapered ellipse — paint-style, low jitter. |
| **Marker** | Rounded rectangle stamp, opaque — clean highlighter look. |
| **Crayon** | Waxy chunk with internal speckles, dragged-on-paper feel. |
| **Ink** | Wet teardrop droplet, larger scatter and rotation. |
| **Fur** | Tiny curved hair perpendicular to the path — soft pelt. |
| **Grass** | Pointy blade growing perpendicular to the path. |

The host path is the **guide**: stamps are placed along it at your chosen spacing and rotated to the path tangent (or kept upright). Unlike `<pattern>` fills, the texture naturally flows around curves.

Controls in the section:

- **Preset** grid with live mini previews — clicking a preset re-seeds with that preset's defaults.
- **Spacing** between stamps (in path units).
- **Scale** + **Scale jitter** for per-stamp size variation.
- **Rotate jitter** (0°–360°), **Scatter** (perpendicular offset), **Opacity** + **Alpha jitter**.
- **Orient**: *Follow path tangent* (default for strokes) or *Stay upright* (good for ink spray).
- **Color**: pick a colour or click **Inherit** to fall back to the host's stroke (or fill for grass).
- **Reshuffle** re-rolls the seed for a new random pattern; **Remove brush** clears it.

Tips:

- Set the host's `stroke` to `none` to leave **only** the texture — the path becomes a pure guide.
- Keep a coloured stroke for a layered "ink-over-line" look.
- Textures live in the host's transform stack, so motion paths, animation, zoom, and noise wiggle carry them along automatically.
- The stamps are baked into SVG export — your downloaded SVG looks identical without needing JavaScript.

---

## Import

### SVG

- **Top bar**: Import SVG, or **File → Import SVG** / **`⌘/Ctrl+I`** on desktop when the menu is wired.
- Parsed elements become editor-native **vector elements** (paths, groups, basic shapes, text where supported).
- An imported SVG is added as a **new layer group** at the top of the layer list — your existing scene is preserved. Element IDs are remapped so motion-path references inside the import keep working without colliding with the host project's IDs.

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

Options often include **loop**, **minify** (for text formats), **FPS**, and **max side** for raster exports. Use **Save to file** on desktop (native dialog) or download behaviour in the web build.

**What is and isn't included in export**:

- **Hidden layers** (`visible: false`) are filtered out of every export format.
- **Texture brush** stamps are baked into the exported SVG / HTML as concrete `<path>` nodes at the sampled time so the output is pure SVG (no runtime JS required).
- **Noise** wiggle and **symbol timelines** are sampled into their final positions for still frames and into CSS `@keyframes` for animated SVG / HTML.

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
