/**
 * Halo / glow effect — soft radial gradient around a center point.
 *
 * Used for graph node halos and cluster ambient glow.
 * Implemented as a radial gradient (no blur pass needed for this shape).
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"
import { rgba } from "../tokens/color"

/**
 * Draw a soft radial halo glow (elliptical when ry specified).
 *
 * Falloff uses a plateau-then-drop curve: full intensity in the inner 40%,
 * then steep quadratic falloff. This ensures the halo survives the 4:1
 * downsample + quadrant-block rendering pipeline.
 *
 * Pass `ry = rx * (cellW/cellH)` to compensate for non-square terminal cells.
 */
export function halo(buf: PixelBuffer, cx: number, cy: number, rx: number, color: number, intensity = 1, ry?: number) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0 || rx <= 0 || intensity <= 0) return
  const ey = ry ?? rx

  const x0 = Math.max(0, Math.floor(cx - rx))
  const y0 = Math.max(0, Math.floor(cy - ey))
  const x1 = Math.min(buf.width, Math.ceil(cx + rx))
  const y1 = Math.min(buf.height, Math.ceil(cy + ey))

  // Inner 40% of radius is full intensity, then quadratic falloff
  const inner = rx * 0.4
  const outer = rx - inner

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Normalize to circle space for elliptical distance
      const nx = (px - cx) / rx
      const ny = (py - cy) / ey
      const dist = Math.sqrt(nx * nx + ny * ny) * rx
      if (dist >= rx) continue
      const falloff = dist <= inner ? 1 : 1 - ((dist - inner) / outer) ** 2
      const a = Math.round(ca * falloff * intensity)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}

/**
 * Box blur a rectangular region of the buffer (in-place approximation).
 *
 * Three passes of box blur approximate a Gaussian blur.
 * Used for shadow effects.
 */
export function blur(buf: PixelBuffer, x: number, y: number, w: number, h: number, radius: number, passes = 3) {
  if (radius <= 0) return
  const r = Math.ceil(radius)
  for (let p = 0; p < passes; p++) {
    blurH(buf, x, y, w, h, r)
    blurV(buf, x, y, w, h, r)
  }
}

function blurH(buf: PixelBuffer, bx: number, by: number, bw: number, bh: number, r: number) {
  const x0 = Math.max(0, bx | 0)
  const y0 = Math.max(0, by | 0)
  const x1 = Math.min(buf.width, (bx + bw) | 0)
  const y1 = Math.min(buf.height, (by + bh) | 0)
  const width = x1 - x0
  if (width <= 0) return
  const tmp = new Uint8Array(width * 4)
  const d = buf.data

  for (let py = y0; py < y1; py++) {
    const row = py * buf.stride
    // Running sum
    let sr = 0,
      sg = 0,
      sb = 0,
      sa = 0,
      cnt = 0
    // Seed the window
    for (let dx = -r; dx <= r; dx++) {
      const px = x0 + dx
      if (px >= x0 && px < x1) {
        const off = row + px * 4
        sr += d[off]
        sg += d[off + 1]
        sb += d[off + 2]
        sa += d[off + 3]
        cnt++
      }
    }
    for (let px = x0; px < x1; px++) {
      const ti = (px - x0) * 4
      tmp[ti] = sr / cnt
      tmp[ti + 1] = sg / cnt
      tmp[ti + 2] = sb / cnt
      tmp[ti + 3] = sa / cnt
      // Slide window
      const add = px + r + 1
      const rem = px - r
      if (add < x1) {
        const off = row + add * 4
        sr += d[off]
        sg += d[off + 1]
        sb += d[off + 2]
        sa += d[off + 3]
        cnt++
      }
      if (rem >= x0) {
        const off = row + rem * 4
        sr -= d[off]
        sg -= d[off + 1]
        sb -= d[off + 2]
        sa -= d[off + 3]
        cnt--
      }
    }
    // Write back
    for (let px = x0; px < x1; px++) {
      const off = row + px * 4
      const ti = (px - x0) * 4
      d[off] = tmp[ti]
      d[off + 1] = tmp[ti + 1]
      d[off + 2] = tmp[ti + 2]
      d[off + 3] = tmp[ti + 3]
    }
  }
}

function blurV(buf: PixelBuffer, bx: number, by: number, bw: number, bh: number, r: number) {
  const x0 = Math.max(0, bx | 0)
  const y0 = Math.max(0, by | 0)
  const x1 = Math.min(buf.width, (bx + bw) | 0)
  const y1 = Math.min(buf.height, (by + bh) | 0)
  const height = y1 - y0
  if (height <= 0) return
  const tmp = new Uint8Array(height * 4)
  const d = buf.data

  for (let px = x0; px < x1; px++) {
    let sr = 0,
      sg = 0,
      sb = 0,
      sa = 0,
      cnt = 0
    for (let dy = -r; dy <= r; dy++) {
      const py = y0 + dy
      if (py >= y0 && py < y1) {
        const off = py * buf.stride + px * 4
        sr += d[off]
        sg += d[off + 1]
        sb += d[off + 2]
        sa += d[off + 3]
        cnt++
      }
    }
    for (let py = y0; py < y1; py++) {
      const ti = (py - y0) * 4
      tmp[ti] = sr / cnt
      tmp[ti + 1] = sg / cnt
      tmp[ti + 2] = sb / cnt
      tmp[ti + 3] = sa / cnt
      const add = py + r + 1
      const rem = py - r
      if (add < y1) {
        const off = add * buf.stride + px * 4
        sr += d[off]
        sg += d[off + 1]
        sb += d[off + 2]
        sa += d[off + 3]
        cnt++
      }
      if (rem >= y0) {
        const off = rem * buf.stride + px * 4
        sr -= d[off]
        sg -= d[off + 1]
        sb -= d[off + 2]
        sa -= d[off + 3]
        cnt--
      }
    }
    for (let py = y0; py < y1; py++) {
      const off = py * buf.stride + px * 4
      const ti = (py - y0) * 4
      d[off] = tmp[ti]
      d[off + 1] = tmp[ti + 1]
      d[off + 2] = tmp[ti + 2]
      d[off + 3] = tmp[ti + 3]
    }
  }
}
