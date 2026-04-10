/**
 * Anti-aliased line drawing using Wu's algorithm.
 * Essential for graph edges.
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"
import { rgba } from "../tokens/color"

/** Draw an anti-aliased line from (x0,y0) to (x1,y1). */
export function line(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: number, width = 1) {
  if (width <= 1) return wu(buf, x0, y0, x1, y1, color)
  // For wider lines, draw multiple parallel Wu lines offset perpendicular
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.001) return
  // Perpendicular unit vector
  const nx = -dy / len
  const ny = dx / len
  const half = (width - 1) / 2
  const steps = Math.ceil(width)
  for (let i = 0; i < steps; i++) {
    const t = -half + i
    wu(buf, x0 + nx * t, y0 + ny * t, x1 + nx * t, y1 + ny * t, color)
  }
}

/** Wu's anti-aliased line algorithm. */
function wu(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: number) {
  const [cr, cg, cb, ca] = rgba(color)
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0)
  if (steep) {
    ;[x0, y0] = [y0, x0]
    ;[x1, y1] = [y1, x1]
  }
  if (x0 > x1) {
    ;[x0, x1] = [x1, x0]
    ;[y0, y1] = [y1, y0]
  }
  const dx = x1 - x0
  const dy = y1 - y0
  const gradient = dx < 0.001 ? 1 : dy / dx

  // First endpoint
  let xEnd = Math.round(x0)
  let yEnd = y0 + gradient * (xEnd - x0)
  let xGap = rfrac(x0 + 0.5)
  const xPx1 = xEnd
  const yPx1 = Math.floor(yEnd)
  plot(buf, steep, xPx1, yPx1, rfrac(yEnd) * xGap, cr, cg, cb, ca)
  plot(buf, steep, xPx1, yPx1 + 1, frac(yEnd) * xGap, cr, cg, cb, ca)
  let intery = yEnd + gradient

  // Second endpoint
  xEnd = Math.round(x1)
  yEnd = y1 + gradient * (xEnd - x1)
  xGap = frac(x1 + 0.5)
  const xPx2 = xEnd
  const yPx2 = Math.floor(yEnd)
  plot(buf, steep, xPx2, yPx2, rfrac(yEnd) * xGap, cr, cg, cb, ca)
  plot(buf, steep, xPx2, yPx2 + 1, frac(yEnd) * xGap, cr, cg, cb, ca)

  // Main loop
  for (let x = xPx1 + 1; x < xPx2; x++) {
    const y = Math.floor(intery)
    plot(buf, steep, x, y, rfrac(intery), cr, cg, cb, ca)
    plot(buf, steep, x, y + 1, frac(intery), cr, cg, cb, ca)
    intery += gradient
  }
}

function plot(
  buf: PixelBuffer,
  steep: boolean,
  x: number,
  y: number,
  brightness: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const alpha = Math.round(a * brightness)
  if (alpha <= 0) return
  const px = steep ? y : x
  const py = steep ? x : y
  blend(buf, px, py, ((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0)
}

function frac(x: number) {
  return x - Math.floor(x)
}

function rfrac(x: number) {
  return 1 - frac(x)
}

/** Draw a quadratic Bézier curve (for curved graph edges). */
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
  // Approximate with line segments
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  const steps = Math.max(8, Math.ceil(len / 3))
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
