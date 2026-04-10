/**
 * Ellipse/circle drawing with anti-aliasing using SDF approach.
 * Used for graph nodes.
 *
 * All functions accept an optional `ry` for the Y radius to draw ellipses.
 * When omitted, ry defaults to rx (circle). Pass `ry = rx * (cellW/cellH)`
 * to compensate for non-square terminal cells (~2:1 aspect ratio).
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"
import { rgba } from "../tokens/color"

/** Draw a filled ellipse (or circle when ry omitted) with anti-aliased edges. */
export function filled(buf: PixelBuffer, cx: number, cy: number, rx: number, color: number, ry?: number) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0 || rx <= 0) return
  const ey = ry ?? rx

  const x0 = Math.max(0, Math.floor(cx - rx - 1))
  const y0 = Math.max(0, Math.floor(cy - ey - 1))
  const x1 = Math.min(buf.width, Math.ceil(cx + rx + 1))
  const y1 = Math.min(buf.height, Math.ceil(cy + ey + 1))

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Ellipse SDF: normalize Y by ry/rx ratio so the distance field is circular
      const nx = (px - cx) / rx
      const ny = (py - cy) / ey
      const dist = Math.sqrt(nx * nx + ny * ny) * rx - rx
      if (dist > 0.5) continue
      const coverage = dist < -0.5 ? 1 : 0.5 - dist
      const a = Math.round(ca * coverage)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}

/** Draw a stroked ellipse (ring) with anti-aliased edges. */
export function stroked(buf: PixelBuffer, cx: number, cy: number, rx: number, color: number, width = 1, ry?: number) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0 || rx <= 0) return
  const ey = ry ?? rx

  const outerX = rx + width / 2
  const outerY = ey + width / 2
  const x0 = Math.max(0, Math.floor(cx - outerX - 1))
  const y0 = Math.max(0, Math.floor(cy - outerY - 1))
  const x1 = Math.min(buf.width, Math.ceil(cx + outerX + 1))
  const y1 = Math.min(buf.height, Math.ceil(cy + outerY + 1))

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const nx = (px - cx) / rx
      const ny = (py - cy) / ey
      const d = Math.sqrt(nx * nx + ny * ny) * rx
      const dist = Math.abs(d - rx) - width / 2
      if (dist > 0.5) continue
      const coverage = dist < -0.5 ? 1 : 0.5 - dist
      const a = Math.round(ca * coverage)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}
