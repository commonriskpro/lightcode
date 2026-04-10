/**
 * Circle drawing with anti-aliasing using SDF approach.
 * Used for graph nodes.
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"
import { rgba } from "../tokens/color"

/** Draw a filled circle with anti-aliased edges. */
export function filled(buf: PixelBuffer, cx: number, cy: number, r: number, color: number) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0 || r <= 0) return

  const x0 = Math.max(0, Math.floor(cx - r - 1))
  const y0 = Math.max(0, Math.floor(cy - r - 1))
  const x1 = Math.min(buf.width, Math.ceil(cx + r + 1))
  const y1 = Math.min(buf.height, Math.ceil(cy + r + 1))

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r
      if (dist > 0.5) continue
      const coverage = dist < -0.5 ? 1 : 0.5 - dist
      const a = Math.round(ca * coverage)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}

/** Draw a stroked circle (ring) with anti-aliased edges. */
export function stroked(buf: PixelBuffer, cx: number, cy: number, r: number, color: number, width = 1) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0 || r <= 0) return

  const outer = r + width / 2
  const x0 = Math.max(0, Math.floor(cx - outer - 1))
  const y0 = Math.max(0, Math.floor(cy - outer - 1))
  const x1 = Math.min(buf.width, Math.ceil(cx + outer + 1))
  const y1 = Math.min(buf.height, Math.ceil(cy + outer + 1))

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
      // Distance to the ring band
      const dist = Math.abs(d - r) - width / 2
      if (dist > 0.5) continue
      const coverage = dist < -0.5 ? 1 : 0.5 - dist
      const a = Math.round(ca * coverage)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}
