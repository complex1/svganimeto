A design and motion app where users can draw/edit SVGs, switch to animation mode, animate every layer visually, and export clean animated SVG, CSS, JS, React, Vue, or video.

Linearity Curve has vector tools like Pen, Pencil, Brush, Shape, Auto Trace, Node Tool, Shape Builder, typography, and layer-based editing. Linearity Move focuses on animation presets, keyframes, timing curves, and timeline-based motion. SVGator focuses on web-ready SVG animation with keyframes, morphing, motion paths, SVG path animation, and CSS/JS export. Rive adds the advanced idea of state machines for interactive animations.

1. Main app structure

Your app can have two primary modes:

Draw Mode      → create/edit vector artwork
Animation Mode → animate selected layers/elements

The user should be able to toggle between them from the top bar:

[ Draw ] [ Animate ] [ Preview ] [ Export ]
Main layout
┌─────────────────────────────────────────────────────────────┐
│ Top Bar: File | Edit | View | Draw | Animate | Export        │
├──────────────┬──────────────────────────────┬───────────────┤
│ Left Toolbar │ Canvas / Artboard             │ Inspector     │
│              │                               │ Properties    │
├──────────────┴──────────────────────────────┴───────────────┤
│ Bottom Panel: Layers / Timeline / Assets / Export            │
└─────────────────────────────────────────────────────────────┘
Main panels
Panel	Purpose
Canvas	User draws, edits, and previews artwork
Toolbar	Drawing, selection, editing, animation tools
Layers Panel	Shows all SVG elements as layers
Inspector Panel	Shows selected object properties
Timeline Panel	Shows keyframes and animation tracks
Assets Panel	Stores reusable icons, gradients, symbols, presets
Export Panel	Exports SVG, animated SVG, CSS, JS, React, Vue, GIF, MP4
2. Draw Mode

Draw Mode is where users create and edit vector artwork.

2.1 Selection Tool
What it does

Allows user to select, move, resize, rotate, duplicate, align, and transform objects.

Actions
- Click object to select
- Drag object to move
- Drag corner handle to resize
- Drag rotation handle to rotate
- Shift + click for multi-select
- Cmd/Ctrl + D to duplicate
- Delete to remove
Properties shown
X position
Y position
Width
Height
Rotation
Opacity
Blend mode
Lock
Visibility
Required for MVP?

Yes.

2.2 Direct Selection / Node Tool
What it does

Allows editing individual SVG path points and Bézier handles.

Linearity Curve includes a Node Tool for precise vector editing, and your app should also support this because SVG editing depends heavily on path manipulation.

Actions
- Select individual anchor point
- Move anchor point
- Adjust Bézier handles
- Convert corner to smooth point
- Convert smooth to corner point
- Add point on path
- Delete point from path
- Break path
- Join path
Useful for
- Logo cleanup
- Icon editing
- Morph animation preparation
- Custom illustrations
Required for MVP?

Not in first MVP, but important for serious SVG editor.

2.3 Pen Tool
What it does

Creates precise vector paths using anchor points.

Actions
- Click to create straight line point
- Click + drag to create curve point
- Close path by clicking first point
- Hold Shift for 45-degree angles
- Hold Alt/Option to break handle direction
Properties
Stroke color
Stroke width
Fill color
Line cap
Line join
Dash pattern
Required for MVP?

Phase 2.

2.4 Pencil Tool
What it does

Freehand drawing that converts stroke movement into SVG paths.

Linearity Curve supports tools like Pen, Pencil, Brush, and Shape tools for drawing from scratch.

Actions
- Draw freehand path
- Smooth path automatically
- Adjust smoothing level
- Convert drawn line to editable path
Settings
Smoothing: 0–100
Stroke width
Stroke color
Auto-close path
Pressure support later
Required for MVP?

Later.

2.5 Brush Tool
What it does

Creates expressive strokes. Internally, it can still be stored as SVG paths.

Brush types
Basic brush
Calligraphy brush
Marker brush
Texture brush
Pressure brush
Required for MVP?

Later.

2.6 Shape Tools
What they do

Allow quick creation of basic SVG shapes.

Tools
Rectangle
Rounded rectangle
Circle / ellipse
Line
Polygon
Star
Arrow
Custom shape
Actions
- Drag to draw
- Hold Shift for perfect square/circle
- Hold Alt/Option to draw from center
- Edit corner radius
- Edit polygon sides
- Edit star points
Required for MVP?

