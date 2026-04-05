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
  export function get(scope: ScopeRef, key?: string): WorkingMemoryRecord[] {
    return Database.use((db) => {
      const base = db
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
    })
  }

  /**
   * Get working memory records for a chain of scopes.
   * Returns records from all scopes, most-specific-first order.
   * Deduplication: if the same key appears in multiple scopes, the most specific wins.
   */
  export function getForScopes(primary: ScopeRef, ancestors: ScopeRef[]): WorkingMemoryRecord[] {
    const all = [primary, ...ancestors].flatMap((s) => get(s))
    // Deduplicate by key: most specific scope (first in list) wins
    const seen = new Set<string>()
    return all.filter((r) => {
      const k = `${r.scope_type}:${r.key}`
      if (seen.has(k)) return false
      seen.add(k)
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
  export function set(scope: ScopeRef, key: string, value: string, format: "markdown" | "json" = "markdown"): void {
    const safe = scope.type === "global_pattern" ? stripPrivate(value) : value
    const now = nowMs()

    Database.transaction(() => {
      const existing = Database.use((db) =>
        db
          .select({ id: WorkingMemoryTable.id, version: WorkingMemoryTable.version })
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
        Database.use((db) =>
          db
            .update(WorkingMemoryTable)
            .set({ value: safe, format, version: existing.version + 1, time_updated: now })
            .where(eq(WorkingMemoryTable.id, existing.id))
            .run(),
        )
      } else {
        Database.use((db) =>
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
  export function remove(scope: ScopeRef, key: string): void {
    Database.use((db) =>
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
  export function clearScope(scope: ScopeRef): void {
    Database.use((db) =>
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
