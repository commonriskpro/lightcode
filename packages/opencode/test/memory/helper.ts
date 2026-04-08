import { createHash } from "crypto"
import type { EmbedderBackend } from "../../src/memory/contracts"

export function mock(): EmbedderBackend {
  const embed = async (texts: string[]) => texts.map(vec)
  return { dim: 384, embed }
}

export function long(seed: string, n = 80): string {
  return Array.from({ length: n }, (_, i) => `${seed} ${i}`).join(" ")
}

function vec(text: string): number[] {
  const out = Array.from({ length: 384 }, () => 0)
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean)
  const parts = words.length ? words : [text]

  for (const part of parts) {
    const buf = createHash("sha256").update(part).digest()
    for (let i = 0; i < buf.length; i += 2) {
      const idx = ((buf[i] ?? 0) + i) % 384
      const sign = ((buf[i + 1] ?? 0) & 1) === 0 ? 1 : -1
      out[idx] += sign * (((buf[i + 1] ?? 0) % 23) + 1)
    }
  }

  const mag = Math.hypot(...out) || 1
  return out.map((x) => x / mag)
}
