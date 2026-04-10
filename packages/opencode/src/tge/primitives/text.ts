/**
 * Text primitive — cell-based bridge for text content.
 *
 * The TGE does NOT rasterize text into pixels. Text is rendered by
 * the terminal's native font engine via opentui's cell grid.
 *
 * This primitive serves two purposes:
 *   1. Reserves the pixel region for text (paints background only)
 *   2. Provides layout information for the cell layer to position text
 *
 * Scene data:
 *   node.data.content = string (the text to display)
 *   node.data.cellWidth = number (terminal cell width in pixels)
 *   node.data.cellHeight = number (terminal cell height in pixels)
 *
 * The actual text rendering happens in the opentui integration layer,
 * not here. This primitive only ensures the background behind text
 * matches the TGE's pixel-rendered surfaces.
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { rounded } from "../paint/rect"

/** Paint the text background region (text itself is cell-based). */
export function text(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  // Only paint background if the node has one
  const bg = nd.style.bg
  if ((bg & 0xff) === 0) return

  const rad = typeof nd.style.radius === "number" ? nd.style.radius : 0
  rounded(buf, c.x, c.y, c.width, c.height, bg, rad)
}

/**
 * Compute the cell position and dimensions for this text node,
 * so the opentui cell layer knows where to render the actual text.
 */
export function cells(nd: SceneNode): { col: number; row: number; cols: number; rows: number } | null {
  const c = nd.computed
  const cw = (nd.data.cellWidth as number) ?? 8
  const ch = (nd.data.cellHeight as number) ?? 16
  if (cw === 0 || ch === 0) return null
  return {
    col: Math.floor(c.x / cw),
    row: Math.floor(c.y / ch),
    cols: Math.ceil(c.width / cw),
    rows: Math.ceil(c.height / ch),
  }
}
