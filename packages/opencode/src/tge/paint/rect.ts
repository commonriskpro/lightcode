/**
 * Rectangle painting operations — fillRect and strokeRect
 * with support for rounded corners.
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"
import { rgba, alpha as withAlpha } from "../tokens/color"

/** Fill a solid rectangle. No radius. Fast path. */
export function fill(buf: PixelBuffer, x: number, y: number, w: number, h: number, color: number) {
  const [r, g, b, a] = rgba(color)
  if (a === 0) return
  const x0 = Math.max(0, x | 0)
  const y0 = Math.max(0, y | 0)
  const x1 = Math.min(buf.width, (x + w) | 0)
  const y1 = Math.min(buf.height, (y + h) | 0)
  const d = buf.data
  if (a === 0xff) {
    for (let py = y0; py < y1; py++) {
      const row = py * buf.stride
      for (let px = x0; px < x1; px++) {
        const off = row + px * 4
        d[off] = r
        d[off + 1] = g
        d[off + 2] = b
        d[off + 3] = 0xff
      }
    }
    return
  }
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) blend(buf, px, py, color)
  }
}

/** Fill a rounded rectangle. Uses per-pixel distance check for corners. */
export function rounded(buf: PixelBuffer, x: number, y: number, w: number, h: number, color: number, rad: number) {
  if (rad <= 0) return fill(buf, x, y, w, h, color)
  const r = Math.min(rad, Math.floor(w / 2), Math.floor(h / 2))
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0) return

  const x0 = Math.max(0, x | 0)
  const y0 = Math.max(0, y | 0)
  const x1 = Math.min(buf.width, (x + w) | 0)
  const y1 = Math.min(buf.height, (y + h) | 0)

  // Corner centers
  const tl = { cx: x + r, cy: y + r }
  const tr = { cx: x + w - r, cy: y + r }
  const bl = { cx: x + r, cy: y + h - r }
  const br = { cx: x + w - r, cy: y + h - r }

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Determine if this pixel is in a corner region
      let dist = -1
      if (px < tl.cx && py < tl.cy) dist = Math.sqrt((px - tl.cx) ** 2 + (py - tl.cy) ** 2) - r
      else if (px > tr.cx && py < tr.cy) dist = Math.sqrt((px - tr.cx) ** 2 + (py - tr.cy) ** 2) - r
      else if (px < bl.cx && py > bl.cy) dist = Math.sqrt((px - bl.cx) ** 2 + (py - bl.cy) ** 2) - r
      else if (px > br.cx && py > br.cy) dist = Math.sqrt((px - br.cx) ** 2 + (py - br.cy) ** 2) - r

      if (dist > 0.5) continue // outside the rounded corner
      const coverage = dist < -0.5 ? 1 : 0.5 - dist // anti-aliased edge
      const a = Math.round(ca * coverage)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}

/** Stroke (outline) a rectangle with optional radius. */
export function stroke(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  width: number,
  rad = 0,
) {
  if (width <= 0) return
  if (rad <= 0) {
    // Simple: four fill rects for each side
    fill(buf, x, y, w, width, color) // top
    fill(buf, x, y + h - width, w, width, color) // bottom
    fill(buf, x, y + width, width, h - width * 2, color) // left
    fill(buf, x + w - width, y + width, width, h - width * 2, color) // right
    return
  }
  // Rounded stroke: draw outer rounded rect, then clear inner
  rounded(buf, x, y, w, h, color, rad)
  // Paint interior with transparent to "cut out" the fill
  // Actually, for stroke we need a different approach: SDF-based
  strokeRounded(buf, x, y, w, h, color, width, rad)
}

/** Stroke a rounded rectangle using SDF approach. */
function strokeRounded(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  sw: number,
  rad: number,
) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0) return
  const r = Math.min(rad, Math.floor(w / 2), Math.floor(h / 2))

  const x0 = Math.max(0, x | 0)
  const y0 = Math.max(0, y | 0)
  const x1 = Math.min(buf.width, (x + w) | 0)
  const y1 = Math.min(buf.height, (y + h) | 0)

  // Center of the rect for SDF
  const hw = w / 2
  const hh = h / 2
  const mx = x + hw
  const my = y + hh

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Rounded rect SDF
      const dx = Math.abs(px - mx) - hw + r
      const dy = Math.abs(py - my) - hh + r
      const outside = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(dx, dy), 0) - r
      // Band: we want pixels where |outside| < sw/2
      const dist = Math.abs(outside) - sw / 2
      if (dist > 0.5) continue
      const coverage = dist < -0.5 ? 1 : 0.5 - dist
      const a = Math.round(ca * coverage)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}