Yes, at least rectangle, circle, line.

2.7 Text Tool
What it does

Creates SVG text layers.

Text features
Add text
Edit text
Font family
Font size
Font weight
Line height
Letter spacing
Text alignment
Convert text to path
Text on path later
Important

For animation, text should support:

- Animate whole text layer
- Animate character by character
- Animate word by word
- Convert to path for advanced animation
Required for MVP?

Basic text: yes. Advanced text animation: later.

2.8 Fill and Stroke Tool
What it does

Controls object color and outline.

Fill options
Solid color
Linear gradient
Radial gradient
Image fill later
Pattern fill later
No fill
Stroke options
Stroke color
Stroke width
Stroke alignment
Line cap: butt, round, square
Line join: miter, round, bevel
Dash pattern
Dash offset
Animation support

These properties can be animated:

Fill color
Stroke color
Stroke width
Dash offset
Opacity
Gradient position later
2.9 Gradient Tool
What it does

Lets user visually edit gradients on canvas.

Actions
- Add linear gradient
- Add radial gradient
- Move gradient handles
- Add/remove color stops
- Change stop color
- Change stop opacity
Required for MVP?

Later, but useful for premium feel.

2.10 Eraser Tool
What it does

Cuts or removes parts of vector paths.

Linearity Curve lists Magic Eraser among its features, so this can become a powerful differentiator later.

Types
Simple delete eraser
Path cut eraser
Magic eraser
Background eraser for images later
Required for MVP?

No.

2.11 Shape Builder Tool
What it does

Combines and subtracts overlapping shapes.

Linearity mentions Shape Builder as one of its vector/logo design capabilities.

Actions
- Merge selected regions
- Subtract region
- Intersect shapes
- Divide shapes
- Exclude overlap
Required for MVP?

Later.

2.12 Boolean Operations
What they do

Classic vector operations.

Union
Subtract
Intersect
Exclude
Divide
Flatten
Outline stroke
Required for MVP?

Later.

2.13 Image Import Tool
What it does

Allows users to import raster images.

Supported files
PNG
JPG
WEBP
SVG
PDF later
AI later
Use cases
- Trace image
- Use as background reference
- Create poster motion
- Animate image layers
2.14 Auto Trace Tool
What it does

Converts raster images into SVG paths.

Linearity Curve has Auto Trace/vectorization style capabilities, so adding this later will make your product feel more complete.

Workflow
1. User imports PNG/JPG
2. Clicks Auto Trace
3. App detects edges/colors
4. App creates editable SVG paths
5. User cleans paths with Node Tool
Trace modes
Black and white
Color trace
Logo trace
Sketch trace
High-detail trace
Low-detail icon trace
Required for MVP?

No. Powerful later feature.

3. Layers system

The layer system is one of the most important parts because animation depends on it.

3.1 Layer Panel
What it does

Shows SVG structure in readable format.

Example:

Logo Animation
├── Background Circle
├── Rocket Group
│   ├── Rocket Body
│   ├── Window
│   └── Flame
├── Text Group
│   ├── Letter A
│   ├── Letter P
│   └── Letter I
Layer actions
Rename layer
Hide/show layer
Lock/unlock layer
Group/ungroup
Duplicate layer
Delete layer
Reorder layer
Select layer on canvas
Search layer
Color tag layer
Important

When importing SVG, auto-name layers intelligently:

path_01 → Path 1
g_03    → Group 3
rect_02 → Rectangle 2

Later add AI smart naming:

path_01 → Rocket Flame
path_02 → Rocket Window
3.2 Grouping
What it does

Combines multiple objects into a group.

Use cases
- Animate full logo group
- Move icon parts together
- Organize complex SVG
Animation behavior

User can animate:

Entire group
Individual child layers
Nested groups
3.3 Symbols / Components
What they do

Reusable vector objects.

Example:

Button icon
Logo mark
Character eye
Sparkle
Loader dot
Benefits
- Reuse object multiple times
- Edit master symbol once
- All instances update
- Animate instances separately later
Required for MVP?

Later.

4. Animation Mode

Animation Mode is the second half of your app.

The user clicks:

[ Animate ]

Then the UI changes from drawing tools to motion tools.

SVGator’s core workflow is close to this: create/import SVG, add keyframes to the timeline, fine-tune motion, and export a lightweight animated file.

4.1 Timeline Panel
What it does

Shows time, layers, properties, and keyframes.

