/**
 * Scene graph node — the fundamental building block of the TGE.
 *
 * Every visual element in LightCode's pixel-rendered UI is a SceneNode.
 * Nodes form a tree; the layout engine resolves constraints top-down,
 * the paint system rasterizes bottom-up.
 */

// ─── Node kinds ───────────────────────────────────────────────────────

export type NodeKind =
  | "root"
  | "panel"
  | "text"
  | "scroll"
  | "flex"
  | "absolute"
  | "graph"
  | "overlay"
  | "input"
  | "slot"

// ─── Layout constraints ───────────────────────────────────────────────

export type Edges = { top: number; right: number; bottom: number; left: number }
export type Corners = { tl: number; tr: number; br: number; bl: number }

export type FlexDir = "row" | "column"
export type Align = "start" | "center" | "end" | "stretch"
export type Justify = "start" | "center" | "end" | "between" | "around"
export type Overflow = "visible" | "hidden" | "scroll"
export type Position = "relative" | "absolute"

/** Sizing value: absolute pixels, percentage string, or "auto". */
export type Size = number | string

export type LayoutConstraints = {
  width: Size
  height: Size
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  flex: number
  flexShrink: number
  flexDirection: FlexDir
  gap: number
  padding: Edges
  margin: Edges
  align: Align
  justify: Justify
  position: Position
  top: number
  left: number
  right: number
  bottom: number
  overflow: Overflow
}

// ─── Style properties ─────────────────────────────────────────────────

export type BorderStyle = {
  width: number
  color: number
  sides: ("top" | "right" | "bottom" | "left")[]
}

export type ShadowStyle = {
  x: number
  y: number
  blur: number
  color: number
}

export type HaloStyle = {
  radius: number
  color: number
  intensity: number
}

export type StyleProperties = {
  bg: number
  fg: number
  border: BorderStyle | null
  radius: number | Corners
  shadow: ShadowStyle | null
  opacity: number
  halo: HaloStyle | null
}

// ─── Computed rect (written by layout engine) ─────────────────────────

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

// ─── The node itself ──────────────────────────────────────────────────

let counter = 0

export type SceneNode = {
  kind: NodeKind
  id: string
  tag: string
  parent: SceneNode | null
  children: SceneNode[]
  layout: LayoutConstraints
  style: StyleProperties
  dirty: boolean
  computed: Rect
  /** Opaque data for kind-specific state (e.g. text content, scroll offset) */
  data: Record<string, unknown>
}

// ─── Default factories ────────────────────────────────────────────────

const ZERO_EDGES: Edges = { top: 0, right: 0, bottom: 0, left: 0 }

export function defaults(): { layout: LayoutConstraints; style: StyleProperties } {
  return {
    layout: {
      width: "auto",
      height: "auto",
      minWidth: 0,
      minHeight: 0,
      maxWidth: Infinity,
      maxHeight: Infinity,
      flex: 0,
      flexShrink: 1,
      flexDirection: "column",
      gap: 0,
      padding: { ...ZERO_EDGES },
      margin: { ...ZERO_EDGES },
      align: "stretch",
      justify: "start",
      position: "relative",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      overflow: "visible",
    },
    style: {
      bg: 0x00000000,
      fg: 0xe0e6f0ff,
      border: null,
      radius: 0,
      shadow: null,
      opacity: 1,
      halo: null,
    },
  }
}

export function create(kind: NodeKind, tag?: string): SceneNode {
  const d = defaults()
  return {
    kind,
    id: `n${++counter}`,
    tag: tag ?? kind,
    parent: null,
    children: [],
    layout: d.layout,
    style: d.style,
    dirty: true,
    computed: { x: 0, y: 0, width: 0, height: 0 },
    data: {},
  }
}

/** Reset the ID counter (useful for deterministic tests). */
export function reset() {
  counter = 0
}
