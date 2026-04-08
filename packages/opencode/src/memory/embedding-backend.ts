/**
 * Async `RecallBackend` implementation backed by sqlite-vec.
 *
 * - Stores vectors in `memory_artifacts_vec`, a sqlite-vec virtual table with a
 *   fixed 384-dimension shape.
 * - Delegates metadata persistence to `FTS5Backend` so lexical and vector stores
 *   stay in sync.
 * - Probes vec-table availability during construction and degrades to no-op /
 *   empty-result behavior when sqlite-vec is unavailable.
 *
 * The vector dimension MUST match the migration's `FLOAT[384]` declaration.
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
      await Database.use((db) => db.run(sql`SELECT 1 FROM memory_artifacts_vec LIMIT 0`))
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
   * 3. Upsert the vector into memory_artifacts_vec
   */
  async index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): Promise<string> {
    const id = await this.fts5.index(artifact)

    if (!(await this.isAvailable())) return id

    const vecs = await this.embedder.embed([artifact.content])
    const vec = vecs[0]
    if (!vec) return id

    const buf = new Float32Array(vec).buffer
    await Database.use((db) =>
      db.run(sql`
        INSERT INTO memory_artifacts_vec (artifact_id, embedding)
        VALUES (${id}, ${buf})
        ON CONFLICT (artifact_id) DO UPDATE SET embedding = excluded.embedding
      `),
    )

    return id
  }

  /**
   * Search by embedding similarity:
   * 1. Embed the query
   * 2. Run vec_distance_cosine KNN query against memory_artifacts_vec
   * 3. Fetch metadata for each result from memory_artifacts (scope-filtered)
   * 4. Preserve vector ordering, return top `limit`
   */
  async search(query: string, scopes: ScopeRef[], limit: number): Promise<MemoryArtifact[]> {
    if (!(await this.isAvailable()) || !scopes.length || !query.trim()) return []

    const vecs = await this.embedder.embed([query])
    const vec = vecs[0]
    if (!vec) return []

    const buf = new Float32Array(vec).buffer
    const overfetch = limit * 3

    // sqlite-vec KNN query using MATCH + k
    type VecRow = { artifact_id: string; distance: number }
    let vecRows: VecRow[]
    try {
      vecRows = (await Database.use((db) =>
        db.all(sql`
          SELECT artifact_id, distance
          FROM memory_artifacts_vec
          WHERE embedding MATCH ${buf} AND k = ${overfetch}
          ORDER BY distance
        `),
      )) as VecRow[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("no such table")) {
        console.warn("[memory] embedding search error:", msg)
      }
      return []
    }

    if (!vecRows.length) return []

    // Build scope filter using Drizzle columns (safe for use in .where())
    const scopeWhere = or(
      ...scopes.map((s) => and(eq(MemoryArtifactTable.scope_type, s.type), eq(MemoryArtifactTable.scope_id, s.id))),
    )

    // Fetch metadata filtered by scope and not deleted
    const rows = (await Database.use((db) =>
      db
        .select()
        .from(MemoryArtifactTable)
        .where(and(isNull(MemoryArtifactTable.deleted_at), scopeWhere))
        .all(),
    )) as MemoryArtifact[]

    // Build lookup map
    const byId = new Map<string, MemoryArtifact>()
    for (const r of rows) {
      byId.set(r.id, r)
    }

    // Preserve vector ordering, filter to matching scope + not deleted
    const result: MemoryArtifact[] = []
    for (const row of vecRows) {
      const art = byId.get(row.artifact_id)
      if (art && result.length < limit) result.push(art)
    }

    return result
  }

  /**
   * Remove an artifact:
   * 1. Soft-delete metadata via FTS5Backend
   * 2. Hard-delete vector from memory_artifacts_vec
   */
  async remove(id: string): Promise<void> {
    await this.fts5.remove(id)

    if (!(await this.isAvailable())) return

    await Database.use((db) => db.run(sql`DELETE FROM memory_artifacts_vec WHERE artifact_id = ${id}`))
  }
}
