/**
 * opentui pixel bridge — composites TGE PixelBuffers into opentui's render pipeline.
 *
 * Uses drawPackedBuffer with custom quadrant rendering for maximum quality.
 * Instead of drawSuperSampleBuffer (which downsamples to 2×2 then picks 2 colors
 * from 4 pixels), we area-average each quadrant from ~31+ source pixels each,
 * producing far superior color fidelity while keeping 2×2 spatial resolution.
 *
 * Per-cell pipeline:
 *   1. Map cell to source pixel region (cellW × cellH pixels, e.g. 7×18)
 *   2. Split into 4 quadrants (TL, TR, BL, BR) — each ~3.5×9 = ~31 pixels
 *   3. Area-average each quadrant → 4 true colors
 *   4. Pick optimal 2 colors + quadrant char (same Unicode chars as opentui)
 *   5. Pack into 48-byte cell result for drawPackedBuffer
 *
 * Text labels are written AFTER the packed buffer call via drawText.
 */

import type { PixelBuffer } from "../paint/buffer"
import { ptr } from "bun:ffi"
import { RGBA, type OptimizedBuffer } from "@opentui/core"

export type TextLabel = {
  content: string
  col: number
  row: number
  fg: number // packed RGBA u32
}

export type Region = {
  col: number
  row: number
  cols: number
  rows: number
  buf: PixelBuffer
  key: string
  labels?: TextLabel[]
}

export type Bridge = {
  submit(region: Region): void
  clear(): void
  process: (buffer: OptimizedBuffer, delta: number) => void
  paint(buffer: OptimizedBuffer, region: Region): void
  destroy(): void
}

// Void black RGBA bytes
const VR = 0x04
const VG = 0x04
const VB = 0x0a

// Quadrant block Unicode characters (same as opentui's renderQuadrantBlock)
// Index = 4-bit pattern: bit3=TL, bit2=TR, bit1=BL, bit0=BR (1=dark, 0=light)
const QCHARS: number[] = [
  0x20 /*      */, 0x2597 /* ▗ */, 0x2596 /* ▖ */, 0x2584 /* ▄ */, 0x259d /* ▝ */, 0x2590 /* ▐ */, 0x259e /* ▞ */,
  0x259f /* ▟ */, 0x2598 /* ▘ */, 0x259a /* ▚ */, 0x258c /* ▌ */, 0x2599 /* ▙ */, 0x2580 /* ▀ */, 0x259c /* ▜ */,
  0x259b /* ▛ */, 0x2588 /* █ */,
]

/**
 * Area-average a rectangular region of source pixels, compositing alpha onto void black.
 * Returns [r, g, b] as 0-255 integers.
 */
function avg(
  sd: Uint8Array,
  ss: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sw: number,
  sh: number,
): [number, number, number] {
  let tr = 0,
    tg = 0,
    tb = 0,
    cnt = 0
  const ex = Math.min(x1, sw)
  const ey = Math.min(y1, sh)
  for (let py = y0; py < ey; py++) {
    const row = py * ss
    for (let px = x0; px < ex; px++) {
      const si = row + px * 4
      const a = sd[si + 3]
      if (a === 0) {
        tr += VR
        tg += VG
        tb += VB
      } else if (a === 0xff) {
        tr += sd[si]
        tg += sd[si + 1]
        tb += sd[si + 2]
      } else {
        const inv = 255 - a
        tr += (sd[si] * a + VR * inv + 127) / 255
        tg += (sd[si + 1] * a + VG * inv + 127) / 255
        tb += (sd[si + 2] * a + VB * inv + 127) / 255
      }
      cnt++
    }
  }
  if (cnt === 0) return [VR, VG, VB]
  return [(tr / cnt + 0.5) | 0, (tg / cnt + 0.5) | 0, (tb / cnt + 0.5) | 0]
}

/** Squared color distance (perceptual weighting). */
function dist(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2]
  // Weighted: green has highest perceptual weight
  return dr * dr * 2 + dg * dg * 4 + db * db * 3
}

