/**
 * Hybrid recall backend.
 *
 * Composes `FTS5Backend` with an optional `EmbeddingBackend`.
 * Search results are merged with Reciprocal Rank Fusion using `k=60`.
 *
 * When `EmbeddingBackend` is `null`, this behaves like a pure FTS5 backend.
 * Indexing is delegated to the embedding backend when available, otherwise to
 * `FTS5Backend` directly.
 */

import type { MemoryArtifact, ScopeRef, RecallBackend } from "./contracts"
import type { FTS5Backend } from "./fts5-backend"
import type { EmbeddingBackend } from "./embedding-backend"

const RRF_K = 60

export class HybridBackend implements RecallBackend {
  private fts5: FTS5Backend
  private embedding: EmbeddingBackend | null

  constructor(fts5: FTS5Backend, embedding: EmbeddingBackend | null) {
    this.fts5 = fts5
    this.embedding = embedding
  }

  async index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): Promise<string> {
    if (this.embedding) return this.embedding.index(artifact)
    return this.fts5.index(artifact)
  }

  async search(query: string, scopes: ScopeRef[], limit: number): Promise<MemoryArtifact[]> {
    if (!this.embedding) return this.fts5.search(query, scopes, limit)

    const [ftsResults, vecResults] = await Promise.all([
      this.fts5.search(query, scopes, limit),
      this.embedding.search(query, scopes, limit),
    ])

    return rrf(ftsResults, vecResults, limit)
  }

  async remove(id: string): Promise<void> {
    if (this.embedding) {
      // EmbeddingBackend.remove handles both vec deletion and FTS5 soft-delete
      await this.embedding.remove(id)
      return
    }
    await this.fts5.remove(id)
  }
}

/**
 * Reciprocal Rank Fusion (RRF) merge.
 *
 * Score for each result = sum of 1/(k + rank) across all lists.
 * Results appearing in multiple lists accumulate higher scores.
 * Deduplicates by artifact id. Returns top `limit` by score descending.
 */
function rrf(a: MemoryArtifact[], b: MemoryArtifact[], limit: number): MemoryArtifact[] {
  const scores = new Map<string, number>()
  const byId = new Map<string, MemoryArtifact>()

  for (const list of [a, b]) {
    for (let i = 0; i < list.length; i++) {
      const art = list[i]
      const score = 1 / (RRF_K + i)
      scores.set(art.id, (scores.get(art.id) ?? 0) + score)
      if (!byId.has(art.id)) byId.set(art.id, art)
    }
  }

  return [...scores.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id)!)
}
