/**
 * Kitty graphics protocol image transmission.
 *
 * Handles chunked base64 encoding and transmission of pixel buffers
 * to the terminal. Supports tmux passthrough mode.
 */

import type { PixelBuffer } from "../../paint"
import { writer } from "./passthrough"

const CHUNK_SIZE = 4096

/** Transmit a pixel buffer as a Kitty graphics image. */
export function transmit(
  stdout: NodeJS.WriteStream,
  buf: PixelBuffer,
  id: number,
  opts?: { x?: number; y?: number; action?: "t" | "T" | "p"; format?: 24 | 32 | 100 },
) {
  const action = opts?.action ?? "T"
  const format = opts?.format ?? 32
  const data = format === 32 ? buf.data : stripAlpha(buf.data, buf.width * buf.height)
  const write = writer(stdout)

  const b64 = encode(data)
  const chunks = chunk(b64)

  if (chunks.length === 0) return

  // First chunk includes metadata
  const meta = `a=${action},f=${format},i=${id},s=${buf.width},v=${buf.height}`
  if (chunks.length === 1) {
    write(`\x1b_G${meta};${chunks[0]}\x1b\\`)
    return
  }

  write(`\x1b_G${meta},m=1;${chunks[0]}\x1b\\`)
  for (let i = 1; i < chunks.length - 1; i++) {
    write(`\x1b_Gm=1;${chunks[i]}\x1b\\`)
  }
  write(`\x1b_Gm=0;${chunks[chunks.length - 1]}\x1b\\`)
}

/** Place an already-transmitted image at a cell position. */
export function place(
  stdout: NodeJS.WriteStream,
  id: number,
  opts?: { col?: number; row?: number; pid?: number; width?: number; height?: number },
) {
  const write = writer(stdout)
  const parts = [`a=p`, `i=${id}`]
  if (opts?.pid) parts.push(`p=${opts.pid}`)
  if (opts?.col !== undefined) parts.push(`c=${opts.col}`)
  if (opts?.row !== undefined) parts.push(`r=${opts.row}`)
  write(`\x1b_G${parts.join(",")};AAAA\x1b\\`)
}

/** Delete an image by id. */
export function remove(stdout: NodeJS.WriteStream, id: number) {
  writer(stdout)(`\x1b_Ga=d,d=i,i=${id};\x1b\\`)
}

/** Delete all images. */
export function clear(stdout: NodeJS.WriteStream) {
  writer(stdout)(`\x1b_Ga=d,d=a;\x1b\\`)
}

// ─── Helpers ──────────────────────────────────────────────────────────

function stripAlpha(data: Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    out[i * 3] = data[i * 4]
    out[i * 3 + 1] = data[i * 4 + 1]
    out[i * 3 + 2] = data[i * 4 + 2]
  }
  return out
}

function encode(data: Uint8Array): string {
  return Buffer.from(data).toString("base64")
}

function chunk(str: string): string[] {
  const result: string[] = []
  for (let i = 0; i < str.length; i += CHUNK_SIZE) {
    result.push(str.slice(i, i + CHUNK_SIZE))
  }
  return result
}