Example:

Time       0s     0.5s     1s     1.5s     2s
Rocket     ●                ●               ●
Flame             ●         ●       ●
Text       ●                         ●
Timeline features
Play
Pause
Stop
Loop
Current time indicator
Zoom timeline
Scroll timeline
Snap to frames
Change duration
Change FPS
Move keyframes
Copy/paste keyframes
Delete keyframes
Select multiple keyframes
Required for MVP?

Yes.

4.2 Keyframe System
What it does

Stores property values at specific times.

Example:

At 0s: x = 0
At 1s: x = 200

The app automatically interpolates between them.

User workflow
1. Select object
2. Move playhead to 0s
3. Set object position
4. Add keyframe
5. Move playhead to 1s
6. Move object
7. App adds second keyframe
8. Press play

Linearity Move highlights real-time keyframing and customizable timing curves in its motion workflow.

4.3 Auto Keyframe Toggle
What it does

Automatically creates keyframes when the user changes a property.

UI:

[● Auto Keyframe: ON]
Behavior

If ON:

- User changes x position → keyframe created
- User changes opacity → keyframe created
- User changes rotation → keyframe created

If OFF:

- User must manually click Add Keyframe
Required for MVP?

Yes. This makes the app easy.

4.4 Animatable Properties
Transform animation
X position
Y position
Scale X
Scale Y
Rotation
Skew X
Skew Y
Transform origin
Visual animation
Opacity
Fill color
Stroke color
Stroke width
Blur
Shadow
Gradient stop color later
Path animation
Path morph
Stroke draw
Stroke dash offset
Point movement
Path trim
Text animation
Text opacity
Text position
Character delay
Word reveal
Typewriter effect
Letter spacing
Text on path movement
Group animation
Move whole group
Rotate group
Scale group
Animate child sequence
Stagger child layers
4.5 Easing Editor
What it does

Controls how animation moves between keyframes.

Basic easing
Linear
Ease in
Ease out
Ease in-out
Bounce
Elastic
Back
Steps
Advanced easing
Custom cubic-bezier
Graph editor
Velocity curve
Overshoot control
Example
Rocket moves slowly first, then quickly, then slows down.
Required for MVP?

Basic easing yes. Graph editor later.

4.6 Animation Presets
What they do

One-click animation effects.

Linearity Move has customizable presets that add fades, position changes, and dynamic motion with a single click.

Preset categories
Entrance
Exit
Loop
Attention
Text
Icon
Loader
Social media
Web UI
Entrance presets
Fade In
Slide In Left
Slide In Right
Slide Up
Scale In
Pop In
Rotate In
Blur In
Draw In
Exit presets
Fade Out
Slide Out
Scale Out
Collapse
Blur Out
Loop presets
Pulse
Float
Wiggle
Bounce
Spin
Blink
Breathing
Wave
Loading Dots
Icon presets
Checkmark draw
Heart beat
Bell ring
Star sparkle
Arrow move
Download drop
Upload rise
Text presets
Typewriter
Word fade
Letter pop
Line reveal
Text slide
Kinetic text
Required for MVP?

Add 10–15 presets in MVP. Presets make the app feel useful immediately.

4.7 Motion Path Tool
What it does

Moves an object along a custom path.

SVGator supports motion path animation visually, where users add keyframes and fine-tune the path curve without coding.

Workflow
1. Select object
2. Click Motion Path
3. Draw path using Pen/Pencil
4. Object attaches to path
5. Set start and end time
6. Preview movement
Options
Orient to path
Reverse path
Loop path
Offset along path
Start %
End %
Speed curve
Use cases
- Rocket flying
- Car moving on road
- Cursor moving through UI
- Data dot moving through pipeline
- Character walking path
Required for MVP?

Phase 2.

4.8 Stroke Draw Animation
What it does

Animates a line/path as if it is being drawn.

Common use cases
- Logo reveal
- Signature animation
- Checkmark animation
- Route animation on map
- Loader line animation
Properties
Start trim
End trim
Stroke dasharray
Stroke dashoffset
Direction
Speed
Required for MVP?

Very valuable. Add early.

4.9 Path Morph Animation
What it does

Transforms one SVG path into another.

SVGator includes morph animation and describes it as creating smooth shape animations without coding.

Workflow
1. Select Path A
2. Choose Morph To
3. Select Path B
4. App checks path compatibility
5. User previews morph
6. User fixes points if needed
Requirements

For clean morphing:

