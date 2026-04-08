import { describe, expect, test } from "bun:test"
import { EmbeddingCache } from "../../src/memory/embedding-cache"

describe("EmbeddingCache", () => {
  test("evicts the oldest entry after 1000 items", async () => {
    EmbeddingCache.clear()

    for (const i of Array.from({ length: 1001 }, (_, i) => i)) {
      await EmbeddingCache.set(`k-${i}`, [i])
    }

    expect(await EmbeddingCache.get("k-0")).toBeUndefined()
    expect(await EmbeddingCache.get("k-1000")).toEqual([1000])
  })

  test("setting the same key updates the cached embedding", async () => {
    EmbeddingCache.clear()

    await EmbeddingCache.set("dup", [1])
    await EmbeddingCache.set("dup", [2])

    expect(await EmbeddingCache.get("dup")).toEqual([2])
  })
})
