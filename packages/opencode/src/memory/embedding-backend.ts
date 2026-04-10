/**
 * Async `RecallBackend` implementation backed by libSQL native vectors.
 *
 * - Stores vectors inline on `memory_artifacts.embedding` as `F32_BLOB(384)`.
 * - Delegates metadata persistence to `FTS5Backend` so lexical and vector stores
 *   stay in sync.
 * - Probes the native vector column during construction and degrades to no-op /
 *   empty-result behavior when vector migrations are unavailable.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm"
import { Database } from "../storage/db"
import { MemoryArtifactTable } from "./schema.sql"
import type { MemoryArtifact, ScopeRef, RecallBackend, EmbedderBackend } from "./contracts"
import type { FTS5Backend } from "./fts5-backend"

export class EmbeddingBackend implements RecallBackend {
  private available: boolean | undefined
  private embedder: EmbedderBackend
  private fts5: FTS5Backend

  constructor(embedder: EmbedderBackend, fts5: FTS5Backend) {
    this.embedder = embedder
    this.fts5 = fts5
    this.available = undefined
  }

  private async _probe(): Promise<boolean> {
    try {
      await Database.use((db) => db.run(sql`SELECT embedding FROM memory_artifacts LIMIT 0`))
      return true
    } catch {
      return false
    }
  }

  private async isAvailable(): Promise<boolean> {
    if (typeof this.available === "boolean") return this.available
    this.available = await this._probe()
    return this.available
  }

  /**
   * Index an artifact:
   * 1. Delegate metadata persistence to FTS5Backend (returns artifact id)
   * 2. Embed the content
   * 3. Persist the vector on `memory_artifacts.embedding`
   */
  async index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): Promise<string> {
    const id = await this.fts5.index(artifact)

    if (!(await this.isAvailable())) return id

    const vecs = await this.embedder.embed([artifact.content])
    const vec = vecs[0]
    if (!vec) return id

    const emb = new Float32Array(vec)
    await Database.write((db) =>
      db.update(MemoryArtifactTable).set({ embedding: emb }).where(eq(MemoryArtifactTable.id, id)).run(),
    )

    return id
  }

  /**
   * Search by embedding similarity:
   * 1. Embed the query
   * 2. Run a single native vector query against `memory_artifacts`
   * 3. Return top `limit` rows already filtered by scope
   */
  async search(query: string, scopes: ScopeRef[], limit: number): Promise<MemoryArtifact[]> {
    if (!(await this.isAvailable()) || !scopes.length || !query.trim()) return []

    const vecs = await this.embedder.embed([query])
    const vec = vecs[0]
    if (!vec) return []

    const txt = JSON.stringify(Array.from(vec))
    const scope = sql.join(
      scopes.map((item) => sql`(scope_type = ${item.type} AND scope_id = ${item.id})`),
      sql` OR `,
    )

    type Row = MemoryArtifact & { dist: number }
    let vecRows: Row[]
    try {
      vecRows = (await Database.use((db) =>
        db.all(sql`
          SELECT
            id,
            scope_type,
            scope_id,
            type,
            title,
            content,
            topic_key,
            normalized_hash,
            revision_count,
            duplicate_count,
            last_seen_at,
            deleted_at,
            time_created,
            time_updated,
            vector_distance_cos(embedding, vector32(${txt})) AS dist
          FROM memory_artifacts
          WHERE embedding IS NOT NULL
            AND deleted_at IS NULL
            AND (${scope})
          ORDER BY dist ASC
          LIMIT ${limit}
        `),
      )) as unknown as Row[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("no such column")) {
        console.warn("[memory] embedding search error:", msg)
      }
      return []
    }

    return vecRows
  }

  /**
   * Remove an artifact:
   * 1. Soft-delete metadata via FTS5Backend
   * 2. Clear the inline embedding
   */
  async remove(id: string): Promise<void> {
    await this.fts5.remove(id)

    if (!(await this.isAvailable())) return

    await Database.write((db) =>
      db.update(MemoryArtifactTable).set({ embedding: null }).where(eq(MemoryArtifactTable.id, id)).run(),
    )
  }
}
