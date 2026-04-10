/**
 * GraphNode primitive — a circle with semantic color and optional halo.
 *
 * Renders the visual representation of a graph node in the Atlas Field:
 *   - Outer halo glow (optional, for center/active nodes)
 *   - Filled circle with anti-aliased edges
 *   - Selection ring (optional)
 *
 * The label is rendered by the cell layer (opentui), not by this primitive.
 *
 * Scene data:
 *   node.data.kind = "thread" | "anchor" | "signal" | "drift" | "file" | "mcp" | "parent" | "child"
 *   node.data.ring = 0 | 1 | 2 | 3  (proximity ring, 0 = center)
 *   node.data.selected = boolean
 *   node.data.hover = boolean
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { filled, stroked } from "../paint/circle"
import { halo as paintHalo } from "../paint/halo"
import { graph } from "../tokens/graph"
import { alpha, palette } from "../tokens/color"

type NodeKind = keyof typeof graph.node

/** Paint a graph node onto the pixel buffer. */
export function node(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  const kind = (nd.data.kind as NodeKind) ?? "thread"
  const ring = (nd.data.ring as number) ?? 1
  const selected = (nd.data.selected as boolean) ?? false
  const hover = (nd.data.hover as boolean) ?? false

  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  const color = graph.node[kind] ?? graph.node.thread
  const r = ring === 0 ? graph.centerRadius : ring <= 1 ? graph.nodeRadius : graph.smallRadius

  // 1. Halo glow (only for center node or hovered nodes)
  if (ring === 0) {
    paintHalo(buf, cx, cy, graph.haloRadius, graph.haloColor, 1)
  } else if (hover) {
    paintHalo(buf, cx, cy, r * 3, alpha(color, 0x20), 0.6)
  }

  // 2. Filled circle
  filled(buf, cx, cy, r, color)

  // 3. Selection ring
  if (selected) {
    stroked(buf, cx, cy, r + 1, palette.bright, 1)
  }
}
