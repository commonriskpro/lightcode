/**
 * opentui pixel bridge — composites TGE PixelBuffers into opentui's render pipeline.
 *
 * drawSuperSampleBuffer expects 2×2 pixels per terminal cell (quadrant blocks).
 * The TGE paint system renders at 8x scale (8 pixels per cell dimension) for
 * high-quality anti-aliasing. The bridge downsamples 4:1 (8x → 2x) by averaging
 * 4×4 pixel blocks, then copies to a 256-byte aligned buffer for drawSuperSampleBuffer.
 *
 * The 4:1 downsample pre-blends gradients so renderQuadrantBlock (which only picks
 * 2 colors per cell) receives clean, pre-mixed pixels — eliminating 3-color artifacts.
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

/**
 * Area-sample downsample: resizes a high-res PixelBuffer to dstW×dstH.
 *
 * Supports non-integer scale ratios (e.g. screen-pixel buffer to 2x cells
 * where cellW ≠ cellH). Each destination pixel averages ALL source pixels
 * in its corresponding rectangular area, with alpha-compositing onto void black.
 *
 * This is the key to aspect-correct rendering: the TGE renders in screen-pixel
 * coordinates (square pixels, circles are circular), then this downsamples
 * to the 2x buffer that drawSuperSampleBuffer expects.
 */
function downsample(src: PixelBuffer, dstW: number, dstH: number): PixelBuffer {
  const out = new Uint8Array(dstW * dstH * 4)
  const sd = src.data
  const ss = src.stride
  // Scale factors: how many source pixels per destination pixel
  const sx = src.width / dstW
  const sy = src.height / dstH

  for (let dy = 0; dy < dstH; dy++) {
    const srcY0 = (dy * sy) | 0
    const srcY1 = Math.min(((dy + 1) * sy) | 0, src.height)
    const dr = dy * dstW * 4
    for (let dx = 0; dx < dstW; dx++) {
      const srcX0 = (dx * sx) | 0
      const srcX1 = Math.min(((dx + 1) * sx) | 0, src.width)
      let tr = 0,
        tg = 0,
        tb = 0
      let cnt = 0

      for (let py = srcY0; py < srcY1; py++) {
        const row = py * ss
        for (let px = srcX0; px < srcX1; px++) {
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

      const di = dr + dx * 4
      if (cnt > 0) {
        out[di] = (tr / cnt + 0.5) | 0
        out[di + 1] = (tg / cnt + 0.5) | 0
        out[di + 2] = (tb / cnt + 0.5) | 0
        out[di + 3] = 0xff
      } else {
        out[di] = VR
        out[di + 1] = VG
        out[di + 2] = VB
        out[di + 3] = 0xff
      }
    }
  }

  return { data: out, width: dstW, height: dstH, stride: dstW * 4 }
}

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
    const src = region.buf
    if (src.width <= 0 || src.height <= 0) return

    // Output size for drawSuperSampleBuffer: 2 pixels per cell
    const pw = region.cols * 2
    const ph = region.rows * 2

    // Reallocate aligned buffer if size changed
    if (pw !== curW || ph !== curH || !aligned) {
      curW = pw
      curH = ph
      stride = Math.ceil((pw * 4) / 256) * 256
      aligned = new Uint8Array(stride * ph)
    }

    // Downsample 8x → 2x (4:1 block average, composited onto void black).
    // The downsample produces opaque pixels for the full pw×ph area —
    // pixels outside the source buffer become void black automatically.
    // No separate void-black fill needed.
    const ds = downsample(src, pw, ph)

    // Copy downsampled pixels into stride-aligned buffer
    const dd = ds.data
    for (let y = 0; y < ph; y++) {
      const sr = y * pw * 4
      const dr = y * stride
      // Copy pixel data
      aligned.set(dd.subarray(sr, sr + pw * 4), dr)
      // Zero stride padding bytes (required for drawSuperSampleBuffer)
      for (let x = pw * 4; x < stride; x++) {
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
      render(buffer, region)
    },
    destroy() {
      regions.length = 0
      aligned = null
    },
  }
}
