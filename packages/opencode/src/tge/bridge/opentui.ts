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
 */

import type { PixelBuffer } from "../paint/buffer"
import { ptr } from "bun:ffi"
import { type OptimizedBuffer } from "@opentui/core"

export type Region = {
  col: number
  row: number
  cols: number
  rows: number
  buf: PixelBuffer
  key: string
}

export type Bridge = {
  submit(region: Region): void
  clear(): void
  process: (buffer: OptimizedBuffer, delta: number) => void
  destroy(): void
}

// Void black RGBA bytes
const VR = 0x04
const VG = 0x04
const VB = 0x0a

export function bridge(cellW: number, cellH: number, _mode: "supersample" | "halfblock" = "supersample"): Bridge {
  const regions: Region[] = []
  let aligned: Uint8Array | null = null
  let curW = 0
  let curH = 0
  let stride = 0

  const process = (buffer: OptimizedBuffer, _delta: number) => {
    for (const r of regions) {
      render(buffer, r, cellW, cellH)
    }
  }

  function render(buffer: OptimizedBuffer, region: Region, cw: number, ch: number) {
    const buf = region.buf
    if (buf.width <= 0 || buf.height <= 0) return

    const pw = region.cols * cw
    const ph = region.rows * ch

    // Reallocate aligned buffer if size changed
    if (pw !== curW || ph !== curH || !aligned) {
      curW = pw
      curH = ph
      stride = Math.ceil((pw * 4) / 256) * 256
      aligned = new Uint8Array(stride * ph)
    }

    // Fill with void black (opaque)
    for (let y = 0; y < ph; y++) {
      const row = y * stride
      for (let x = 0; x < pw; x++) {
        const i = row + x * 4
        aligned[i] = VR
        aligned[i + 1] = VG
        aligned[i + 2] = VB
        aligned[i + 3] = 0xff
      }
      // Zero padding bytes
      for (let x = pw * 4; x < stride; x++) {
        aligned[row + x] = 0
      }
    }

    // Blit TGE pixels on top, alpha-blended onto void black
    const d = buf.data
    const maxX = Math.min(buf.width, pw)
    const maxY = Math.min(buf.height, ph)
    for (let y = 0; y < maxY; y++) {
      const sr = y * buf.stride
      const dr = y * stride
      for (let x = 0; x < maxX; x++) {
        const si = sr + x * 4
        const a = d[si + 3]
        if (a === 0) continue
        const di = dr + x * 4
        if (a === 0xff) {
          aligned[di] = d[si]
          aligned[di + 1] = d[si + 1]
          aligned[di + 2] = d[si + 2]
          aligned[di + 3] = 0xff
        } else {
          const inv = 255 - a
          aligned[di] = (d[si] * a + VR * inv + 127) / 255
          aligned[di + 1] = (d[si + 1] * a + VG * inv + 127) / 255
          aligned[di + 2] = (d[si + 2] * a + VB * inv + 127) / 255
          aligned[di + 3] = 0xff
        }
      }
    }

    try {
      buffer.drawSuperSampleBuffer(region.col, region.row, ptr(aligned), aligned.length, "rgba8unorm", stride)
    } catch {
      // silent
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
    destroy() {
      regions.length = 0
      aligned = null
    },
  }
}