- Both paths should have compatible point count
- App can auto-normalize points
- User can manually adjust points
Use cases
- Menu icon to close icon
- Heart to star
- Blob animation
- Logo transformation
- Loading shape animation
Required for MVP?

Phase 2 or 3.

4.10 Mask Animation
What it does

Uses one shape to reveal/hide another.

Use cases
- Text reveal
- Image reveal
- Wipe transition
- Logo reveal
- Circular reveal
Tools
Create mask
Apply mask
Invert mask
Animate mask position
Animate mask shape
Required for MVP?

Later.

4.11 Clip Path Animation
What it does

Clips visible area using SVG clipPath.

Difference from mask
Mask can use opacity/softness
Clip path is sharp geometric clipping
Use cases
- UI reveal
- Shape transition
- Text clipping
4.12 Filter Animation
What it does

Animates SVG filters.

Properties
Blur
Drop shadow
Glow
Color matrix
Brightness
Contrast
Saturation
Noise later
Use cases
- Glow pulse
- Soft blur reveal
- Shadow movement
- Neon animation
4.13 Timeline Graph Editor
What it does

Advanced control over animation curves.

Features
Property curve view
Bezier handles
Speed graph
Value graph
Keyframe interpolation
Overshoot control
Required for MVP?

No. Add for pro users.

4.14 Frame-by-frame Mode
What it does

Allows traditional frame-by-frame animation.

Use cases
- Hand-drawn effects
- Character blinking
- Small icon animation
- Cartoon effects
How it works
- Each frame can have different path/object state
- Onion skin shows previous/next frame
- Export as animated SVG, GIF, MP4, or sprite
Required for MVP?

No. Big feature later.

5. Interactive Animation Mode

This is advanced and can become your biggest differentiator.

Rive’s state machines connect animations and define logic-driven transitions for interactive graphics. They can respond to inputs like triggers, booleans, and numbers at runtime.

5.1 Interaction Panel
What it does

Lets users define when animation should play.

Triggers
On load
On hover
On click
On scroll
On mouse move
On drag
On focus
On route change later
On custom JS event
Example
Button hover → play Glow animation
Button click → play Bounce animation
5.2 States
What they do

Define visual states of an object.

Example:

Default state
Hover state
Pressed state
Success state
Error state
Loading state
Use case

For a button:

Default → normal icon
Hover → icon moves right
Click → icon pops
Success → checkmark appears
5.3 State Machine
What it does

Connects animation states using logic.

Example:

Idle → Hover → Pressed → Success
Inputs
Boolean: isHovering
Trigger: clicked
Number: progress
Text/data later
Use cases
Interactive icons
Animated buttons
Gamified UI elements
Loading states
Mascot animations
Dashboard indicators
Required for MVP?

No. This is Phase 5, but it can make the product unique.

6. Preview Mode

Preview Mode lets users test animation before export.

6.1 Preview controls
Play
Pause
Restart
Loop
Speed: 0.25x, 0.5x, 1x, 2x
Background color
Transparent background
Responsive preview
Device frame preview
6.2 Interaction preview
Test hover
Test click
Test scroll
Test custom trigger
6.3 Web preview

Show how it looks inside:

HTML page
React component
Vue component
Mobile screen
Dark mode
Light mode
7. Export features

Export is extremely important. This is where developers will love your product.

SVGator exports animated SVG and lets users choose CSS or JavaScript animation type; JS is required for interactive animations.

7.1 Static export
SVG
PNG
JPG
PDF later
7.2 Animated export
Animated SVG with CSS
Animated SVG with JS
HTML embed
CSS keyframes
JavaScript Web Animations API
GIF
MP4
WebM
Lottie later
7.3 Developer export
React component
Vue component
Svelte component
Angular component later
Web Component
NPM package snippet
7.4 Export optimization
Minify SVG
Remove unused defs
Clean IDs
Convert styles to attributes
Convert attributes to CSS
Remove hidden layers
Optimize paths
Compress decimals
Inline CSS
External CSS
Responsive SVG
Preserve viewBox
7.5 Export settings
Loop: yes/no
Autoplay: yes/no
Duration
Delay
Animation type: CSS / JS
Interaction type
Transparent background
Responsive width
Fixed width/height
Accessibility title/description
8. Project file system

Your app should have its own editable project format.

Example:

