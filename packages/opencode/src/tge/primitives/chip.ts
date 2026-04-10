/**
 * Chip primitive — small semantic badge for thread/anchor/signal/drift.
 *
 * Renders as a pill-shaped (fully rounded) background with a symbol
 * and label. The text itself is rendered by the cell layer (opentui),
 * so this primitive only paints the background shape.
 *
 * Usage in scene graph:
 *   node.data.kind = "thread" | "anchor" | "signal" | "drift" | "neutral"
 *   node.data.label = "ACTIVE"
 */

import type { PixelBuffer } from "../paint/buffer"
import type { SceneNode } from "../scene/node"
import { rounded } from "../paint/rect"
import { accent, palette, surface as surfaceTokens } from "../tokens/color"

type ChipKind = "thread" | "anchor" | "signal" | "drift" | "neutral"

const BG: Record<ChipKind, number> = {
  thread: accent.thread,
  anchor: accent.anchor,
  signal: accent.signal,
  drift: accent.drift,
  neutral: surfaceTokens.card,
}

/** Paint a chip background onto the pixel buffer. */
export function chip(buf: PixelBuffer, node: SceneNode) {
  const c = node.computed
  if (c.width <= 0 || c.height <= 0) return

  const kind = (node.data.kind as ChipKind) ?? "neutral"
  const color = BG[kind] ?? BG.neutral
  // Pill shape: radius = half the height
  const rad = Math.floor(c.height / 2)

  rounded(buf, c.x, c.y, c.width, c.height, color, rad)
}

/** Get the text color for a chip kind (for the cell layer). */
export function fg(kind: ChipKind): number {
  if (kind === "neutral") return palette.text
  return palette.void
}
