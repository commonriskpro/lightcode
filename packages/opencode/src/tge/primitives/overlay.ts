/**
 * Overlay primitive — floating surface with backdrop dim.
 *
 * Used for dialogs, command palette, modals.
 * Paints:
 *   1. A semi-transparent backdrop over the entire viewport
 *   2. A centered panel with shadow and rounded corners
 *
 * Scene data:
 *   node.data.backdrop = number (RGBA color for backdrop dim, e.g. 0x000000A0)
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { fill, rounded } from "../paint/rect"
import { blur } from "../paint/halo"
import { alpha, palette } from "../tokens/color"

/** Paint an overlay onto the pixel buffer. */
export function overlay(buf: PixelBuffer, nd: SceneNode) {
  const c = nd.computed
  if (c.width <= 0 || c.height <= 0) return

  // 1. Backdrop dim (covers the full viewport area of this node)
  const backdrop = (nd.data.backdrop as number) ?? alpha(palette.void, 0xb0)
  // The overlay's computed rect IS the viewport (absolute positioned, full size)
  // Its children are the actual dialog content
  if ((backdrop & 0xff) > 0) {
    fill(buf, c.x, c.y, c.width, c.height, backdrop)
  }

  // The overlay itself doesn't paint content — its children (panels) do.
  // This just provides the backdrop dim layer.
}

/**
 * Paint an overlay panel (the dialog box itself, child of overlay).
 * This is a convenience — in practice the child is a regular "panel" node
 * and gets painted by the panel primitive.
 */
