/**
 * GraphNode primitive — a circle with semantic color and optional halo.
 *
 * Renders the visual representation of a graph node in the Atlas Field:
 *   - Outer halo glow (optional, for center/active nodes)
 *   - Filled circle with anti-aliased edges
 *   - Selection ring (optional)
 *
 * The TGE renders in screen-pixel coordinates (square pixels), so circles
 * are naturally circular. The bridge area-samples to 2x for terminal display.
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
import { blend } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { filled } from "../paint/circle"
import { halo as paintHalo } from "../paint/halo"
import { graph } from "../tokens/graph"
import { alpha, palette, rgba } from "../tokens/color"

type NodeKind = keyof typeof graph.node

/**
 * Star glow — smooth exponential radial falloff from center.
 * No plateau, no hard rings. Mimics how stars look in astrophotography:
 * bright core fading smoothly into the surrounding space.
 */
function star(buf: PixelBuffer, cx: number, cy: number, radius: number, color: number, peak: number) {
  const [cr, cg, cb] = rgba(color)
  const x0 = Math.max(0, Math.floor(cx - radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const x1 = Math.min(buf.width, Math.ceil(cx + radius))
  const y1 = Math.min(buf.height, Math.ceil(cy + radius))

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dx = px - cx
      const dy = py - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d >= radius) continue
      // Smooth exponential falloff: e^(-3 * (d/radius)^2)
      // At d=0 → 1.0, at d=radius/2 → 0.47, at d=radius → 0.05
      const t = d / radius
      const a = Math.round(peak * Math.exp(-3 * t * t))
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}

/** Paint a graph node onto the pixel buffer. */
export function node(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  const kind = (nd.data.kind as NodeKind) ?? "thread"
  const ring = (nd.data.ring as number) ?? 1
  const selected = (nd.data.selected as boolean) ?? false
  const dimmed = (nd.data.dimmed as boolean) ?? false
  const hover = (nd.data.hover as boolean) ?? false

  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  const base = graph.node[kind] ?? graph.node.thread
  const color = dimmed ? alpha(base, 0x80) : base
  const r = ring === 0 ? graph.centerRadius : ring <= 1 ? graph.nodeRadius : graph.smallRadius

  // 1. Selection: soft star glow — smooth exponential falloff
  if (selected) {
    star(buf, cx, cy, r * 5, base, 120)
  }

  // 2. Halo glow (center node when NOT selected, hovered nodes subtle)
  // Skip center halo when selected — the star glow replaces it cleanly
  // without the dark ring artifact from paintHalo's plateau-drop curve.
  if (ring === 0 && !selected) {
    paintHalo(buf, cx, cy, graph.haloRadius, dimmed ? alpha(graph.haloColor, 0x30) : graph.haloColor, 1)
  } else if (hover && !selected) {
    paintHalo(buf, cx, cy, r * 3, alpha(base, 0x20), 0.6)
  }

  // 3. Filled circle
  filled(buf, cx, cy, r, selected ? base : color)
}
