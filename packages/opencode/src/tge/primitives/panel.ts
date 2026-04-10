/**
 * Panel primitive — the fundamental surface of every TGE UI region.
 *
 * Paints a rectangular surface with optional:
 *   - background (solid color)
 *   - border (with optional radius)
 *   - shadow (offset + blur)
 *   - corner radius (anti-aliased via SDF)
 *
 * This is the most-used primitive. Every sidebar, card, context panel,
 * and dialog is a Panel at its core.
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode, Corners } from "../scene/node"
import { fill, rounded, stroke } from "../paint/rect"
import { halo as paintHalo } from "../paint/halo"
import { blur } from "../paint/halo"
import { alpha } from "../tokens/color"

/** Paint a panel node onto the pixel buffer. */
export function panel(buf: PixelBuffer, node: SceneNode) {
  const c = node.computed
  const s = node.style
  if (c.width <= 0 || c.height <= 0) return

  const rad = typeof s.radius === "number" ? s.radius : 0

  // 1. Shadow (painted first, behind everything)
  if (s.shadow) {
    const sh = s.shadow
    if (sh.blur > 0 || sh.x !== 0 || sh.y !== 0) {
      // Paint a dark rect offset by shadow position, then blur it
      const sx = c.x + sh.x - sh.blur
      const sy = c.y + sh.y - sh.blur
      const sw = c.width + sh.blur * 2
      const sh2 = c.height + sh.blur * 2
      rounded(buf, sx, sy, sw, sh2, sh.color, rad + sh.blur)
      if (sh.blur > 0) blur(buf, sx, sy, sw, sh2, sh.blur)
    }
  }

  // 2. Background fill
  if ((s.bg & 0xff) > 0) {
    rounded(buf, c.x, c.y, c.width, c.height, s.bg, rad)
  }

  // 3. Border
  if (s.border && s.border.width > 0) {
    stroke(buf, c.x, c.y, c.width, c.height, s.border.color, s.border.width, rad)
  }
}