/** Luminance (0-255). */
function lum(c: [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Write a float32 to a DataView. */
function f32(dv: DataView, off: number, v: number) {
  dv.setFloat32(off, v, true) // little-endian
}

/**
 * Rasterize the screen-pixel buffer into packed cell results for drawPackedBuffer.
 *
 * For each terminal cell, area-averages 4 quadrants from the source pixels,
 * picks the optimal 2-color + quadrant char combination, and writes the
 * 48-byte packed result (bg f32×4 + fg f32×4 + char u32 + padding).
 */
function rasterize(src: PixelBuffer, cols: number, rows: number, cw: number, ch: number): ArrayBuffer {
  const cells = cols * rows
  const buf = new ArrayBuffer(cells * 48)
  const dv = new DataView(buf)
  const sd = src.data
  const ss = src.stride
  const hw = (cw / 2) | 0 // half cell width
  const hh = (ch / 2) | 0 // half cell height

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const sx = cx * cw
      const sy = cy * ch
      const mx = sx + hw
      const my = sy + hh

      // Area-average 4 quadrants from ~(cw/2 × ch/2) pixels each
      const tl = avg(sd, ss, sx, sy, mx, my, src.width, src.height)
      const tr = avg(sd, ss, mx, sy, sx + cw, my, src.width, src.height)
      const bl = avg(sd, ss, sx, my, mx, sy + ch, src.width, src.height)
      const br = avg(sd, ss, mx, my, sx + cw, sy + ch, src.width, src.height)

      const quads: [number, number, number][] = [tl, tr, bl, br]

      // Find the 2 most different colors (same algo as opentui but on averaged colors)
      let ai = 0,
        bi = 1,
        best = dist(tl, tr)
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const d = dist(quads[i], quads[j])
          if (d > best) {
            ai = i
            bi = j
            best = d
          }
        }
      }

      // Dark = lower luminance, light = higher luminance
      let dark = quads[ai],
        light = quads[bi]
      if (lum(dark) > lum(light)) {
        const t = dark
        dark = light
        light = t
      }

      // Classify each quadrant as dark (1) or light (0)
      let bits = 0
      const bv = [8, 4, 2, 1]
      for (let i = 0; i < 4; i++) {
        if (dist(quads[i], dark) <= dist(quads[i], light)) bits |= bv[i]
      }

      // When all same color, use space with averaged bg
      let fg: [number, number, number], bg: [number, number, number], ch32: number
      if (bits === 0) {
        // All light — average all for bg, dark for fg (unused but required)
        const a = avg(sd, ss, sx, sy, sx + cw, sy + ch, src.width, src.height)
        fg = dark
        bg = a
        ch32 = 0x20
      } else if (bits === 15) {
        // All dark — average all for fg, light for bg (unused)
        const a = avg(sd, ss, sx, sy, sx + cw, sy + ch, src.width, src.height)
        fg = a
        bg = light
        ch32 = QCHARS[15]
      } else {
        fg = dark
        bg = light
        ch32 = QCHARS[bits]
      }

      // Pack 48 bytes: bg(f32×4) + fg(f32×4) + char(u32) + pad(u32×3)
      const off = (cy * cols + cx) * 48
      // bg RGBA as floats (0.0-1.0)
      f32(dv, off, bg[0] / 255)
      f32(dv, off + 4, bg[1] / 255)
      f32(dv, off + 8, bg[2] / 255)
      f32(dv, off + 12, 1.0)
      // fg RGBA as floats
      f32(dv, off + 16, fg[0] / 255)
      f32(dv, off + 20, fg[1] / 255)
      f32(dv, off + 24, fg[2] / 255)
      f32(dv, off + 28, 1.0)
      // char as u32
      dv.setUint32(off + 32, ch32, true)
      // padding zeros (already 0 from ArrayBuffer)
    }
  }

  return buf
}

export function bridge(_cellW: number, _cellH: number, _mode: "supersample" | "halfblock" = "supersample"): Bridge {
  const regions: Region[] = []
  let packed: Uint8Array | null = null
  let curCells = 0

  const process = (buffer: OptimizedBuffer, _delta: number) => {
    for (const r of regions) {
      render(buffer, r)
    }
  }

  function render(buffer: OptimizedBuffer, region: Region) {
    const src = region.buf
    if (src.width <= 0 || src.height <= 0) return

    const cols = region.cols
    const rows = region.rows
    const cells = cols * rows
    if (cells <= 0) return

    // Detect cell dimensions from source buffer / region cell count
    const cw = Math.max(1, Math.round(src.width / cols))
    const ch = Math.max(1, Math.round(src.height / rows))

    // Rasterize: area-average quadrants → packed cell results
    const buf = rasterize(src, cols, rows, cw, ch)
    const bytes = new Uint8Array(buf)

    // Reallocate packed buffer if size changed
    if (cells !== curCells || !packed) {
      curCells = cells
      packed = bytes
    } else {
      packed.set(bytes)
    }

    try {
      buffer.drawPackedBuffer(ptr(packed), packed.length, region.col, region.row, cols, rows)
    } catch {
      // silent
    }

    // Write text labels AFTER packed buffer so they are not overwritten
    if (region.labels) {
      const bg = RGBA.fromInts(VR, VG, VB, 0)
      for (const lbl of region.labels) {
        const [r, g, b, a] = [(lbl.fg >>> 24) & 0xff, (lbl.fg >>> 16) & 0xff, (lbl.fg >>> 8) & 0xff, lbl.fg & 0xff]
        const fg = RGBA.fromInts(r, g, b, a)
        buffer.drawText(lbl.content, region.col + lbl.col, region.row + lbl.row, fg, bg)
      }
    }
  }

  return {
    submit(region) {
      const idx = regions.findIndex((r) => r.key === region.key)
      if (idx >= 0) regions[idx] = region
      else regions.push(region)
    },
    clear() {
      regions.length = 0
    },
    process,
    paint(buffer: OptimizedBuffer, region: Region) {
      render(buffer, region)
    },
    destroy() {
      regions.length = 0
      packed = null
    },
  }
}
