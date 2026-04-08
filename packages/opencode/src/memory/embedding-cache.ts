/**
 * Shared embedding cache.
 *
 * - LRU cache with a maximum of 1000 entries.
 * - Keys are xxhash32 values derived from the source content string.
 * - Shared across all embedding consumers; `Embedder` wraps it transparently.
 *
 * The xxhash wasm runtime is initialized lazily on first use.
 */

import { LRUCache } from "lru-cache"
import xxhash, { type XXHashAPI } from "xxhash-wasm"

const cache = new LRUCache<string, number[]>({ max: 1000 })

let hasher: XXHashAPI | null = null

async function getHasher(): Promise<XXHashAPI> {
  if (hasher) return hasher
  hasher = await xxhash()
  return hasher
}

export namespace EmbeddingCache {
  export async function key(content: string): Promise<string> {
    const h = await getHasher()
    return String(h.h32(content))
  }

  export async function get(content: string): Promise<number[] | undefined> {
    const k = await key(content)
    return cache.get(k)
  }

  export async function set(content: string, embedding: number[]): Promise<void> {
    const k = await key(content)
    cache.set(k, embedding)
  }

  export function clear(): void {
    cache.clear()
  }
}
