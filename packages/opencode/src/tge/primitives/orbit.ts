/**
 * Orbit ring primitive — a thin stroked ellipse for concentric ring guides.
 *
 * Paints the faint orbit lines behind graph nodes, giving the Atlas Field
 * its constellation / planetary system aesthetic.
 *
 * Scene data:
 *   node.data.rx = number (horizontal radius in screen pixels)
 *   node.data.ry = number (vertical radius in screen pixels)
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { stroked } from "../paint/circle"
import { graph } from "../tokens/graph"

/** Paint an orbit ring guide onto the pixel buffer. */
export function orbit(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  const rx = (nd.data.rx as number) ?? 0
  const ry = (nd.data.ry as number) ?? 0
  if (rx <= 0 || ry <= 0) return

  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2

  stroked(buf, cx, cy, rx, graph.orbitColor, graph.orbitWidth, ry)
}
