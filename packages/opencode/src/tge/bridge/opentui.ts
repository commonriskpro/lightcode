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

// Half-block characters
const HALF_TOP = 0x2580 // ▀ — fg=top, bg=bottom
const HALF_BOT = 0x2584 // ▄ — fg=bottom, bg=top
const FULL = 0x2588 // █ — fg fills cell
const SPACE = 0x20 // ' ' — bg fills cell

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

type RGB = [number, number, number]

/** Squared color distance (perceptual weighting). */
function dist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2]
  return dr * dr * 2 + dg * dg * 4 + db * db * 3
}

/** Luminance (0-255). */
function lum(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Write a float32 to a DataView. */
function f32(dv: DataView, off: number, v: number) {
  dv.setFloat32(off, v, true)
}

/** Compute reconstruction error: how well does (fg, bg, char) represent the source pixels? */
function quadError(quads: RGB[], fg: RGB, bg: RGB, bits: number): number {
  const bv = [8, 4, 2, 1]
  let err = 0
  for (let i = 0; i < 4; i++) {
    const repr = bits & bv[i] ? fg : bg
    err += dist(quads[i], repr)
  }
  return err
}

function halfError(top: RGB, bot: RGB, ft: RGB, fb: RGB): number {
  return dist(top, ft) + dist(bot, fb)
}

/** Pack a cell result into the DataView at offset. */
function pack(dv: DataView, off: number, fg: RGB, bg: RGB, ch: number) {
  f32(dv, off, bg[0] / 255)
  f32(dv, off + 4, bg[1] / 255)
  f32(dv, off + 8, bg[2] / 255)
  f32(dv, off + 12, 1.0)
  f32(dv, off + 16, fg[0] / 255)
  f32(dv, off + 20, fg[1] / 255)
  f32(dv, off + 24, fg[2] / 255)
  f32(dv, off + 28, 1.0)
  dv.setUint32(off + 32, ch, true)
}

/**
 * Hybrid rasterizer: for each cell, tries BOTH quadrant blocks and half blocks,
 * picks whichever produces lower reconstruction error.
 *
 * Quadrant: 2×2 spatial resolution, 2 colors — good for edges and structure.
 * Halfblock: 1×2 spatial resolution, 2 independent colors — good for gradients.
 *
 * The key insight: halfblock assigns each color to EXACTLY the pixels it represents
 * (top half or bottom half), so gradients render smoothly. Quadrant forces all pixels
 * into 2 bins based on proximity to extremes, which loses intermediate tones.
 */
function rasterize(src: PixelBuffer, cols: number, rows: number, cw: number, ch: number): ArrayBuffer {
  const cells = cols * rows
  const buf = new ArrayBuffer(cells * 48)
  const dv = new DataView(buf)
  const sd = src.data
  const ss = src.stride
  const hw = (cw / 2) | 0
  const hh = (ch / 2) | 0

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const sx = cx * cw
      const sy = cy * ch
      const mx = sx + hw
      const my = sy + hh
      const off = (cy * cols + cx) * 48

      // ── Quadrant candidate ──
      // Area-average 4 quadrants
      const tl = avg(sd, ss, sx, sy, mx, my, src.width, src.height)
      const tr = avg(sd, ss, mx, sy, sx + cw, my, src.width, src.height)
      const bl = avg(sd, ss, sx, my, mx, sy + ch, src.width, src.height)
      const br = avg(sd, ss, mx, my, sx + cw, sy + ch, src.width, src.height)
      const quads: RGB[] = [tl, tr, bl, br]

      // Find 2 most different colors
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

      let qDark = quads[ai],
        qLight = quads[bi]
      if (lum(qDark) > lum(qLight)) {
        const t = qDark
        qDark = qLight
        qLight = t
      }

      // Classify quadrants → bits
      let bits = 0
      const bv = [8, 4, 2, 1]
      for (let i = 0; i < 4; i++) {
        if (dist(quads[i], qDark) <= dist(quads[i], qLight)) bits |= bv[i]
      }

      let qFg: RGB, qBg: RGB, qCh: number
      if (bits === 0) {
        const a = avg(sd, ss, sx, sy, sx + cw, sy + ch, src.width, src.height)
        qFg = qDark
        qBg = a
        qCh = SPACE
      } else if (bits === 15) {
        const a = avg(sd, ss, sx, sy, sx + cw, sy + ch, src.width, src.height)
        qFg = a
        qBg = qLight
        qCh = QCHARS[15]
      } else {
        qFg = qDark
        qBg = qLight
        qCh = QCHARS[bits]
      }
      const qErr = quadError(quads, qFg, qBg, bits)

      // ── Halfblock candidate ──
      // Area-average top half and bottom half of cell
      const top = avg(sd, ss, sx, sy, sx + cw, my, src.width, src.height)
      const bot = avg(sd, ss, sx, my, sx + cw, sy + ch, src.width, src.height)

      // ▀ (HALF_TOP): fg=top, bg=bottom
      const hErr = halfError(top, bot, top, bot)

      // ── Pick winner ──
      // Halfblock gets a small bonus because it produces smoother gradients
      // even when the error metric is similar
      if (hErr <= qErr) {
        // Use ▀ — fg=top color, bg=bottom color
        pack(dv, off, top, bot, HALF_TOP)
      } else {
        pack(dv, off, qFg, qBg, qCh)
      }
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
