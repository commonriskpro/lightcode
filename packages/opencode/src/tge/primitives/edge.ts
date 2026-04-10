/**
 * GraphEdge primitive — anti-aliased line or curve between two points.
 *
 * Renders connections between graph nodes in the Atlas Field.
 * Supports straight lines and quadratic Bézier curves.
 *
 * Scene data:
 *   node.data.x0, node.data.y0 = start point (pixels)
 *   node.data.x1, node.data.y1 = end point (pixels)
 *   node.data.weight = "strong" | "normal" | "weak"
 *   node.data.curve = number (0 = straight, >0 = curvature amount)
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { line, bezier } from "../paint/line"
import { graph } from "../tokens/graph"
import { alpha } from "../tokens/color"

type Weight = "strong" | "normal" | "weak"

const WIDTH: Record<Weight, number> = {
  strong: graph.edgeStrong,
  normal: graph.edgeNormal,
  weak: graph.edgeWeak,
}

/** Paint a graph edge onto the pixel buffer. */
export function edge(buf: PixelBuffer, nd: SceneNode) {
  const x0 = (nd.data.x0 as number) ?? 0
  const y0 = (nd.data.y0 as number) ?? 0
  const x1 = (nd.data.x1 as number) ?? 0
  const y1 = (nd.data.y1 as number) ?? 0
  const weight = (nd.data.weight as Weight) ?? "normal"
  const curve = (nd.data.curve as number) ?? 0

  const color = graph.edge[weight] ?? graph.edge.normal
  // Weaker edges are more transparent
  const adjusted = weight === "weak" ? alpha(color, 0x60) : weight === "normal" ? alpha(color, 0x90) : color
  const w = WIDTH[weight]

  if (curve === 0 || Math.abs(curve) < 1) {
    line(buf, x0, y0, x1, y1, adjusted, w)
    return
  }

  // Compute control point perpendicular to the midpoint
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return
  // Perpendicular offset
  const nx = -dy / len
  const ny = dx / len
  const cx = mx + nx * curve
  const cy = my + ny * curve

  bezier(buf, x0, y0, cx, cy, x1, y1, adjusted, w)
}
