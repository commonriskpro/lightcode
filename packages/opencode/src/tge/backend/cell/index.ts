/**
 * Cell fallback backend — degraded mode for terminals without
 * Kitty graphics protocol support.
 *
 * Two approaches:
 * 1. Half-block rasterizer — converts pixel buffers to ▀ characters (2x vertical res)
 * 2. Cell-mode renderers — styled Unicode for panels, chips, dialogs etc.
 */

import type { PixelBuffer } from "../../paint"
import { get } from "../../paint"

export type CellBackend = {
  kind: "cell"
  rasterize(buf: PixelBuffer): string
}

/**
 * Convert a pixel buffer to half-block cell approximation.
 *
 * Uses ▀ (upper half block) with fg = top pixel, bg = bottom pixel
 * to get 2x vertical resolution. Each cell represents 2 vertical pixels.
 */
export function rasterize(buf: PixelBuffer, cellW: number, cellH: number): string {
  const cols = Math.floor(buf.width / cellW)
  const rows = Math.floor(buf.height / cellH)
  const lines: string[] = []

  for (let row = 0; row < rows; row++) {
    let line = ""
    for (let col = 0; col < cols; col++) {
      const px = col * cellW + Math.floor(cellW / 2)
      const topY = row * cellH + Math.floor(cellH / 4)
      const botY = row * cellH + Math.floor((cellH * 3) / 4)
      const top = get(buf, px, topY)
      const bot = get(buf, px, botY)

      const tr = (top >>> 24) & 0xff
      const tg = (top >>> 16) & 0xff
      const tb = (top >>> 8) & 0xff
      const br = (bot >>> 24) & 0xff
      const bg = (bot >>> 16) & 0xff
      const bb = (bot >>> 8) & 0xff

      line += `\x1b[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m▀`
    }
    lines.push(line + "\x1b[0m")
  }
  return lines.join("\n")
}

export function cell(): CellBackend {
  return {
    kind: "cell",
    rasterize(buf) {
      return rasterize(buf, 8, 16)
    },
  }
}

// Re-export cell-mode renderers
export {
  panel as cellPanel,
  card as cellCard,
  chip as cellChip,
  overlay as cellOverlay,
  toast as cellToast,
  composer as cellComposer,
  strip as cellStrip,
  divider as cellDivider,
} from "./render"
