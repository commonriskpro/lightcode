import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Embedder } from "../../src/memory/embedder"
import { EmbeddingCache } from "../../src/memory/embedding-cache"

const fast = {
  calls: [] as Array<Record<string, unknown>>,
  err: undefined as Error | undefined,
}

const remote = {
  calls: [] as Array<Record<string, unknown>>,
  models: [] as string[],
}

mock.module("fastembed", () => ({
  EmbeddingModel: {
    BGESmallENV15: "BGESmallENV15",
    BGEBaseENV15: "BGEBaseENV15",
    BGESmallEN: "BGESmallEN",
    BGEBaseEN: "BGEBaseEN",
    AllMiniLML6V2: "AllMiniLML6V2",
    CUSTOM: "CUSTOM",
  },
  FlagEmbedding: {
    init: async (opts: Record<string, unknown>) => {
      fast.calls.push(opts)
      if (fast.err) throw fast.err
      return {
        async *embed(texts: string[]) {
          yield texts.map(() => [0.1, 0.2, 0.3])
        },
      }
    },
  },
}))

mock.module("ai", () => ({
  embedMany: async (opts: Record<string, unknown>) => {
    remote.calls.push(opts)
    const vals = opts.values as string[]
    return { embeddings: vals.map(() => [0.4, 0.5, 0.6]) }
  },
}))

mock.module("@ai-sdk/openai", () => ({
  openai: {
    embedding: (model: string) => {
      remote.models.push(model)
      return { provider: "openai", model }
    },
  },
}))

describe("Embedder", () => {
  beforeEach(() => {
    Embedder.reset()
    EmbeddingCache.clear()
    fast.calls = []
    fast.err = undefined
    remote.calls = []
    remote.models = []
  })

  test("without config defaults to fastembed", async () => {
    const get = spyOn(Config, "get").mockResolvedValue({})

    const embedder = await Embedder.get()

    expect(embedder).not.toBeNull()
    expect(fast.calls).toHaveLength(1)
    expect(fast.calls[0]?.model).toBe("BGESmallENV15")
    expect(String(fast.calls[0]?.cacheDir)).toContain("fastembed-models")
    get.mockRestore()
  })

  test("fastembed download failure degrades to null", async () => {
    const get = spyOn(Config, "get").mockResolvedValue({})
    fast.err = new Error("download failed")

    expect(await Embedder.get()).toBeNull()
    get.mockRestore()
  })

  test("remote config uses the configured provider", async () => {
    const get = spyOn(Config, "get").mockResolvedValue({
      experimental: { memory: { embedder: "openai/text-embedding-3-small" } },
    })

    const embedder = await Embedder.get()
    const vals = await embedder?.embed(["hello world"])

    expect(embedder?.dim).toBe(1536)
    expect(remote.models).toEqual(["text-embedding-3-small"])
    expect(remote.calls).toHaveLength(1)
    expect(vals).toEqual([[0.4, 0.5, 0.6]])
    get.mockRestore()
  })
})
