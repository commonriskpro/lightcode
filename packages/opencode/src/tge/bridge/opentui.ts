/**
 * opentui pixel bridge — composites TGE PixelBuffers into opentui's render pipeline.
 *
 * drawSuperSampleBuffer expects 2×2 pixels per terminal cell (quadrant blocks).
 * For a region of W×H cells, the pixel buffer must be (W*2)×(H*2) pixels.
 * Stride must be aligned to 256 bytes.
 *
 * The TGE paint system renders at arbitrary pixel resolution, so this bridge
 * downsamples from the high-res TGE buffer to the 2x quadrant buffer before
 * calling drawSuperSampleBuffer.
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

    // drawSuperSampleBuffer expects 2×2 pixels per cell (quadrant blocks)
    const qw = region.cols * 2
    const qh = region.rows * 2

    // Reallocate aligned buffer if size changed
    if (qw !== curW || qh !== curH || !aligned) {
      curW = qw
      curH = qh
      stride = Math.ceil((qw * 4) / 256) * 256
      aligned = new Uint8Array(stride * qh)
    }

    // Downsample: TGE buffer (cols*cellW × rows*cellH) → quadrant buffer (cols*2 × rows*2)
    // Each quadrant pixel averages a block of (cellW/2 × cellH/2) TGE pixels
    const bw = cw / 2 // TGE pixels per quadrant pixel, horizontal
    const bh = ch / 2 // TGE pixels per quadrant pixel, vertical
    const d = buf.data

    for (let qy = 0; qy < qh; qy++) {
      const dr = qy * stride
      for (let qx = 0; qx < qw; qx++) {
        // Source pixel region in TGE buffer
        const sx0 = Math.floor(qx * bw)
        const sy0 = Math.floor(qy * bh)
        const sx1 = Math.min(Math.floor((qx + 1) * bw), buf.width)
        const sy1 = Math.min(Math.floor((qy + 1) * bh), buf.height)

        let tr = 0,
          tg = 0,
          tb = 0,
          cnt = 0
        for (let py = sy0; py < sy1; py++) {
          const sr = py * buf.stride
          for (let px = sx0; px < sx1; px++) {
            const si = sr + px * 4
            const a = d[si + 3]
            if (a === 0) {
              tr += VR
              tg += VG
              tb += VB
            } else if (a === 0xff) {
              tr += d[si]
              tg += d[si + 1]
              tb += d[si + 2]
            } else {
              const inv = 255 - a
              tr += (d[si] * a + VR * inv) / 255
              tg += (d[si + 1] * a + VG * inv) / 255
              tb += (d[si + 2] * a + VB * inv) / 255
            }
            cnt++
          }
        }

        const di = dr + qx * 4
        if (cnt === 0) {
          aligned[di] = VR
          aligned[di + 1] = VG
          aligned[di + 2] = VB
          aligned[di + 3] = 0xff
        } else {
          aligned[di] = Math.round(tr / cnt)
          aligned[di + 1] = Math.round(tg / cnt)
          aligned[di + 2] = Math.round(tb / cnt)
          aligned[di + 3] = 0xff
        }
      }
      // Zero padding bytes
      for (let x = qw * 4; x < stride; x++) {
        aligned[dr + x] = 0
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
      render(buffer, region, cellW, cellH)
    },
    destroy() {
      regions.length = 0
      aligned = null
    },
  }
}
