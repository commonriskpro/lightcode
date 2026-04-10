/**
 * opentui pixel bridge — composites TGE PixelBuffers into opentui's render pipeline.
 *
 * drawSuperSampleBuffer:
 *   - Expects stride aligned to 256 bytes
 *   - Paints ALL cells in the buffer (no alpha skip)
 *   - (x, y) is the destination cell position in the terminal
 *
 * Strategy: build a region-sized buffer with 256-byte aligned stride,
 * filled with void black. Paint TGE pixels on top (alpha-blended).
 * Call drawSuperSampleBuffer at the region's cell position.
 * Void black background matches opentui's bg, so non-graphical cells
 * look identical to unpainted cells.
 *
 * Text labels are written AFTER the supersample call via drawText,
 * so they are not overwritten by pixel data.
 */

import type { PixelBuffer } from "../paint/buffer"
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
  /** Render a single region directly — for use in renderAfter callbacks. */
  paint(buffer: OptimizedBuffer, region: Region): void
  destroy(): void
}

// Void black RGBA bytes
const VR = 0x04
const VG = 0x04
const VB = 0x0a

export function bridge(cellW: number, cellH: number, _mode: "supersample" | "halfblock" = "supersample"): Bridge {
  const regions: Region[] = []

  const process = (buffer: OptimizedBuffer, _delta: number) => {
    if (regions.length === 0) return
    // Clear any scissor rects left from opentui's component render pass.
    // Without this, drawSuperSampleBuffer may be clipped to the last
    // rendered component's bounds and produce invisible output.
    buffer.clearScissorRects()
    for (const r of regions) {
      render(buffer, r, cellW, cellH)
    }
  }

  function render(buffer: OptimizedBuffer, region: Region, cw: number, ch: number) {
    const buf = region.buf
    if (buf.width <= 0 || buf.height <= 0) return

    const d = buf.data
    const cols = region.cols
    const rows = region.rows
    const voidBg = RGBA.fromInts(VR, VG, VB, 255)

    // Manual supersample: average each cellW×cellH pixel block → one terminal cell.
    // Uses setCellWithAlphaBlending which works reliably in postProcessFn
    // (unlike drawSuperSampleBuffer which gets overwritten by opentui's render pass).
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        // Average the pixel block for this cell
        let tr = 0,
          tg = 0,
          tb = 0,
          cnt = 0
        const x0 = cx * cw
        const y0 = cy * ch
        const x1 = Math.min(x0 + cw, buf.width)
        const y1 = Math.min(y0 + ch, buf.height)
        for (let py = y0; py < y1; py++) {
          const row = py * buf.stride
          for (let px = x0; px < x1; px++) {
            const i = row + px * 4
            const a = d[i + 3]
            if (a === 0) {
              tr += VR
              tg += VG
              tb += VB
            } else if (a === 0xff) {
              tr += d[i]
              tg += d[i + 1]
              tb += d[i + 2]
            } else {
              const inv = 255 - a
              tr += (d[i] * a + VR * inv) / 255
              tg += (d[i + 1] * a + VG * inv) / 255
              tb += (d[i + 2] * a + VB * inv) / 255
            }
            cnt++
          }
        }
        if (cnt === 0) continue
        const ar = Math.round(tr / cnt)
        const ag = Math.round(tg / cnt)
        const ab = Math.round(tb / cnt)

        // Skip if indistinguishable from void black
        if (Math.abs(ar - VR) < 2 && Math.abs(ag - VG) < 2 && Math.abs(ab - VB) < 2) continue

        const bg = RGBA.fromInts(ar, ag, ab, 255)
        buffer.setCell(region.col + cx, region.row + cy, " ", voidBg, bg)
      }
    }

    // Write text labels on top
    if (region.labels) {
      const lblBg = RGBA.fromInts(VR, VG, VB, 0)
      for (const lbl of region.labels) {
        const [r, g, b, a] = [(lbl.fg >>> 24) & 0xff, (lbl.fg >>> 16) & 0xff, (lbl.fg >>> 8) & 0xff, lbl.fg & 0xff]
        const fg = RGBA.fromInts(r, g, b, a)
        buffer.drawText(lbl.content, region.col + lbl.col, region.row + lbl.row, fg, lblBg)
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
      render(buffer, region, cellW, cellH)
    },
    destroy() {
      regions.length = 0
    },
  }
}
