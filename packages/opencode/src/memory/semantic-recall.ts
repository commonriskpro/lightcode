/**
 * LightCode Memory Core V1 — Semantic Recall Service
 *
 * Similarity-based retrieval of memory artifacts. V1 uses SQLite FTS5 for
 * full-text search. The RecallBackend abstraction allows future swap-in of
 * vector/embedding backends without changing the MemoryProvider interface.
 *
 * Storage patterns borrowed from Engram:
 * - Topic-key upsert: same topic_key → revision_count increments
 * - Hash-based dedupe: same content within 15min window → duplicate_count increments
 * - Soft delete: deleted_at field, excluded from search results
 * - FTS5 query sanitization: wrap terms in quotes to avoid syntax errors
 */

import { createHash } from "crypto"
import { eq, and, isNull, sql } from "drizzle-orm"
import { Database } from "../storage/db"
import { Token } from "../util/token"
import { MemoryArtifactTable } from "./schema.sql"
import type { MemoryArtifact, ArtifactSearchResult, ScopeRef } from "./contracts"

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

/**
 * Sanitize a search query for FTS5: wrap each token in double quotes.
 * This prevents crashes from FTS5 special chars (AND, OR, NOT, *, etc.)
 */
function sanitizeFTS(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" ")
}

function nowId(): string {
  const bytes = createHash("sha256")
    .update(String(Date.now()) + Math.random())
    .digest("hex")
    .slice(0, 20)
  return `art_${bytes}`
}

export namespace SemanticRecall {
  /**
   * Index a memory artifact. Implements:
   * 1. Topic-key upsert (same topic_key in same scope → revision_count++)
   * 2. Hash dedupe within 15-min window (same hash → duplicate_count++)
   * 3. Insert new artifact if no match
   *
   * Returns the artifact ID (existing or new).
   */
  export function index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): string {
    const content =
      artifact.content.length > MAX_CONTENT_LENGTH
        ? artifact.content.slice(0, MAX_CONTENT_LENGTH) + "... [truncated]"
        : artifact.content

    const hash = hashContent(content)
    const topicKey = normalizeTopicKey(artifact.topic_key)
    const now = Date.now()

    let resultId = ""

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
          resultId = existing.id
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
        resultId = dup.id
        return
      }

      // 3. Insert new artifact
      const id = nowId()
      Database.use((db) =>
        db
          .insert(MemoryArtifactTable)
          .values({
            id,
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
      resultId = id
    })

    return resultId
  }

  /**
   * Search memory artifacts using FTS5 full-text search.
   * Results are filtered by scope and ranked by FTS5 relevance.
   *
   * Also performs a direct topic_key match (treated as highest priority, rank=-1000).
   */
  export function search(query: string, scopes: ScopeRef[], limit = 10): MemoryArtifact[] {
    if (!query.trim() || !scopes.length) return []

    const results: ArtifactSearchResult[] = []
    const seen = new Set<string>()

    // Build scope filter placeholders — must qualify with table alias to avoid
    // ambiguity with FTS5 virtual table columns of the same name
    const scopeConditions = scopes.map((s) => `(a.scope_type = '${s.type}' AND a.scope_id = '${s.id}')`).join(" OR ")

    // Direct topic_key match (Engram-style: "/" in query = topic_key lookup)
    if (query.includes("/")) {
      const topicResults = Database.use((db) =>
        db
          .select()
          .from(MemoryArtifactTable)
          .where(and(eq(MemoryArtifactTable.topic_key, query.trim()), isNull(MemoryArtifactTable.deleted_at)))
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

    // FTS5 search
    const ftsQuery = sanitizeFTS(query)
    if (ftsQuery) {
      try {
        const raw = Database.use((db) =>
          db.all(sql`
            SELECT a.id, a.scope_type, a.scope_id, a.type, a.title, a.content,
                   a.topic_key, a.normalized_hash, a.revision_count, a.duplicate_count,
                   a.last_seen_at, a.deleted_at, a.time_created, a.time_updated,
                   f.rank
            FROM memory_artifacts_fts f
            JOIN memory_artifacts a ON a.rowid = f.rowid
            WHERE memory_artifacts_fts MATCH ${ftsQuery}
              AND a.deleted_at IS NULL
              AND (${sql.raw(scopeConditions)})
            ORDER BY f.rank
            LIMIT ${limit}
          `),
        ) as (MemoryArtifact & { rank: number })[]

        for (const r of raw) {
          if (!seen.has(r.id)) {
            results.push(r)
            seen.add(r.id)
          }
        }
      } catch (err) {
        // Log FTS5 errors — silently swallowing made debugging hard in V1
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes("no such table")) {
          // Only log real query errors, not missing-table errors (fresh DB)
          console.warn("[memory] FTS5 search error:", msg)
        }
      }
    }

    if (results.length > limit) return results.slice(0, limit) as MemoryArtifact[]
    return results as MemoryArtifact[]
  }

  /**
   * Get recent artifacts for a scope, ordered by most recently updated.
   * Used as a non-FTS fallback when no semantic query is available.
   */
  export function recent(scopes: ScopeRef[], limit = 10): MemoryArtifact[] {
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
  export function get(id: string): MemoryArtifact | undefined {
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
  export function remove(id: string): void {
    Database.use((db) =>
      db
        .update(MemoryArtifactTable)
        .set({ deleted_at: Date.now(), time_updated: Date.now() })
        .where(eq(MemoryArtifactTable.id, id))
        .run(),
    )
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
      // V2: expanded preview from 300 → 800 chars for more useful recall context
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
}
