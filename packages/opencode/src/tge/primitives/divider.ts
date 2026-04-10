/**
 * Divider primitive — horizontal or vertical separator line.
 *
 * Scene data:
 *   node.data.direction = "horizontal" | "vertical" (default: "horizontal")
 *   node.style.fg = color of the line
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { fill } from "../paint/rect"

/** Paint a divider onto the pixel buffer. */
export function divider(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  const dir = (nd.data.direction as string) ?? "horizontal"
  const color = nd.style.fg

  if (dir === "horizontal") {
    const y = c.y + Math.floor(c.height / 2)
    fill(buf, c.x, y, c.width, 1, color)
  } else {
    const x = c.x + Math.floor(c.width / 2)
    fill(buf, x, c.y, 1, c.height, color)
  }
}
