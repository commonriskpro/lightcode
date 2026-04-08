/**
 * Async `RecallBackend` backed by SQLite FTS5.
 *
 * - Wraps the existing two-pass FTS5 search: AND mode first, then prefix-OR
 *   fallback when needed.
 * - Preserves topic-key upsert and 15-minute normalized-hash dedupe behavior.
 * - Uses soft delete via `deleted_at`.
 * - Can be used directly or composed by `HybridBackend`.
 */

import { createHash } from "crypto"
import { eq, and, isNull, or, sql } from "drizzle-orm"
import { Database } from "../storage/db"
import { Token } from "../util/token"
import { MemoryArtifactTable } from "./schema.sql"
import type { MemoryArtifact, ArtifactSearchResult, ScopeRef, RecallBackend } from "./contracts"

const DEDUPE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CONTENT_LENGTH = 50_000

function normalizeContent(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

function hashContent(s: string): string {
  return createHash("sha256").update(normalizeContent(s)).digest("hex").slice(0, 32)
}

function normalizeTopicKey(k: string | null | undefined): string | null {
  if (!k) return null
  return k.replace(/\s+/g, "-").toLowerCase().trim() || null
}

function cleanToken(t: string): string {
  const reserved = new Set(["and", "or", "not"])
  const next = t.replace(/[^\p{L}\p{N}_-]/gu, "").trim()
  if (!next) return ""
  if (reserved.has(next.toLowerCase())) return ""
  return next
}

function sanitizeFTS(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(" ")
}

function sanitizeFTSPrefix(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" OR ")
}

function nowId(): string {
  const bytes = createHash("sha256")
    .update(String(Date.now()) + Math.random())
    .digest("hex")
    .slice(0, 20)
  return `art_${bytes}`
}