{
  "name": "animated-logo",
  "width": 800,
  "height": 600,
  "elements": [],
  "animations": [],
  "assets": [],
  "settings": {}
}
Save options
Save project
Open project
Recent files
Autosave
Version history later
Cloud sync later
Offline local save
File extensions

You can create your own:

.vmotion
.svgmotion
.pathmotion

Example:

logo-animation.vmotion
9. Asset system
9.1 Asset Library
What it stores
Icons
Shapes
Illustrations
Gradients
Colors
Fonts
Animation presets
Components
Templates
9.2 Templates
Template categories
Animated logo
Loading animation
Hero illustration
Social media animation
App onboarding
Icon animation
Button animation
Website section animation
Infographic animation
9.3 Preset marketplace later

Users can download:

Motion packs
Icon packs
Gradient packs
Loader packs
Template packs
10. AI-assisted features

These should come later, but they can make the app powerful.

10.1 AI SVG cleanup
Clean messy SVG
Rename layers
Group related elements
Remove unnecessary paths
Optimize path count
10.2 AI animation suggestions

User selects artwork and clicks:

Suggest Animation

App suggests:

Logo reveal
Bounce entrance
Stroke draw
Floating loop
Morph transition
10.3 AI prompt to animation

Example:

"Make this rocket fly upward with flame flicker"

App creates:

Rocket position animation
Flame opacity animation
Smoke particles
Loop settings
10.4 AI prompt to SVG

Example:

"Create a simple cloud upload icon"

App generates editable SVG layers.

11. What user can do in the app
User can create
Logos
Icons
Animated icons
SVG illustrations
Loaders
Button animations
Hero graphics
Landing page animations
Product explainer graphics
Animated infographics
Social media motion posts
App onboarding animations
Interactive web graphics
User can import
SVG
PNG
JPG
WEBP
Existing logo
Figma SVG export
Illustrator SVG export
Linearity SVG export
Hand-drawn sketch later
User can edit
Path points
Shape size
Colors
Gradients
Stroke
Text
Groups
Layers
Masks
Effects
User can animate
Position
Scale
Rotation
Opacity
Color
Stroke draw
Motion path
Morph path
Text reveal
Mask reveal
Group sequence
Interactive states
User can export
Static SVG
Animated SVG
HTML/CSS
JS animation
React component
Vue component
GIF
MP4
WebM
Project file
12. Draw vs Animation toggle behavior

This toggle is very important.

Draw Mode UI

When user is in Draw Mode:

Left toolbar:
- Select
- Node
- Pen
- Pencil
- Shape
- Text
- Fill
- Stroke
- Eraser
- Hand
- Zoom

Bottom panel:
- Layers
- Assets

Right inspector:

Transform
Fill
Stroke
Typography
Effects (blur, gusian blur, shadow etc)
Alignment
Boolean operations
Animation Mode UI

When user switches to Animation Mode:

Left toolbar:
- Select
- Motion Path
- Add Keyframe
- Split
- Trim
- Preview Interaction

Bottom panel changes to:

Timeline
Keyframes
Graph Editor
Animation Presets

Right inspector changes to:

Animation properties
Easing
Timing
Loop
Delay
Interaction
Export settings
Important behavior

Same object, different mode.

Example:

Draw Mode:
User edits circle shape and color.

Animation Mode:
User animates circle position, scale, and opacity.
13. Complete user journey
Journey 1: Beginner creates animated logo
Goal

User wants to animate a logo for their website.

Steps
1. User opens app
2. Clicks New Project
3. Chooses "Logo Animation" template
4. Imports existing SVG logo
5. App shows SVG as layers
6. User renames layers: Icon, Text, Circle
7. User switches to Animate Mode
8. Selects Icon layer
9. Applies "Scale In" preset
10. Selects Text layer
11. Applies "Fade Up" preset
12. Adjusts duration to 2 seconds
13. Presses Preview
14. Opens Export panel
15. Chooses Animated SVG with CSS
16. Enables Loop: false
17. Exports file
Result

User gets a web-ready animated SVG logo.

Journey 2: Developer creates animated loading icon
Goal

Frontend developer wants a lightweight loader for React app.

Steps
1. New Project → Loader
2. Draws 3 circles
3. Selects all circles
4. Switches to Animate Mode
5. Applies "Loading Dots" preset
6. Adjusts delay between dots
7. Preview loop
8. Export → React Component
9. Copies code into project
Result

Developer gets reusable animated React loader.

Journey 3: Designer creates social media motion post
Goal

