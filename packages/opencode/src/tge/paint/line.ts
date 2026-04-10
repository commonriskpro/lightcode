/**
 * Anti-aliased line and bezier curve rendering using SDF approach.
 *
 * Uses distance-to-segment SDF for each pixel — the same analytical approach
 * as circle.ts uses for nodes. Each pixel computes its distance to the line
 * segment, then converts to coverage. No stamps, no overlap issues.
 *
 * For bezier curves, the curve is flattened into short line segments, each
 * rendered with the segment SDF.
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"
import { rgba } from "../tokens/color"

/**
 * Draw an anti-aliased line segment with the given width.
 * Uses distance-to-segment SDF — exact per-pixel coverage, no stamps.
 */
export function line(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: number, width = 1) {
  const [cr, cg, cb, ca] = rgba(color)
  if (ca === 0) return
  const half = width / 2

  // Bounding box with padding for AA
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - half - 1))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - half - 1))
  const maxX = Math.min(buf.width, Math.ceil(Math.max(x0, x1) + half + 1))
  const maxY = Math.min(buf.height, Math.ceil(Math.max(y0, y1) + half + 1))

  // Segment vector
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy

  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      // Distance from pixel to the line segment
      const d = segDist(px, py, x0, y0, dx, dy, len2)
      const dist = d - half
      if (dist > 0.5) continue
      const cov = dist < -0.5 ? 1 : 0.5 - dist
      const a = Math.round(ca * cov)
      if (a <= 0) continue
      blend(buf, px, py, ((cr << 24) | (cg << 16) | (cb << 8) | a) >>> 0)
    }
  }
}

/** Euclidean distance from point (px,py) to line segment (x0,y0)→(x0+dx,y0+dy). */
function segDist(px: number, py: number, x0: number, y0: number, dx: number, dy: number, len2: number): number {
  if (len2 < 0.001) return Math.sqrt((px - x0) ** 2 + (py - y0) ** 2)
  // Project point onto segment, clamped to [0,1]
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2))
  const cx = x0 + t * dx
  const cy = y0 + t * dy
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
}

/** Draw a quadratic Bezier curve as a series of SDF line segments. */
export function bezier(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  color: number,
  width = 1,
) {
  // Estimate arc length for step count
  const d0 = Math.sqrt((cx - x0) ** 2 + (cy - y0) ** 2)
  const d1 = Math.sqrt((x1 - cx) ** 2 + (y1 - cy) ** 2)
  const arc = d0 + d1
  // Each segment ~4px long — short enough for smooth curves, long enough for performance
  const steps = Math.max(8, Math.ceil(arc / 4))
  let px = x0
  let py = y0
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const it = 1 - t
    const nx = it * it * x0 + 2 * it * t * cx + t * t * x1
    const ny = it * it * y0 + 2 * it * t * cy + t * t * y1
    line(buf, px, py, nx, ny, color, width)
    px = nx
    py = ny
  }
}
