/**
 * LightCode Terminal Graphics Engine (TGE)
 *
 * Pixel-level render layer for LightCode TUI surfaces.
 * Uses Kitty graphics protocol as primary backend with cell-based fallback.
 *
 * Usage:
 *   import { tge } from "@/tge"
 *   const engine = tge({ width: 1920, height: 1080 })
 *   const panel = engine.scene.add("panel", { style: { bg: surface.panel } })
 *   engine.frame() // layout → paint → transmit
 */

// ─── Core subsystems ──────────────────────────────────────────────────

export { scene, type Scene } from "./scene"
export type {
  SceneNode,
  NodeKind,
  LayoutConstraints,
  StyleProperties,
  Rect,
  Edges,
  Corners,
  BorderStyle,
  ShadowStyle,
  HaloStyle,
} from "./scene"

// Scene graph operations
export { walk, post, find, tagged, collect, count, ancestors } from "./scene"
export { mark, deep, clean, cleanAll } from "./scene"
export { defaults, reset } from "./scene"

// ─── Layout ───────────────────────────────────────────────────────────

export { layout } from "./layout"

// ─── Paint system ─────────────────────────────────────────────────────

export {
  buffer,
  resize,
  clear,
  clearRect,
  get,
  set,
  blend,
  sub,
  fill,
  rounded,
  stroke,
  line,
  bezier,
  circle,
  ring,
  halo,
  blur,
  over,
  withOpacity,
  tracker,
  paint,
  textRegions,
} from "./paint"
export type { PixelBuffer, DirtyRect, DirtyTracker } from "./paint"

// ─── Primitives ───────────────────────────────────────────────────────

export {
  panel,
  chip,
  chipFg,
  graphNode,
  graphEdge,
  overlay,
  divider,
  text as textPrimitive,
  textCells,
  scroll,
  scrollOffset,
  scrollTo,
  scrollBy,
} from "./primitives"

// ─── Backends ─────────────────────────────────────────────────────────

export { kitty, cell } from "./backend"
export type { KittyBackend, CellBackend, Placement, PlacementManager, Region } from "./backend"

// ─── Input ────────────────────────────────────────────────────────────

export { hitTest, pixels, focus } from "./input"
export type { FocusState } from "./input"

// ─── Design tokens ────────────────────────────────────────────────────

export { palette, surface, accent, text, border, rgba, pack, alpha } from "./tokens"
export { spacing } from "./tokens"
export { radius } from "./tokens"
export { shadow } from "./tokens"
export { graph } from "./tokens"
export type { Shadow } from "./tokens"

// ─── Atlas Field ──────────────────────────────────────────────────────

export { extract, ring as atlasLayout, build as atlasBuild, render as atlasRender } from "./atlas"
export type {
  GraphData,
  GraphNode,
  GraphEdge,
  NodeKind as AtlasNodeKind,
  EdgeWeight,
  PlacedGraph,
  PlacedNode,
  Cluster,
  AtlasFrame,
} from "./atlas"

// ─── Bridge (opentui integration) ─────────────────────────────────────

export { bridge } from "./bridge/opentui"
export type { Bridge, Region as BridgeRegion } from "./bridge/opentui"
export { TGEProvider, useTGE } from "./bridge/context"

// ─── Surface renderers ────────────────────────────────────────────────

export {
  dialog as dialogSurface,
  panel as panelSurface,
  card as cardSurface,
  composer as composerSurface,
  toast as toastSurface,
  chip as chipSurface,
  strip as stripSurface,
} from "./bridge/surface"

// ─── Component wrappers ───────────────────────────────────────────────

export { TGEDialog, TGEPanel, TGECard, TGEComposer, TGEToast, TGEChip, TGEFieldStrip } from "./bridge/wrappers"

// ─── Capability detection ─────────────────────────────────────────────

export { detect as detectMode, isPixel, label as modeLabel } from "./bridge/detect"
export type { RenderMode } from "./bridge/detect"

// ─── Cell-mode renderers ──────────────────────────────────────────────

export { cellPanel, cellCard, cellChip, cellOverlay, cellToast, cellComposer, cellStrip, cellDivider } from "./backend"
