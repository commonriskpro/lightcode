/**
 * ScrollView primitive — container with scroll offset and clipping.
 *
 * Manages a virtual content area larger than its visible region.
 * The paint system clips children to the scroll container's bounds.
 *
 * Scene data:
 *   node.data.scrollX = number (horizontal scroll offset in pixels)
 *   node.data.scrollY = number (vertical scroll offset in pixels)
 *   node.data.contentWidth = number (total content width)
 *   node.data.contentHeight = number (total content height)
 *
 * Children are painted with their positions offset by the scroll amount.
 * The painter applies a clip rect matching this node's computed bounds.
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { fill, rounded } from "../paint/rect"
import { alpha, palette } from "../tokens/color"

/** Paint the scroll container background and scrollbar track. */
export function scroll(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  // Background
  if ((nd.style.bg & 0xff) > 0) {
    const rad = typeof nd.style.radius === "number" ? nd.style.radius : 0
    rounded(buf, c.x, c.y, c.width, c.height, nd.style.bg, rad)
  }

  // Vertical scrollbar (only if content overflows)
  const total = (nd.data.contentHeight as number) ?? c.height
  if (total <= c.height) return

  const scrollY = (nd.data.scrollY as number) ?? 0
  const ratio = c.height / total
  const barH = Math.max(8, Math.floor(c.height * ratio))
  const barY = c.y + Math.floor((scrollY / total) * c.height)
  const barX = c.x + c.width - 3
  const barW = 2

  // Track
  fill(buf, barX, c.y, barW, c.height, alpha(palette.borderWeak, 0x40))
  // Thumb
  rounded(buf, barX, barY, barW, barH, alpha(palette.muted, 0x80), 1)
}

/** Get the scroll offset for transforming child positions. */
export function offset(nd: SceneNode): { x: number; y: number } {
  return {
    x: (nd.data.scrollX as number) ?? 0,
    y: (nd.data.scrollY as number) ?? 0,
  }
}

/** Update scroll position, clamping to valid range. */
export function scrollTo(nd: SceneNode, x: number, y: number) {
  const c = nd.computed
  const cw = (nd.data.contentWidth as number) ?? c.width
  const ch = (nd.data.contentHeight as number) ?? c.height
  nd.data.scrollX = Math.max(0, Math.min(cw - c.width, x))
  nd.data.scrollY = Math.max(0, Math.min(ch - c.height, y))
}

/** Scroll by a delta amount. */
export function scrollBy(nd: SceneNode, dx: number, dy: number) {
  const sx = (nd.data.scrollX as number) ?? 0
  const sy = (nd.data.scrollY as number) ?? 0
  scrollTo(nd, sx + dx, sy + dy)
}
