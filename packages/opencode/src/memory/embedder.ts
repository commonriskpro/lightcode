/**
 * Process-wide embedder factory.
 *
 * - Default embedder: `fastembed/bge-small-en-v1.5` with fixed 384 dimensions.
 * - Override with `experimental.memory.embedder` in global config.
 * - Supported formats: `fastembed/<model>`, `openai/<model>`, `google/<model>`.
 * - Returns `null` when no embedder can be initialized; callers MUST handle the
 *   FTS5-only fallback path.
 * - Singleton per process: the resolved backend is memoized until `reset()`.
 * - `EmbeddingCache` is applied transparently around the resolved backend.
 *
 * The active embedder dimension MUST stay aligned with the native libSQL vector
 * schema, which currently uses `F32_BLOB(384)` columns.
 */

import path from "path"
import { Global } from "../global"
import { Config } from "../config/config"
import { EmbeddingCache } from "./embedding-cache"
import type { EmbedderBackend } from "./contracts"

// Cached singleton — null means unavailable
let _embedder: EmbedderBackend | null | undefined = undefined

// Dimension per well-known fastembed models
const FASTEMBED_DIM: Record<string, number> = {
  "bge-small-en-v1.5": 384,
  "bge-base-en-v1.5": 768,
  "bge-large-en-v1.5": 1024,
  "all-minilm-l6-v2": 384,
}

const DEFAULT_FASTEMBED_MODEL = "bge-small-en-v1.5"
const DEFAULT_DIM = 384

async function initFastembed(model: string): Promise<EmbedderBackend | null> {
  const { FlagEmbedding, EmbeddingModel } = await import("fastembed")

  // Map config model name to fastembed EmbeddingModel enum
  const modelMap: Record<string, string> = {
    "bge-small-en-v1.5": EmbeddingModel.BGESmallENV15,
    "bge-base-en-v1.5": EmbeddingModel.BGEBaseENV15,
    "bge-small-en": EmbeddingModel.BGESmallEN,
    "bge-base-en": EmbeddingModel.BGEBaseEN,
    "all-minilm-l6-v2": EmbeddingModel.AllMiniLML6V2,
  }

  const embeddingModel = (modelMap[model] ?? EmbeddingModel.BGESmallENV15) as Exclude<
    (typeof EmbeddingModel)[keyof typeof EmbeddingModel],
    typeof EmbeddingModel.CUSTOM
  >
  const dim = FASTEMBED_DIM[model] ?? DEFAULT_DIM
  const cacheDir = path.join(Global.Path.cache, "fastembed-models")

  const fe = await FlagEmbedding.init({
    model: embeddingModel,
    cacheDir,
    showDownloadProgress: false,
  })

  const embed = async (texts: string[]): Promise<number[][]> => {
    const results: number[][] = []
    for await (const batch of fe.embed(texts)) {
      results.push(...batch)
    }
    return results
  }

  return { embed, dim }
}

async function initAISdk(provider: string, model: string): Promise<EmbedderBackend | null> {
  const { embedMany } = await import("ai")

  let sdkModel: Parameters<typeof embedMany>[0]["model"] | null = null

  if (provider === "openai") {
    const { openai } = await import("@ai-sdk/openai")
    sdkModel = openai.embedding(model as Parameters<typeof openai.embedding>[0])
  } else if (provider === "google") {
    const { google } = await import("@ai-sdk/google")
    sdkModel = google.embedding(model as Parameters<typeof google.embedding>[0])
  } else {
    console.warn(`[embedder] Unsupported provider: ${provider}. Use 'fastembed', 'openai', or 'google'.`)
    return null
  }

  const embed = async (texts: string[]): Promise<number[][]> => {
    const result = await embedMany({ model: sdkModel!, values: texts })
    return result.embeddings
  }

  // AI SDK models have variable dim; use 1536 as default for openai, 768 for google
  const dim = provider === "openai" ? 1536 : 768

  return { embed, dim }
}

async function buildEmbedder(): Promise<EmbedderBackend | null> {
  const cfg = await Config.get().catch(() => null)
  const spec = cfg?.experimental?.memory?.embedder ?? `fastembed/${DEFAULT_FASTEMBED_MODEL}`

  const slash = spec.indexOf("/")
  const provider = slash === -1 ? "fastembed" : spec.slice(0, slash)
  const model = slash === -1 ? spec : spec.slice(slash + 1)

  if (provider === "fastembed") {
    const backend = await initFastembed(model).catch((err) => {
      console.warn("[embedder] fastembed init failed — falling back to FTS5-only mode:", err?.message ?? err)
      return null
    })
    return backend
  }

  return initAISdk(provider, model).catch((err) => {
    console.warn(`[embedder] ${provider} init failed:`, err?.message ?? err)
    return null
  })
}

function withCache(backend: EmbedderBackend): EmbedderBackend {
  const embed = async (texts: string[]): Promise<number[][]> => {
    // Split into cached vs uncached
    const results: (number[] | undefined)[] = await Promise.all(texts.map((t) => EmbeddingCache.get(t)))
    const uncachedIdx = results.map((r, i) => (r === undefined ? i : -1)).filter((i) => i !== -1)

    if (uncachedIdx.length > 0) {
      const uncached = uncachedIdx.map((i) => texts[i])
      const fresh = await backend.embed(uncached)
      await Promise.all(uncachedIdx.map((idx, j) => EmbeddingCache.set(texts[idx], fresh[j])))
      for (let j = 0; j < uncachedIdx.length; j++) {
        results[uncachedIdx[j]] = fresh[j]
      }
    }

    return results as number[][] // all undefined slots have been filled above
  }

  return { embed, dim: backend.dim }
}

export namespace Embedder {
  /**
   * Get the singleton embedder instance.
   * Returns `null` if embedder init fails and callers must fall back to FTS5-only
   * recall/indexing.
   */
  export async function get(): Promise<EmbedderBackend | null> {
    if (_embedder !== undefined) return _embedder
    const backend = await buildEmbedder()
    _embedder = backend ? withCache(backend) : null
    return _embedder
  }

  /**
   * Reset the singleton (used in tests).
   */
  export function reset(): void {
    _embedder = undefined
  }
}
