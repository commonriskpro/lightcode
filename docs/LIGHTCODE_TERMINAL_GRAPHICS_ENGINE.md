# LightCode Terminal Graphics Engine — Architecture

> **Status**: Implementation Complete — All 10 Phases Done  
> **Author**: Architecture Team  
> **Created**: 2026-04-10  
> **Scope**: Full render layer replacement for LightCode TUI surfaces

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Scope](#2-scope)
3. [Constraints](#3-constraints)
4. [Architecture Overview](#4-architecture-overview)
5. [Subsystems](#5-subsystems)
6. [Render Pipeline](#6-render-pipeline)
7. [Scene Model](#7-scene-model)
8. [Layout Engine](#8-layout-engine)
9. [Paint System](#9-paint-system)
10. [Kitty Graphics Backend](#10-kitty-graphics-backend)
11. [Input Model](#11-input-model)
12. [Text Rendering Strategy](#12-text-rendering-strategy)
13. [Design Tokens](#13-design-tokens)
14. [Primitive Components](#14-primitive-components)
15. [Fallback Strategy](#15-fallback-strategy)
16. [Migration Strategy](#16-migration-strategy)
17. [Phased Rollout](#17-phased-rollout)
18. [Risks](#18-risks)
19. [Key Decisions](#19-key-decisions)
20. [Module Structure](#20-module-structure)
21. [Interfaces](#21-interfaces)

---

## 1. Purpose

LightCode's identity — Memory Atlas, Atlas Field, Void Black — demands a visual fidelity that cell-based terminal rendering cannot deliver. The current TUI, built on `@opentui/core` + `@opentui/solid`, produces output at cell granularity: one character per cell, foreground/background per cell. This works for text-heavy interfaces but fails when we need:

- Anti-aliased edges on graph nodes
- Smooth gradient halos around clusters
- Sub-cell positioning for organic layouts
- Consistent visual texture across ALL surfaces (not just the graph)
- The "premium, deep, precise" feel described in the Identity Design Brief

The Terminal Graphics Engine (TGE) is a **pixel-level render layer** that sits between LightCode's component tree and the terminal output. It rasterizes UI surfaces into pixel buffers and outputs them via the Kitty graphics protocol, while preserving the ability to mix with cell-based text where that makes sense.

### Why it's worth it

1. **Visual consistency** — Every surface (shell, sidebar, composer, dialogs, graph, overlays) renders through the same pipeline with the same visual grammar
2. **Identity differentiation** — No other terminal tool looks like this. The Atlas Field stops being "an ASCII graph" and becomes a real spatial visualization
3. **Foundation investment** — A modular render engine is reusable across future surfaces (timeline view, diff view, memory heatmap, etc.)
4. **Controlled complexity** — By owning the render layer, we stop fighting against cell-grid limitations with hacks and Unicode tricks

---

## 2. Scope

### In Scope

- Scene graph model for all LightCode surfaces
- Constraint-based layout engine
- Pixel rasterizer (paint system)
- Kitty graphics protocol backend (transmit + placement)
- Input bridge (mouse, keyboard, focus, scroll → scene graph hit testing)
- Base primitive components (box, text, chip, badge, panel, graph node, edge, overlay)
- Design token system (colors, spacing, radii, shadows from Void Black)
- Migration path from current `@opentui/solid` components
- Cell-based fallback mode

### Out of Scope

- CSS parser or HTML engine
- WebGL/GPU shader pipeline (we use CPU rasterization)
- Custom font rendering from TTF/OTF files (we use the terminal's font grid)
- Animation framework beyond basic transitions (future phase)
- Browser embedding or web target

---

## 3. Constraints

### Hard Constraints

| Constraint                                            | Reason                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Must run in standard terminal emulators               | Kitty, WezTerm, iTerm2, Ghostty — all support Kitty graphics protocol |
| Must use Bun runtime                                  | Project standard; all code is TypeScript on Bun                       |
| Must integrate with existing `@opentui/core` renderer | We cannot replace opentui overnight; must coexist                     |
| Must respect Void Black identity                      | All visual decisions are locked per IDENTITY_DESIGN_BRIEF.md          |
| Must not require GPU                                  | CPU rasterization only; runs on any machine                           |
| Must work over SSH                                    | Kitty graphics protocol works over SSH with compatible terminals      |

### Soft Constraints

| Constraint                       | Negotiable If                                       |
| -------------------------------- | --------------------------------------------------- |
| 60fps target                     | Can drop to 30fps for complex scenes if needed      |
| Full pixel mode for all surfaces | Some surfaces (pure text lists) may stay cell-based |
| Single codebase for both modes   | Fallback mode can have reduced features             |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        LightCode App                            │
│     (SolidJS components, routes, providers, business logic)     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Scene API  │  ← components create scene nodes
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │      Scene Graph        │  ← tree of typed nodes
              │  (nodes, edges, dirty)  │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │     Layout Engine       │  ← constraint solver
              │  (flex-like + absolute) │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │     Paint System        │  ← rasterizer
              │  (RGBA pixel buffers)   │
              └────────────┬────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │   Kitty     │ │   Cell      │ │   Debug     │
    │   Backend   │ │   Fallback  │ │   Backend   │
    │  (primary)  │ │  (degraded) │ │   (PNG)     │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
              ┌────────────▼────────────┐
              │    @opentui/core        │  ← existing renderer
              │  (terminal I/O, input)  │
              └─────────────────────────┘
```

### Key Architectural Decision

The TGE does NOT replace `@opentui/core`. It **uses** opentui as its terminal I/O layer.

Specifically:

- `OptimizedBuffer.drawSuperSampleBuffer()` and `drawPackedBuffer()` already exist in opentui — these accept raw pixel data and composite it into the cell buffer
- The TGE rasterizes to RGBA pixel buffers, then hands them to opentui for final terminal output
- opentui continues to handle stdin parsing, keyboard events, mouse events, resize, and the render loop
- The Kitty graphics protocol backend is an alternative output path that bypasses cell conversion entirely for supported terminals

This means **zero risk to the existing input pipeline** and a gradual migration path.

---

## 5. Subsystems

### 5.1 Scene Graph (`scene/`)

The scene graph is a tree of typed nodes. Each node has:

- A type (box, text, graph-node, edge, panel, overlay, etc.)
- Layout constraints (width, height, flex, position, padding, margin)
- Visual properties (background, border, radius, shadow, opacity)
- Children
- A dirty flag for incremental updates

The scene graph is **declarative** — components describe what they want, the layout engine figures out where things go, the paint system draws them.

### 5.2 Layout Engine (`layout/`)

A simplified constraint-based layout solver. NOT a full CSS engine. Supports:

- **Flex layout** — row/column direction, grow/shrink, gap, align, justify
- **Absolute positioning** — for overlays, tooltips, floating panels
- **Fixed sizing** — explicit width/height in pixels or cells
- **Percentage sizing** — relative to parent
- **Content sizing** — shrink-to-fit for text nodes

This maps directly to what opentui's `<box>` already supports but operates at pixel granularity instead of cell granularity.

### 5.3 Paint System (`paint/`)

The rasterizer. Takes a laid-out scene graph and produces RGBA pixel buffers.

Painting operations:

- `fillRect` — solid or gradient fill
- `strokeRect` — bordered rectangles with optional corner radius
- `drawLine` — anti-aliased line between two points (for edges)
- `drawCircle` — filled/stroked circle (for graph nodes)
- `drawText` — text spans at pixel positions (see Text Rendering Strategy)
- `drawShadow` — box shadow with blur radius
- `drawHalo` — soft glow effect for graph clusters
- `composite` — alpha blending of layers

All operations write to an `RGBA pixel buffer` (Uint8Array, 4 bytes per pixel).

### 5.4 Kitty Graphics Backend (`backend/kitty/`)

Transmits rasterized pixel buffers to the terminal using the Kitty graphics protocol.

Key concepts:

- **Image IDs** — each rendered region gets a stable ID for incremental updates
- **Placements** — map image IDs to terminal cell positions
- **Virtual placements + Unicode placeholders** — integrate pixel regions into the opentui cell grid so they participate in normal layout flow
- **Chunked transmission** — large images sent in 4096-byte base64 chunks
- **Delta updates** — only retransmit regions that changed (dirty rect tracking)

### 5.5 Cell Fallback Backend (`backend/cell/`)

For terminals without Kitty graphics protocol support. Converts the pixel buffer to cell-based approximation:

- Uses Unicode block characters (▀▄█░▒▓) for 2x vertical resolution
- Falls back to the current opentui rendering for text-heavy surfaces
- Graph nodes render as the current Unicode art (◈◇●▲ etc.)

This is NOT a first-class experience — it's a degraded but functional mode.

### 5.6 Input Bridge (`input/`)

Translates terminal input events into scene graph interactions.

```
Terminal Events (via opentui)
    │
    ├─ Mouse move/click → hit test against scene graph → focus/hover/click
    ├─ Keyboard → focused node receives key event
    ├─ Scroll → scroll container in scene graph
    ├─ Resize → re-layout entire scene, re-rasterize
    └─ Text input → forwarded to active text input node
```

The hit testing is pixel-accurate in Kitty mode (we know the exact pixel-to-cell mapping) and cell-accurate in fallback mode.

### 5.7 Design Tokens (`tokens/`)

Centralized visual constants derived from Void Black:

```typescript
// tokens/color.ts
const color = {
  void: 0x04040aff, // #04040a
  surface: 0x0a0a12ff, // #0a0a12
  raised: 0x0e0e18ff, // #0e0e18
  elevated: 0x14141fff, // #14141f
  floating: 0x1a1a26ff, // #1a1a26
  borderWeak: 0x181c2aff,
  borderBase: 0x222838ff,
  borderStrong: 0x303850ff,
  borderFocus: 0x3e4a68ff,
  muted: 0x52587aff,
  text: 0xc8cedeff,
  bright: 0xe0e6f0ff,
  thread: 0x4fc4d4ff, // cian frío
  anchor: 0x4088ccff, // azul frío
  signal: 0xc8a040ff, // ámbar suave
  drift: 0xa8483eff, // rojo apagado
  purple: 0x6b5a9aff,
  green: 0x5cb878ff,
} as const

// tokens/spacing.ts
const spacing = {
  xs: 2, // pixels
  sm: 4,
  md: 8,
  lg: 16,
  xl: 24,
} as const

// tokens/radius.ts
const radius = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 8,
  pill: 999,
} as const
```

### 5.8 Primitive Components (`primitives/`)

The building blocks that compose all surfaces:

| Primitive    | Description                                                             |
| ------------ | ----------------------------------------------------------------------- |
| `Panel`      | Rectangular surface with background, border, optional radius and shadow |
| `Text`       | Single-line or multi-line text span                                     |
| `Chip`       | Small labeled badge (thread/anchor/signal/drift)                        |
| `GraphNode`  | Circle or shape with label, glow halo, semantic color                   |
| `GraphEdge`  | Anti-aliased line between two nodes with optional curvature             |
| `Overlay`    | Absolute-positioned floating surface with backdrop blur                 |
| `Divider`    | Horizontal or vertical separator                                        |
| `ScrollView` | Container with virtualized scrolling                                    |
| `InputField` | Text input area (bridges to opentui's textarea)                         |

---

## 6. Render Pipeline

Each frame follows this pipeline:

```
1. DIFF     — SolidJS reactivity triggers scene graph mutations
2. DIRTY    — Changed nodes mark themselves and ancestors dirty
3. LAYOUT   — Layout engine resolves constraints for dirty subtrees
4. PAINT    — Rasterizer paints dirty regions to pixel buffers
5. TRANSMIT — Backend sends pixel data to terminal
6. COMPOSE  — opentui composites pixel regions with cell-based content
7. FLUSH    — opentui writes final output to stdout
```

### Frame Budget

At 60fps, frame budget is ~16ms. Breakdown target:

| Step            | Budget |
| --------------- | ------ |
| Diff + Dirty    | < 1ms  |
| Layout          | < 2ms  |
| Paint           | < 8ms  |
| Transmit        | < 4ms  |
| Compose + Flush | < 1ms  |

If paint exceeds budget, we can:

- Reduce dirty rect precision (paint larger regions less often)
- Drop to 30fps for heavy scenes
- Use cached textures for static regions

---

## 7. Scene Model

### Node Types

```typescript
type NodeKind =
  | "root" // viewport root
  | "panel" // rectangular surface
  | "text" // text span
  | "scroll" // scroll container
  | "flex" // flex layout container
  | "absolute" // absolutely positioned
  | "graph" // graph canvas (special: manages graph nodes/edges)
  | "overlay" // floating overlay
  | "input" // text input
  | "slot" // placeholder for opentui cell content (migration bridge)
```

### Node Structure

```typescript
type SceneNode = {
  kind: NodeKind
  id: string
  parent: SceneNode | null
  children: SceneNode[]
  layout: LayoutConstraints
  style: StyleProperties
  dirty: boolean
  // computed after layout
  computed: {
    x: number
    y: number
    width: number
    height: number
  }
}

type LayoutConstraints = {
  width?: number | string // px, %, "auto"
  height?: number | string
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  flex?: number // grow factor
  flexShrink?: number
  flexDirection?: "row" | "column"
  gap?: number
  padding?: Edges
  margin?: Edges
  align?: "start" | "center" | "end" | "stretch"
  justify?: "start" | "center" | "end" | "between" | "around"
  position?: "relative" | "absolute"
  top?: number
  left?: number
  right?: number
  bottom?: number
  overflow?: "visible" | "hidden" | "scroll"
}

type StyleProperties = {
  bg?: number // RGBA packed u32
  fg?: number
  border?: BorderStyle
  radius?: number | Corners
  shadow?: ShadowStyle
  opacity?: number // 0-1
  halo?: HaloStyle // glow for graph nodes
}

type Edges = { top: number; right: number; bottom: number; left: number }
type Corners = { tl: number; tr: number; br: number; bl: number }
type BorderStyle = { width: number; color: number; sides?: ("top" | "right" | "bottom" | "left")[] }
type ShadowStyle = { x: number; y: number; blur: number; color: number }
type HaloStyle = { radius: number; color: number; intensity: number }
```

---

## 8. Layout Engine

### Algorithm

The layout engine is a two-pass algorithm inspired by Yoga/Taffy (the Rust flexbox implementations), but simplified for our needs:

**Pass 1 — Measure (bottom-up)**

- Leaf nodes report their intrinsic size (text measures its content, etc.)
- Container nodes aggregate children's sizes
- Flex containers compute the main axis total

**Pass 2 — Resolve (top-down)**

- Root node gets the full viewport size
- Container nodes distribute space to children based on flex/grow/shrink
- Absolute nodes position relative to their containing block
- Each node writes its `computed` rect (x, y, width, height)

### Coordinate System

- Origin: top-left of viewport
- Unit: pixels (the terminal's pixel resolution, obtained via `TIOCGWINSZ` or CSI 14t)
- Cell mapping: `pixelX = cellCol * cellWidth`, `pixelY = cellRow * cellHeight`
- Cell size is detected at startup and on resize

### Performance

The layout engine should be **incremental** — only recompute subtrees marked dirty. For the initial implementation, full re-layout is acceptable since the scene is relatively small (< 200 nodes typically).

---

## 9. Paint System

### Pixel Buffer

```typescript
type PixelBuffer = {
  data: Uint8Array // RGBA, 4 bytes per pixel
  width: number // pixels
  height: number // pixels
  stride: number // bytes per row (width * 4, may be aligned)
}
```

### Dirty Rect Tracking

The paint system maintains a list of dirty rects. Only pixels within dirty rects are repainted. After painting, dirty rects are passed to the backend for partial transmission.

### Paint Operations

All operations are CPU-based, implemented in TypeScript with potential Zig acceleration for hot paths (line drawing, rect fill, alpha blend).

#### fillRect

Fills a rectangular region with a solid color or vertical/horizontal gradient. Respects corner radius by skipping pixels outside the rounded corner arcs.

#### strokeRect

Draws the border of a rectangle. Supports variable width and per-side control.

#### drawLine (anti-aliased)

Wu's line algorithm for anti-aliased lines. Essential for graph edges.

#### drawCircle

Midpoint circle algorithm with anti-aliasing for node circles.

#### drawHalo

Gaussian blur approximation using box blur passes. Applied to a small buffer around graph nodes to create the soft glow effect per Identity spec.

#### composite

Porter-Duff alpha compositing. `src-over` is the default mode.

#### drawText

See Text Rendering Strategy (section 12).

---

## 10. Kitty Graphics Backend

### Capability Detection

On startup, the backend probes for Kitty graphics protocol support:

```
1. Send: \x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\
2. Wait for response: \x1b_Gi=31;OK\x1b\ or timeout
3. If OK → Kitty mode enabled
4. If timeout or error → fall back to cell mode
```

### Transmission Strategy

#### Initial Frame

Full image transmission using PNG compression (`f=100`):

1. Rasterize scene to RGBA pixel buffer
2. Encode as PNG (Bun has native PNG encoding)
3. Base64 encode
4. Chunk into 4096-byte segments
5. Transmit with `a=T,f=100,i=<id>,s=<width>,v=<height>`

#### Incremental Updates

For subsequent frames:

1. Compute dirty rects from scene graph changes
2. For each dirty rect, extract the sub-buffer
3. Transmit as a new image with placement at the exact cell position
4. Delete the old placement for that region

#### Image ID Management

| Region                   | Image ID Range |
| ------------------------ | -------------- |
| App shell                | 1-99           |
| Left panel (Atlas Index) | 100-199        |
| Center (Atlas Field)     | 200-299        |
| Right panel (Context)    | 300-399        |
| Overlays/Dialogs         | 400-499        |
| Composer                 | 500-599        |
| Status bar               | 600-699        |

Stable IDs allow the terminal to cache and replace images efficiently.

### Unicode Placeholder Integration

For regions that need to participate in opentui's cell-based layout flow:

1. Create virtual placement (`U=1`) with cell dimensions
2. Use Unicode placeholder character `U+10EEEE` with diacritics for row/column encoding
3. Set foreground color to image ID
4. opentui treats this as regular text content in its layout

This is the key mechanism for **coexistence** — pixel-rendered regions appear as placeholder characters in opentui's cell grid, so flex layout, scrolling, and z-ordering all work normally.

---

## 11. Input Model

### Mouse Events

```
Terminal stdin → opentui parser → mouse event (cell coordinates)
                                       │
                                       ▼
                               Cell-to-pixel mapping
                               (cellX * cellWidth, cellY * cellHeight)
                                       │
                                       ▼
                               Scene graph hit test
                               (walk tree, check bounds, deepest match)
                                       │
                                       ▼
                               Dispatch to node handler
                               (onClick, onHover, onDrag, onScroll)
```

opentui already provides parsed mouse events with cell coordinates. The TGE converts these to pixel coordinates using the detected cell size, then performs hit testing against the scene graph.

### Keyboard Events

Keyboard events are simpler — they go to the **focused node** in the scene graph.

```
Terminal stdin → opentui parser → key event
                                       │
                                       ▼
                               Focus manager
                               (tracks which node has focus)
                                       │
                                       ▼
                               Dispatch to focused node
                               (onKeyDown, onKeyUp)
                                       │
                                       ▼
                               Bubble up if not handled
```

### Focus Management

- Tab/Shift+Tab cycle through focusable nodes
- Click sets focus to the clicked node
- Escape moves focus to parent
- The graph canvas has its own internal focus (selected node) separate from the TUI focus

### Text Input

Text input nodes (composer, search) bridge to opentui's `TextareaRenderable`:

1. When a TGE input node gains focus, it activates an opentui textarea at the corresponding cell position
2. The textarea handles actual text editing (cursor, selection, IME)
3. The TGE renders the text content visually in the pixel buffer
4. The opentui textarea is invisible (zero-size) but handles input events

This is the same hybrid pattern that many terminal editors use — the terminal handles text input natively, the engine handles visual display.

### Scroll

Scroll events from opentui's mouse parser are routed to the nearest scroll container in the scene graph. The scroll container updates its scroll offset, marks children as dirty, and triggers a re-layout/repaint of the visible region.

### Resize

Terminal resize events trigger:

1. Re-detect cell pixel dimensions (`TIOCGWINSZ`)
2. Update viewport size in scene graph root
3. Full re-layout
4. Full repaint
5. Clear all Kitty image placements
6. Retransmit all visible regions

---

## 12. Text Rendering Strategy

### The Problem

Terminals render text using their configured font. We cannot rasterize our own text into the pixel buffer because:

1. We don't know the user's font
2. Terminal fonts have ligatures, width quirks, CJK handling
3. Rasterizing text requires font loading, shaping, and hinting — massive complexity
4. Users expect their terminal font to work

### The Solution: Hybrid Text Rendering

**Text stays cell-based. Everything else is pixel-based.**

For text regions:

1. The scene graph lays out text nodes at pixel positions
2. The paint system **reserves** the cell region where text will appear (paints background only)
3. The Kitty backend places images around/behind text but not on top
4. opentui renders text in the reserved cells using its normal cell-based path
5. The visual result: pixel-perfect backgrounds, borders, and decorations with native terminal text

For small text (labels, badges, chips):

- The text is rendered by opentui in the cell grid
- The TGE paints the chip background as a pixel rect with rounded corners
- The chip text sits on top in the cell layer

For large text (code, messages, markdown):

- opentui handles everything as it does today
- The TGE only provides the surrounding visual context (panel backgrounds, borders)

### Implications

This hybrid approach means:

- No custom font rendering needed
- Terminal font preferences are respected
- Text is always crisp (native rendering)
- Pixel elements provide visual richness around text
- The cell grid and pixel layers are composited by opentui

---

## 13. Design Tokens

Design tokens are the single source of truth for all visual values. They derive from the Void Black theme but are expressed in pixel-space values.

### Token Categories

| Category    | Examples                                          |
| ----------- | ------------------------------------------------- |
| `color.*`   | All Void Black palette values as RGBA u32         |
| `spacing.*` | xs(2px), sm(4px), md(8px), lg(16px), xl(24px)     |
| `radius.*`  | none(0), sm(2px), md(4px), lg(8px), pill(999px)   |
| `shadow.*`  | subtle, elevated, floating — with blur and offset |
| `border.*`  | widths (1px, 2px), styles                         |
| `font.*`    | Not pixel sizes — cell counts for text regions    |
| `halo.*`    | glow radius and intensity for graph nodes         |
| `graph.*`   | node sizes, edge widths, cluster halo radius      |

### Semantic Token Mapping

```
surface.void      → color.void         #04040a
surface.panel     → color.surface      #0a0a12
surface.card      → color.raised       #0e0e18
surface.context   → color.elevated     #14141f
surface.floating  → color.floating     #1a1a26

accent.thread     → color.thread       #4fc4d4  (cian frío)
accent.anchor     → color.anchor       #4088cc  (azul frío)
accent.signal     → color.signal       #c8a040  (ámbar suave)
accent.drift      → color.drift        #a8483e  (rojo apagado)

text.primary      → color.bright       #e0e6f0
text.secondary    → color.text         #c8cede
text.muted        → color.muted        #52587a
```

---

## 14. Primitive Components

### Panel

The fundamental surface. Every visible region is a panel.

```
┌─ border (1-2px, color from tokens) ─────────────────┐
│ ┌─ padding ───────────────────────────────────────┐  │
│ │                                                 │  │
│ │              content area                       │  │
│ │                                                 │  │
│ └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Properties: bg, border, radius, shadow, padding, opacity.

### Chip

Small semantic badge used for thread/anchor/signal/drift indicators.

```
╭───────────╮
│ ● thread  │   ← rounded rect background + symbol + label
╰───────────╯
```

Properties: label, kind (thread/anchor/signal/drift/neutral), size (sm/md).

### GraphNode

A circle with semantic color and optional label.

```
    ┌───┐
   ╱     ╲
  │   ◈   │   ← anti-aliased circle, optional halo glow
   ╲     ╱
    └───┘
  "my thread"  ← label below, truncated to max width
```

Properties: kind, label, radius, halo, selected, hover.

### GraphEdge

Anti-aliased line between two nodes.

Properties: from (x,y), to (x,y), weight (affects width/opacity), curvature.

### Overlay

Floating surface with optional backdrop dim.

```
┌──────────────────────── viewport ────────────────────────┐
│                                                          │
│         ┌──── overlay (centered, shadowed) ────┐         │
│         │                                      │         │
│  dim    │          dialog content               │  dim    │
│  back   │                                      │  back   │
│  drop   └──────────────────────────────────────┘  drop   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Properties: bg, border, shadow, backdrop (color + opacity), position.

---

## 15. Fallback Strategy

### Decision: Kitty is the primary experience. Cell mode is degraded but functional.

| Feature           | Kitty Mode                      | Cell Fallback              |
| ----------------- | ------------------------------- | -------------------------- |
| Graph nodes       | Anti-aliased circles with halos | Unicode symbols (◈●▲)      |
| Graph edges       | Anti-aliased lines              | Box-drawing chars (─│┌┐)   |
| Panel backgrounds | Smooth fills with radius        | Cell background colors     |
| Borders           | Pixel-perfect with radius       | Box-drawing borders        |
| Chips/badges      | Rounded rect backgrounds        | `[tag]` text               |
| Overlays          | Backdrop blur + shadow          | Semi-transparent overlay   |
| Text              | Native terminal text            | Same (no change)           |
| Gradients         | Smooth pixel gradients          | Stepped cell approximation |
| Shadows           | Soft pixel shadows              | None                       |

### Detection

```
Startup:
  1. Probe Kitty graphics protocol
  2. If supported → pixel mode
  3. If not → cell fallback
  4. User can override via config: tui.renderer = "kitty" | "cell" | "auto"
```

### No Ambiguity

- Kitty graphics protocol support is REQUIRED for the full LightCode visual experience
- Cell fallback is a **functional mode**, not a design target
- Marketing/docs will list supported terminals: Kitty, WezTerm, iTerm2, Ghostty
- No effort will be spent making cell fallback "look as good" — it's a compatibility mode

---

## 16. Migration Strategy

### Principle: Incremental, Not Big Bang

The current TUI works. The migration introduces the TGE alongside it and ports surfaces one at a time.

### Coexistence Model

```
┌─── opentui root box ───────────────────────────────────┐
│                                                        │
│  ┌─ TGE Region (pixel) ──┐  ┌─ opentui Region ──────┐ │
│  │                        │  │                       │ │
│  │  Atlas Field graph     │  │  Message list         │ │
│  │  (rendered via Kitty)  │  │  (cell-based text)    │ │
│  │                        │  │                       │ │
│  └────────────────────────┘  └───────────────────────┘ │
│                                                        │
│  ┌─ opentui Region ─────────────────────────────────┐  │
│  │  Prompt (cell-based, with pixel background)      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

The TGE renders pixel regions that occupy specific cell areas. opentui sees these as opaque boxes (via Unicode placeholders or reserved empty cells). The two systems coexist in the same terminal output.

### Migration Order

Surfaces are ported in order of **visual impact ÷ complexity**:

1. **Atlas Field graph** — Highest visual impact, already custom-rendered with Unicode art, self-contained
2. **Panel backgrounds** — Apply pixel backgrounds to existing panels without changing content
3. **Sidebar (Atlas Index)** — Port panel chrome, keep text content cell-based
4. **Chips/badges** — Small components, high visual improvement
5. **Dialogs/overlays** — Port dialog chrome (shadow, backdrop, rounded borders)
6. **Composer** — Port background/border, keep text input cell-based
7. **Status surfaces** — Port bottom bar
8. **Full app shell** — Final migration of the root layout

### Rollback Safety

Each ported surface can be reverted to cell-based rendering independently. The config flag `tui.renderer` controls this globally, and individual surface overrides are possible during development.

---

## 17. Phased Rollout

### Phase 0 — Architecture & Interfaces (this document)

**Duration**: 1 week  
**Output**: Architecture doc, interface definitions, module structure  
**Risk**: None — no code changes

### Phase 1 — Scene Model

**Duration**: 1 week  
**Output**: Scene graph implementation, node types, dirty tracking  
**Deliverable**: `packages/opencode/src/tge/scene/`  
**Test**: Unit tests for tree operations, dirty propagation

### Phase 2 — Layout Engine

**Duration**: 2 weeks  
**Output**: Flex layout solver, absolute positioning, constraint resolution  
**Deliverable**: `packages/opencode/src/tge/layout/`  
**Test**: Layout snapshot tests (input constraints → output rects)

### Phase 3 — Paint System

**Duration**: 2 weeks  
**Output**: Pixel buffer, fillRect, strokeRect, drawLine, drawCircle, composite  
**Deliverable**: `packages/opencode/src/tge/paint/`  
**Test**: Visual regression tests (rasterize → compare PNG snapshots)

### Phase 4 — Kitty Graphics Backend

**Duration**: 2 weeks  
**Output**: Capability detection, image transmission, placement management, delta updates  
**Deliverable**: `packages/opencode/src/tge/backend/kitty/`  
**Test**: Integration test with Kitty terminal, protocol conformance

### Phase 5 — Input Bridge

**Duration**: 1 week  
**Output**: Mouse hit testing, keyboard routing, focus management, scroll  
**Deliverable**: `packages/opencode/src/tge/input/`  
**Test**: Simulated input events → expected scene graph focus/hover state

### Phase 6 — Base Primitives

**Duration**: 2 weeks  
**Output**: Panel, Text, Chip, GraphNode, GraphEdge, Overlay, Divider, ScrollView  
**Deliverable**: `packages/opencode/src/tge/primitives/`  
**Test**: Each primitive renders correctly in both Kitty and cell modes

### Phase 7 — Port Atlas Field

**Duration**: 2 weeks  
**Output**: Atlas Field graph rendered via TGE instead of Unicode art  
**Deliverable**: Replace `atlas-graph.tsx` internals to use TGE scene graph  
**Test**: Visual comparison, interaction parity (click node, hover, scroll)  
**Milestone**: First user-visible pixel rendering in LightCode

### Phase 8 — Port App Shell & Panels

**Duration**: 2 weeks  
**Output**: Sidebar, context panel, app shell backgrounds via TGE  
**Deliverable**: Pixel backgrounds for all panels, cell-based text preserved  
**Test**: Full session view visual test

### Phase 9 — Port Composer & Dialogs

**Duration**: 2 weeks  
**Output**: Composer chrome, dialog overlays, toasts via TGE  
**Deliverable**: Rounded dialog borders, backdrop dim, composer styling  
**Test**: Dialog open/close, composer interaction

### Phase 10 — Cell Fallback Polish

**Duration**: 1 week  
**Output**: Ensure degraded mode is clean and functional  
**Deliverable**: Cell-mode rendering for all TGE primitives  
**Test**: Full app flow without Kitty graphics support

**Total estimated timeline**: ~18 weeks for full rollout  
**First visible result** (Phase 7): ~11 weeks

---

## 18. Risks

### High Risk

| Risk                                                          | Impact                                    | Mitigation                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Kitty protocol inconsistencies across terminals**           | Visual glitches on WezTerm/iTerm2/Ghostty | Test on all 4 terminals from Phase 4. Protocol test suite.                                                                 |
| **Performance: 60fps with pixel rasterization in TypeScript** | Dropped frames, sluggish feel             | Dirty rect optimization, Zig acceleration for hot paths (opentui already has Zig core), cached textures for static regions |
| **Text/pixel compositing artifacts**                          | Misaligned text over pixel backgrounds    | Use Unicode placeholder integration, test cell alignment thoroughly                                                        |

### Medium Risk

| Risk                                   | Impact                                 | Mitigation                                                  |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| **SSH latency for image transmission** | Slow updates over remote connections   | Delta updates, aggressive compression, reduced FPS over SSH |
| **opentui upgrade conflicts**          | New opentui versions change buffer API | Pin opentui version, test upgrades before merging           |
| **Scope creep toward full GUI engine** | Never ships                            | Hard scope boundary: no CSS, no HTML, no custom fonts       |

### Low Risk

| Risk                                   | Impact                 | Mitigation                                              |
| -------------------------------------- | ---------------------- | ------------------------------------------------------- |
| **Terminal color profile differences** | Slight color variation | Use true color (24-bit), avoid terminal palette indices |
| **CJK/RTL text in pixel mode**         | Layout issues          | Text stays cell-based, so terminal handles complex text |

---

## 19. Key Decisions

### Decision A: Render Model

**Scene graph → layout engine → pixel rasterizer → Kitty graphics protocol**

- Scene graph is a simple tree of typed nodes with dirty tracking
- Layout engine is flex-based, NOT CSS — just enough to express LightCode's layouts
- Rasterizer produces RGBA pixel buffers via CPU operations
- Output goes through Kitty graphics protocol for pixel-accurate display

**Why not GPU?** Requires GPU access, doesn't work over SSH, massive complexity for marginal benefit in a terminal context.

**Why not canvas-like immediate mode?** Scene graph enables incremental updates, hit testing, and accessibility. Immediate mode would require full repaint every frame.

### Decision B: Consistency Strategy

**The TGE is the PRIMARY renderer for all visual surfaces.**

Text content uses the terminal's native cell-based rendering. Everything else — backgrounds, borders, shadows, graph elements, chips, overlays — goes through the TGE pixel pipeline.

This gives us:

- Consistent visual texture across every surface
- A single design token system that controls everything
- The "premium terminal app" feel described in the Identity Design Brief

**What stays cell-based:**

- Message text (markdown, code blocks)
- Text labels within chips/badges (the chip background is pixel, text is cell)
- Prompt text input content
- Any surface where the user is reading/writing text

### Decision C: Fallback

**Kitty graphics protocol is REQUIRED for the full experience.**

- Cell-based fallback exists and is functional
- It is NOT a design target — no effort to make it "look as good"
- Config flag: `tui.renderer = "auto" | "kitty" | "cell"`
- `"auto"` probes and picks the best available mode
- Documentation lists supported terminals
- Cell fallback uses the current opentui rendering with minor enhancements

**No ambiguity. No "works equally well everywhere."** LightCode is a premium product that requires a capable terminal.

### Decision D: Input Model

- **Mouse**: opentui parses → cell coords → TGE converts to pixel coords → scene graph hit test → dispatch
- **Keyboard**: opentui parses → TGE focus manager → dispatch to focused node → bubble
- **Text input**: Hybrid — opentui TextareaRenderable handles editing, TGE handles visual display
- **Scroll**: opentui mouse scroll events → nearest scroll container in scene graph
- **Resize**: Terminal resize → re-detect cell size → full re-layout → full repaint → retransmit all
- **Focus**: Tab/Shift+Tab cycle, click-to-focus, Escape-to-parent
- **Hit testing**: Pixel-accurate in Kitty mode (pixel coords ÷ cell size → scene node), cell-accurate in fallback

### Decision E: Text Rendering

**Hybrid approach: pixel backgrounds + cell-based text.**

- Text is ALWAYS rendered by the terminal's native text engine (via opentui cells)
- The TGE renders backgrounds, borders, decorations, and graphical elements as pixels
- The two layers are composited by opentui's existing buffer system
- This avoids: custom font loading, text shaping, hinting, ligature support
- This preserves: user's font preferences, terminal font features, CJK support

**For the Atlas Field graph specifically:**

- Node labels are cell-based text overlaid on pixel node circles
- Edge labels (if any) are cell-based text with pixel background chips
- The graph background, nodes, edges, halos, and clusters are all pixel-rendered

---

## 20. Module Structure

```
packages/opencode/src/tge/
├── index.ts              # TGE public API, init, capability detection
├── scene/
│   ├── index.ts          # Scene graph creation and manipulation
│   ├── node.ts           # SceneNode type and operations
│   ├── dirty.ts          # Dirty tracking and propagation
│   └── traverse.ts       # Tree traversal utilities
├── layout/
│   ├── index.ts          # Layout solver entry point
│   ├── flex.ts           # Flex layout algorithm
│   ├── absolute.ts       # Absolute positioning resolver
│   └── measure.ts        # Intrinsic size measurement
├── paint/
│   ├── index.ts          # Paint orchestrator
│   ├── buffer.ts         # PixelBuffer type and allocation
│   ├── rect.ts           # fillRect, strokeRect, rounded rect
│   ├── line.ts           # Anti-aliased line drawing (Wu's algorithm)
│   ├── circle.ts         # Circle drawing
│   ├── halo.ts           # Gaussian blur / glow effect
│   ├── composite.ts      # Alpha compositing
│   └── dirty.ts          # Dirty rect management
├── backend/
│   ├── index.ts          # Backend selection and dispatch
│   ├── kitty/
│   │   ├── index.ts      # Kitty backend entry
│   │   ├── detect.ts     # Protocol capability detection
│   │   ├── transmit.ts   # Image chunking, base64, transmission
│   │   ├── placement.ts  # Image placement management
│   │   ├── delta.ts      # Incremental update logic
│   │   └── placeholder.ts# Unicode placeholder integration
│   └── cell/
│       ├── index.ts      # Cell fallback backend
│       └── approx.ts     # Pixel-to-cell approximation
├── input/
│   ├── index.ts          # Input bridge entry
│   ├── hit.ts            # Hit testing against scene graph
│   ├── focus.ts          # Focus management (tab cycle, click)
│   └── scroll.ts         # Scroll event routing
├── tokens/
│   ├── index.ts          # Token aggregator
│   ├── color.ts          # Color tokens from Void Black
│   ├── spacing.ts        # Spacing scale
│   ├── radius.ts         # Border radius scale
│   ├── shadow.ts         # Shadow definitions
│   └── graph.ts          # Graph-specific tokens (node size, edge width, halo)
└── primitives/
    ├── index.ts           # Re-exports
    ├── panel.ts           # Panel primitive
    ├── text.ts            # Text primitive (cell-based bridge)
    ├── chip.ts            # Semantic chip/badge
    ├── node.ts            # Graph node
    ├── edge.ts            # Graph edge
    ├── overlay.ts         # Floating overlay
    ├── divider.ts         # Separator
    ├── scroll.ts          # Scroll container
    └── input.ts           # Text input bridge
```

---

## 21. Interfaces

These are the primary interfaces that connect the subsystems. They define the contracts for Phase 1+ implementation.

### Scene API (used by components)

```typescript
// Create and manipulate the scene graph
type SceneAPI = {
  root(): SceneNode
  create(kind: NodeKind, props: NodeProps): SceneNode
  append(parent: SceneNode, child: SceneNode): void
  remove(node: SceneNode): void
  update(node: SceneNode, props: Partial<NodeProps>): void
  dirty(node: SceneNode): void
}
```

### Layout API (used by render pipeline)

```typescript
type LayoutAPI = {
  resolve(root: SceneNode, viewport: { width: number; height: number }): void
  measure(node: SceneNode): { width: number; height: number }
}
```

### Paint API (used by render pipeline)

```typescript
type PaintAPI = {
  paint(root: SceneNode, buffer: PixelBuffer, dirty: Rect[]): Rect[]
  // returns updated dirty rects for backend
}
```

### Backend API (used by render pipeline)

```typescript
type BackendAPI = {
  kind: "kitty" | "cell"
  detect(): Promise<boolean>
  transmit(buffer: PixelBuffer, rects: Rect[], placements: Placement[]): void
  clear(): void
  destroy(): void
}
```

### Input API (used by opentui bridge)

```typescript
type InputAPI = {
  mouse(x: number, y: number, type: "move" | "click" | "scroll", button: number): void
  key(event: ParsedKey): void
  focus(direction: "next" | "prev"): void
  resize(width: number, height: number, cellWidth: number, cellHeight: number): void
}
```

### Token API (used by primitives)

```typescript
type TokenAPI = {
  color: typeof colorTokens
  spacing: typeof spacingTokens
  radius: typeof radiusTokens
  shadow: typeof shadowTokens
  graph: typeof graphTokens
}
```

---

## Appendix A: opentui Integration Points

These existing opentui APIs are critical for the TGE:

| API                                       | Purpose                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| `OptimizedBuffer.drawSuperSampleBuffer()` | Write pixel data into cell buffer (supersample → cell)  |
| `OptimizedBuffer.drawPackedBuffer()`      | Write packed pixel data into cell buffer                |
| `OptimizedBuffer.drawGrayscaleBuffer()`   | Write grayscale data (useful for shadows/halos)         |
| `OptimizedBuffer.fillRect()`              | Cell-level rect fill (for fallback mode)                |
| `OptimizedBuffer.setCell()`               | Individual cell setting (for Unicode placeholder chars) |
| `CliRenderer.addPostProcessFn()`          | Hook into render loop for pixel compositing             |
| `CliRenderer.resolution`                  | Get terminal pixel resolution                           |
| `CliRenderer.stdin` / input pipeline      | All keyboard/mouse input                                |
| `CliRenderer.requestRender()`             | Trigger a re-render                                     |
| `CliRenderer.addToHitGrid()`              | Register hit test regions                               |

## Appendix B: Terminal Support Matrix

| Terminal         | Kitty Graphics | Unicode Placeholders | Notes                               |
| ---------------- | -------------- | -------------------- | ----------------------------------- |
| Kitty            | ✅ Full        | ✅                   | Reference implementation            |
| WezTerm          | ✅ Full        | ✅                   | Excellent support                   |
| iTerm2           | ✅ Full        | ✅                   | macOS primary                       |
| Ghostty          | ✅ Full        | ✅                   | Fast, modern                        |
| Alacritty        | ❌             | ❌                   | No graphics protocol                |
| Windows Terminal | ❌             | ❌                   | No graphics protocol                |
| tmux             | ⚠️ Partial     | ❌                   | Passthrough mode only, not reliable |
| Zellij           | ❌             | ❌                   | No graphics protocol yet            |

**Note on multiplexers**: tmux and Zellij do not reliably support Kitty graphics. Users of these multiplexers will get cell fallback mode. This is a known tradeoff.

## Appendix C: Related Documents

- `IDENTITY.md` — Product identity snapshot
- `IDENTITY_DESIGN_BRIEF.md` — Authoritative design direction
- `TUI-ARCH.md` — Current TUI layout structure analysis
- `ui/primitives.ts` — Current design token system (to be superseded by `tge/tokens/`)
