/**
 * opentui pixel bridge — composites TGE PixelBuffers into opentui's render pipeline.
 *
 * drawSuperSampleBuffer expects 2×2 pixels per terminal cell (quadrant blocks).
 * The TGE paint system renders directly at 2x scale, so the bridge simply
 * copies the pixel buffer to a 256-byte aligned buffer and calls
 * drawSuperSampleBuffer. No downsampling needed.
 *
 * Text labels are written AFTER the supersample call via drawText.
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

export function bridge(_cellW: number, _cellH: number, _mode: "supersample" | "halfblock" = "supersample"): Bridge {
  const regions: Region[] = []
  let aligned: Uint8Array | null = null
  let curW = 0
  let curH = 0
  let stride = 0

  const process = (buffer: OptimizedBuffer, _delta: number) => {
    for (const r of regions) {
      render(buffer, r)
    }
  }

  function render(buffer: OptimizedBuffer, region: Region) {
    const buf = region.buf
    if (buf.width <= 0 || buf.height <= 0) return

    // drawSuperSampleBuffer iterates from posX/posY to terminal width/height,
    // so the aligned buffer must cover the FULL remaining terminal area at 2x.
    // The TGE buf may be smaller (graph area only) — the rest stays void black.
    const pw = region.cols * 2
    const ph = region.rows * 2

    // Reallocate aligned buffer if size changed
    if (pw !== curW || ph !== curH || !aligned) {
      curW = pw
      curH = ph
      stride = Math.ceil((pw * 4) / 256) * 256
      aligned = new Uint8Array(stride * ph)
    }

    // Fill entire buffer with void black
    for (let y = 0; y < ph; y++) {
      const dr = y * stride
      for (let x = 0; x < pw; x++) {
        const di = dr + x * 4
        aligned[di] = VR
        aligned[di + 1] = VG
        aligned[di + 2] = VB
        aligned[di + 3] = 0xff
      }
      // Zero padding bytes
      for (let x = pw * 4; x < stride; x++) {
        aligned[dr + x] = 0
      }
    }

    // Blit TGE pixels into the top-left portion (graph area)
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

    // Write text labels AFTER supersample so they are not overwritten
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
      aligned = null
    },
  }
}