Designer wants an animated announcement graphic.

Steps
1. New Project → Instagram Square
2. Adds text, shapes, background
3. Imports product image
4. Switches to Animate Mode
5. Applies text reveal preset
6. Adds background floating shapes
7. Adds image slide-in
8. Adds music later if supported
9. Exports MP4
Result

Animated video for Instagram/LinkedIn.

Journey 4: Product team creates interactive button animation
Goal

Team wants a web button icon that reacts on hover/click.

Steps
1. Import SVG button icon
2. Create Default state
3. Create Hover state
4. In Hover state, arrow moves right
5. Create Click state
6. In Click state, icon bounces
7. Add state machine:
   Default → Hover on mouse enter
   Hover → Default on mouse leave
   Hover → Click on click
8. Preview interactions
9. Export as React component with JS interaction
Result

Interactive animated SVG button.

Journey 5: Illustrator creates custom SVG artwork
Goal

User wants to draw from scratch.

Steps
1. New blank canvas
2. Uses Pen Tool to draw outline
3. Uses Shape Tool for base objects
4. Uses Node Tool to refine paths
5. Adds fill and stroke
6. Groups related elements
7. Names layers
8. Saves project
9. Exports static SVG or switches to Animate Mode
Result

Editable SVG illustration.

Journey 6: User creates stroke-draw signature animation
Goal

User wants a signature/logo reveal.

Steps
1. Imports signature SVG
2. Selects path
3. Switches to Animate Mode
4. Applies Stroke Draw preset
5. Sets duration to 3 seconds
6. Adjusts easing
7. Adds fade-in at end
8. Previews
9. Exports animated SVG
Result

Signature appears like it is being drawn.

14. Feature priority roadmap
MVP 1: SVG animation editor

Build this first.

Import SVG
Canvas pan/zoom
Layer panel
Select/move/scale/rotate
Timeline
Keyframes
Auto keyframe
Animate x/y/scale/rotation/opacity
Basic easing
Preview
Export animated SVG CSS
Save/load project JSON
MVP 2: Basic drawing tools
Rectangle
Circle
Line
Pen Tool
Text Tool
Fill/stroke editor
Group/ungroup
Align tools
Static SVG export
Version 3: Advanced SVG animation
Motion path
Stroke draw
Color animation
Mask reveal
Timeline zoom
Presets
Copy/paste animation
Export JS animated SVG
Version 4: Pro editor
Node Tool
Path morph
Boolean operations
Shape builder
Gradient editor
Graph editor
Symbols/components
Templates
Version 5: Developer-first export
React export
Vue export
Web Component export
HTML embed
Animation runtime
Interactive hover/click export
Version 6: Rive-like interaction
States
State machine
Triggers
Boolean/number inputs
Scroll animation
Runtime API
15. Suggested app modules for development

From engineering side, split app like this:

Canvas Engine
Document Model
Selection Engine
Layer Engine
Transform Engine
Path Engine
Animation Engine
Timeline Engine
Preview Engine
Export Engine
Asset Engine
History Engine
Keyboard Shortcut Engine
Core data model
type Project = {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: VectorElement[];
  animations: AnimationTrack[];
  assets: Asset[];
};

type VectorElement = {
  id: string;
  name: string;
  type: "group" | "path" | "rect" | "circle" | "ellipse" | "line" | "text" | "image";
  attrs: Record<string, string | number>;
  transform: Transform;
  children?: VectorElement[];
  locked?: boolean;
  visible?: boolean;
};

type AnimationTrack = {
  id: string;
  elementId: string;
  property: string;
  keyframes: Keyframe[];
};

type Keyframe = {
  id: string;
  time: number;
  value: string | number | Transform;
  easing?: string;
};
16. Best first positioning

Do not say:

“Illustrator + After Effects alternative.”

That is too big.

Say:

A visual SVG design and animation app for developers and designers who want clean web-ready motion graphics.

Or:

Draw, animate, and export production-ready SVG animations without code.

Or for developer audience:

Create animated SVGs visually and export clean React, Vue, CSS, or JS.

17. My recommended first build

Build this first:

1. SVG import
2. Layer tree
3. Select object on canvas
4. Transform object
5. Timeline with keyframes
6. Animate transform and opacity
7. Preview
8. Export animated SVG with CSS

This is the smallest version that still feels like a real product.

After that, add:

9. Drawing tools
10. Animation presets
11. Stroke draw
12. Motion path
13. React/Vue export