export class FTS5Backend implements RecallBackend {
  /**
   * Index a memory artifact.
   *
   * Implements:
   * 1. Topic-key upsert (same topic_key in same scope → revision_count++)
   * 2. Hash dedupe within 15-min window (same hash → duplicate_count++)
   * 3. Insert new artifact if no match
   *
   * Returns the artifact ID (existing or new).
   */
  async index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): Promise<string> {
    const content =
      artifact.content.length > MAX_CONTENT_LENGTH
        ? artifact.content.slice(0, MAX_CONTENT_LENGTH) + "... [truncated]"
        : artifact.content

    const hash = hashContent(content)
    const topicKey = normalizeTopicKey(artifact.topic_key)
    const now = Date.now()

    let id = ""

    Database.transaction(() => {
      // 1. Topic-key upsert
      if (topicKey) {
        const existing = Database.use((db) =>
          db
            .select({ id: MemoryArtifactTable.id, revision_count: MemoryArtifactTable.revision_count })
            .from(MemoryArtifactTable)
            .where(
              and(
                eq(MemoryArtifactTable.topic_key, topicKey),
                eq(MemoryArtifactTable.scope_type, artifact.scope_type),
                eq(MemoryArtifactTable.scope_id, artifact.scope_id),
                isNull(MemoryArtifactTable.deleted_at),
              ),
            )
            .orderBy(sql`${MemoryArtifactTable.time_updated} DESC`)
            .limit(1)
            .get(),
        )

        if (existing) {
          Database.use((db) =>
            db
              .update(MemoryArtifactTable)
              .set({
                title: artifact.title,
                content,
                type: artifact.type,
                normalized_hash: hash,
                revision_count: existing.revision_count + 1,
                last_seen_at: now,
                time_updated: now,
              })
              .where(eq(MemoryArtifactTable.id, existing.id))
              .run(),
          )
          id = existing.id
          return
        }
      }

      // 2. Hash dedupe within window
      const windowStart = now - DEDUPE_WINDOW_MS
      const dup = Database.use((db) =>
        db
          .select({ id: MemoryArtifactTable.id, duplicate_count: MemoryArtifactTable.duplicate_count })
          .from(MemoryArtifactTable)
          .where(
            and(
              eq(MemoryArtifactTable.normalized_hash, hash),
              eq(MemoryArtifactTable.scope_type, artifact.scope_type),
              eq(MemoryArtifactTable.scope_id, artifact.scope_id),
              eq(MemoryArtifactTable.type, artifact.type),
              isNull(MemoryArtifactTable.deleted_at),
              sql`${MemoryArtifactTable.time_created} >= ${windowStart}`,
            ),
          )
          .orderBy(sql`${MemoryArtifactTable.time_created} DESC`)
          .limit(1)
          .get(),
      )

      if (dup) {
        Database.use((db) =>
          db
            .update(MemoryArtifactTable)
            .set({ duplicate_count: dup.duplicate_count + 1, last_seen_at: now, time_updated: now })
            .where(eq(MemoryArtifactTable.id, dup.id))
            .run(),
        )
        id = dup.id
        return
      }

      // 3. Insert new artifact
      const newId = nowId()
      Database.use((db) =>
        db
          .insert(MemoryArtifactTable)
          .values({
            id: newId,
            scope_type: artifact.scope_type,
            scope_id: artifact.scope_id,
            type: artifact.type,
            title: artifact.title,
            content,
            topic_key: topicKey,
            normalized_hash: hash,
            revision_count: 1,
            duplicate_count: 1,
            last_seen_at: now,
            deleted_at: null,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      id = newId
    })

    return id
  }

  /**
   * Search memory artifacts using FTS5.
   * Two-pass strategy: AND (high precision) → OR prefix fallback (high recall).
   * Also performs direct topic_key match (rank=-1000, treated as highest priority).
   */
  async search(query: string, scopes: ScopeRef[], limit = 10): Promise<MemoryArtifact[]> {
    if (!query.trim() || !scopes.length) return []

    const results: ArtifactSearchResult[] = []
    const seen = new Set<string>()
    const scopeWhere = or(
      ...scopes.map((s) => and(eq(MemoryArtifactTable.scope_type, s.type), eq(MemoryArtifactTable.scope_id, s.id))),
    )
    const scopeSql = sql.join(
      scopes.map((s) => sql`(a.scope_type = ${s.type} AND a.scope_id = ${s.id})`),
      sql` OR `,
    )

    // Direct topic_key match
    if (query.includes("/")) {
      const topicResults = Database.use((db) =>
        db
          .select()
          .from(MemoryArtifactTable)
          .where(
            and(eq(MemoryArtifactTable.topic_key, query.trim()), isNull(MemoryArtifactTable.deleted_at), scopeWhere),
          )
          .orderBy(sql`${MemoryArtifactTable.time_updated} DESC`)
          .limit(limit)
          .all(),
      )
      for (const r of topicResults) {
        if (!seen.has(r.id)) {
          results.push({ ...r, rank: -1000 })
          seen.add(r.id)
        }
      }
    }

    const ftsQueryAnd = sanitizeFTS(query)
    const ftsQueryOr = sanitizeFTSPrefix(query)

    const runFTSQuery = (ftsQuery: string): (MemoryArtifact & { rank: number })[] =>
      Database.use((db) =>
        db.all(sql`
          SELECT a.id, a.scope_type, a.scope_id, a.type, a.title, a.content,
                 a.topic_key, a.normalized_hash, a.revision_count, a.duplicate_count,
                 a.last_seen_at, a.deleted_at, a.time_created, a.time_updated,
                 f.rank
          FROM memory_artifacts_fts f
          JOIN memory_artifacts a ON a.rowid = f.rowid
          WHERE memory_artifacts_fts MATCH ${ftsQuery}
            AND a.deleted_at IS NULL
            AND (${scopeSql})
          ORDER BY f.rank
          LIMIT ${limit}
        `),
      ) as (MemoryArtifact & { rank: number })[]

    if (ftsQueryAnd) {
      // Pass 1: AND mode
      try {
        const andResults = runFTSQuery(ftsQueryAnd)
        for (const r of andResults) {
          if (!seen.has(r.id)) {
            results.push(r)
            seen.add(r.id)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes("no such table")) {
          console.warn("[memory] FTS5 AND search error:", msg)
        }
      }

      // Pass 2: prefix-OR fallback — only if AND returned 0 new results
      if (results.length === 0 && ftsQueryOr) {
        try {
          const orResults = runFTSQuery(ftsQueryOr)
          for (const r of orResults) {
            if (!seen.has(r.id)) {
              results.push(r)
              seen.add(r.id)
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes("no such table")) {
            console.warn("[memory] FTS5 OR search error:", msg)
          }
        }
      }
    }

    if (results.length > limit) return results.slice(0, limit) as MemoryArtifact[]
    return results as MemoryArtifact[]
  }

  /**
   * Get recent artifacts for a scope, ordered by most recently updated.
   */
  recent(scopes: ScopeRef[], limit = 10): MemoryArtifact[] {
    if (!scopes.length) return []
    const results: MemoryArtifact[] = []
    for (const scope of scopes) {
      const rows = Database.use((db) =>
        db
          .select()
          .from(MemoryArtifactTable)
          .where(
            and(
              eq(MemoryArtifactTable.scope_type, scope.type),
              eq(MemoryArtifactTable.scope_id, scope.id),
              isNull(MemoryArtifactTable.deleted_at),
            ),
          )
          .orderBy(sql`${MemoryArtifactTable.time_updated} DESC`)
          .limit(limit)
          .all(),
      ) as MemoryArtifact[]
      results.push(...rows)
      if (results.length >= limit) break
    }
    return results.slice(0, limit)
  }

  /**
   * Get a specific artifact by ID.
   */
  get(id: string): MemoryArtifact | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(MemoryArtifactTable)
        .where(and(eq(MemoryArtifactTable.id, id), isNull(MemoryArtifactTable.deleted_at)))
        .get(),
    ) as MemoryArtifact | undefined
  }

  /**
   * Soft-delete an artifact. Excluded from all subsequent search results.
   */
  async remove(id: string): Promise<void> {
    Database.use((db) =>
      db
        .update(MemoryArtifactTable)
        .set({ deleted_at: Date.now(), time_updated: Date.now() })
        .where(eq(MemoryArtifactTable.id, id))
        .run(),
    )
  }
}

/**
 * Format search results for prompt injection.
 * Respects token budget. Returns undefined if empty or budget exhausted.
 */
export function format(artifacts: MemoryArtifact[], budget: number): string | undefined {
  if (!artifacts.length) return undefined

  const lines: string[] = []
  let used = 0

  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i]
    const scopeLabel = `${a.scope_type}/${a.scope_id}`
    const preview = a.content.length > 800 ? a.content.slice(0, 800) + "…" : a.content
    const entry = `[${i + 1}] ${a.title} (${scopeLabel})\n${preview}`
    const est = Token.estimate(entry)
    if (used + est > budget) break
    lines.push(entry)
    used += est
  }

  if (!lines.length) return undefined
  return lines.join("\n\n")
}
