/**
 * LightCode Memory Core V1 — Working Memory Service
 *
 * Structured canonical state: stable facts, preferences, goals, constraints,
 * project decisions. Durable per-scope storage with version tracking.
 *
 * Architecturally distinct from Observational Memory (OM):
 * - WM: structured, explicitly updated, scope-persistent
 * - OM: LLM-generated narrative, threshold-driven, session-scoped
 */

import { createHash } from "crypto"
import { eq, and } from "drizzle-orm"
import { Database } from "../storage/db"
import { Identifier } from "../id/id"
import { Token } from "../util/token"
import { WorkingMemoryTable } from "./schema.sql"
import type { MemoryScope, ScopeRef, WorkingMemoryRecord } from "./contracts"

const PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi
const ORDER = {
  thread: 0,
  agent: 1,
  project: 2,
  user: 3,
  global_pattern: 4,
} as const

function stripPrivate(s: string): string {
  return s.replace(PRIVATE_TAG_RE, "").trim()
}

function nowMs(): number {
  return Date.now()
}

export namespace WorkingMemory {
  /**
   * Get working memory records for a single scope.
   * If key is provided, returns only that key's record (or empty array).
   */
  export async function get(scope: ScopeRef, key?: string): Promise<WorkingMemoryRecord[]> {
    return (await Database.use(async (db) => {
      const base = await db
        .select()
        .from(WorkingMemoryTable)
        .where(
          and(
            eq(WorkingMemoryTable.scope_type, scope.type),
            eq(WorkingMemoryTable.scope_id, scope.id),
            ...(key ? [eq(WorkingMemoryTable.key, key)] : []),
          ),
        )
        .orderBy(WorkingMemoryTable.time_updated)
        .all()
      return base as WorkingMemoryRecord[]
    })) as WorkingMemoryRecord[]
  }

  /**
   * Get working memory records for a chain of scopes.
   *
   * Returns records from all scopes in precedence order: most-specific first
   * (primary scope), then ancestors in order. When the same logical key appears
   * in multiple scopes, the most specific scope wins.
   *
   * Precedence order (highest to lowest):
   *   thread > agent > project > user > global_pattern
   *
   * Bug fix (production): the previous dedup key was `"${scope_type}:${key}"`,
   * which made records from different scope types with the same key name ALL
   * pass through — defeating the "most specific wins" contract. The key is now
   * just `r.key` so thread's "goals" overrides project's "goals" correctly.
   */
  export async function getForScopes(primary: ScopeRef, ancestors: ScopeRef[]): Promise<WorkingMemoryRecord[]> {
    const rows = await Promise.all(
      [primary, ...ancestors].sort((a, b) => ORDER[a.type] - ORDER[b.type]).map((s) => get(s)),
    )
    const all = rows.flat()
    // Deduplicate by logical key name across scopes.
    // Since records are ordered most-specific-first (primary first, then ancestors),
    // the first occurrence of each key name is the highest-precedence value.
    const seen = new Set<string>()
    return all.filter((r) => {
      if (seen.has(r.key)) return false
      seen.add(r.key)
      return true
    })
  }

  /**
   * Upsert a working memory key in a scope.
   * If the key exists: updates value, increments version, updates time_updated.
   * If the key doesn't exist: inserts new record.
   *
   * Global pattern writes: strips <private> tags before persisting.
   */
  export async function set(
    scope: ScopeRef,
    key: string,
    value: string,
    format: "markdown" | "json" = "markdown",
  ): Promise<void> {
    const safe = scope.type === "global_pattern" ? stripPrivate(value) : value
    const now = nowMs()

    await Database.tx(async () => {
      const existing = await Database.use((db) =>
        db
          .select()
          .from(WorkingMemoryTable)
          .where(
            and(
              eq(WorkingMemoryTable.scope_type, scope.type),
              eq(WorkingMemoryTable.scope_id, scope.id),
              eq(WorkingMemoryTable.key, key),
            ),
          )
          .get(),
      )

      if (existing) {
        await Database.write((db) =>
          db
            .update(WorkingMemoryTable)
            .set({ value: safe, format, version: existing.version + 1, time_updated: now })
            .where(eq(WorkingMemoryTable.id, existing.id))
            .run(),
        )
      } else {
        await Database.write((db) =>
          db
            .insert(WorkingMemoryTable)
            .values({
              id: newId(),
              scope_type: scope.type,
              scope_id: scope.id,
              key,
              value: safe,
              format,
              version: 1,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      }
    })
  }

  /**
   * Remove a working memory key from a scope.
   */
  export async function remove(scope: ScopeRef, key: string): Promise<void> {
    await Database.write((db) =>
      db
        .delete(WorkingMemoryTable)
        .where(
          and(
            eq(WorkingMemoryTable.scope_type, scope.type),
            eq(WorkingMemoryTable.scope_id, scope.id),
            eq(WorkingMemoryTable.key, key),
          ),
        )
        .run(),
    )
  }

  /**
   * Delete all working memory records for a scope (e.g. when a thread is deleted).
   */
  export async function clearScope(scope: ScopeRef): Promise<void> {
    await Database.write((db) =>
      db
        .delete(WorkingMemoryTable)
        .where(and(eq(WorkingMemoryTable.scope_type, scope.type), eq(WorkingMemoryTable.scope_id, scope.id)))
        .run(),
    )
  }

  /**
   * Format working memory records for prompt injection.
   * Returns a wrapped block or undefined if empty / budget exhausted.
   */
  export function format(records: WorkingMemoryRecord[], budget: number): string | undefined {
    if (!records.length) return undefined

    const parts: string[] = []
    let used = 0

    for (const r of records) {
      const entry = `### ${r.key} (${r.scope_type})\n${r.value}`
      const est = Token.estimate(entry)
      if (used + est > budget) break
      parts.push(entry)
      used += est
    }

    if (!parts.length) return undefined
    return parts.join("\n\n")
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

function newId(): string {
  const bytes = createHash("sha256")
    .update(String(Date.now()) + Math.random())
    .digest("hex")
    .slice(0, 20)
  return `wm_${bytes}`
}
