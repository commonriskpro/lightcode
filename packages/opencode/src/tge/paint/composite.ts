/**
 * Buffer-level compositing operations.
 * Composites one PixelBuffer onto another with src-over blending.
 */

import type { PixelBuffer } from "./buffer"
import { blend } from "./buffer"

/** Composite `src` onto `dst` at position (dx, dy) using src-over. */
export function over(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number) {
  const x0 = Math.max(0, dx | 0)
  const y0 = Math.max(0, dy | 0)
  const x1 = Math.min(dst.width, (dx + src.width) | 0)
  const y1 = Math.min(dst.height, (dy + src.height) | 0)

  for (let py = y0; py < y1; py++) {
    const srcRow = (py - dy) * src.stride
    for (let px = x0; px < x1; px++) {
      const srcOff = srcRow + (px - dx) * 4
      const sa = src.data[srcOff + 3]
      if (sa === 0) continue
      const color = ((src.data[srcOff] << 24) | (src.data[srcOff + 1] << 16) | (src.data[srcOff + 2] << 8) | sa) >>> 0
      blend(dst, px, py, color)
    }
  }
}

/** Composite `src` onto `dst` with a uniform opacity multiplier (0-1). */
export function withOpacity(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number, opacity: number) {
  if (opacity <= 0) return
  if (opacity >= 1) return over(dst, src, dx, dy)

  const x0 = Math.max(0, dx | 0)
  const y0 = Math.max(0, dy | 0)
  const x1 = Math.min(dst.width, (dx + src.width) | 0)
  const y1 = Math.min(dst.height, (dy + src.height) | 0)
  const mul = Math.round(opacity * 255)

  for (let py = y0; py < y1; py++) {
    const srcRow = (py - dy) * src.stride
    for (let px = x0; px < x1; px++) {
      const srcOff = srcRow + (px - dx) * 4
      const sa = (src.data[srcOff + 3] * mul) >> 8
      if (sa === 0) continue
      const color = ((src.data[srcOff] << 24) | (src.data[srcOff + 1] << 16) | (src.data[srcOff + 2] << 8) | sa) >>> 0
      blend(dst, px, py, color)
    }
  }
}
