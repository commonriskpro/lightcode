/**
 * LightCode Memory Core V1 — Drizzle Schema
 *
 * All tables are additive. No existing tables are modified.
 * Mirrors the SQL in migration/20260405000000_memory_core_v1/migration.sql.
 */

import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { MemoryScope, ArtifactType, LinkRelation } from "./contracts"

// ─── Working Memory ───────────────────────────────────────────────────────────

export const WorkingMemoryTable = sqliteTable(
  "memory_working",
  {
    id: text().primaryKey(),
    scope_type: text().$type<MemoryScope>().notNull(),
    scope_id: text().notNull(),
    key: text().notNull(),
    value: text().notNull(),
    format: text().$type<"markdown" | "json">().notNull().default("markdown"),
    version: integer().notNull().default(1),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [
    uniqueIndex("idx_wm_scope_key").on(t.scope_type, t.scope_id, t.key),
    index("idx_wm_scope").on(t.scope_type, t.scope_id),
    index("idx_wm_updated").on(t.time_updated),
  ],
)

// ─── Memory Artifacts (Semantic Recall) ──────────────────────────────────────

export const MemoryArtifactTable = sqliteTable(
  "memory_artifacts",
  {
    id: text().primaryKey(),
    scope_type: text().$type<MemoryScope>().notNull(),
    scope_id: text().notNull(),
    type: text().$type<ArtifactType>().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    topic_key: text(),
    normalized_hash: text(),
    revision_count: integer().notNull().default(1),
    duplicate_count: integer().notNull().default(1),
    last_seen_at: integer(),
    deleted_at: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [
    index("idx_art_scope").on(t.scope_type, t.scope_id),
    index("idx_art_topic").on(t.topic_key, t.scope_type, t.scope_id),
    index("idx_art_type").on(t.type),
    index("idx_art_hash").on(t.normalized_hash, t.scope_type, t.scope_id),
    index("idx_art_deleted").on(t.deleted_at),
    index("idx_art_created").on(t.time_created),
  ],
)

// ─── Agent Handoffs ───────────────────────────────────────────────────────────

export const AgentHandoffTable = sqliteTable(
  "memory_agent_handoffs",
  {
    id: text().primaryKey(),
    parent_session_id: text().notNull(),
    child_session_id: text().notNull().unique(),
    context: text().notNull(),
    working_memory_snap: text(),
    observation_snap: text(),
    metadata: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [index("idx_handoff_child").on(t.child_session_id), index("idx_handoff_parent").on(t.parent_session_id)],
)

// ─── Fork Contexts ────────────────────────────────────────────────────────────

export const ForkContextTable = sqliteTable(
  "memory_fork_contexts",
  {
    id: text().primaryKey(),
    session_id: text().notNull().unique(),
    parent_session_id: text().notNull(),
    context: text().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [index("idx_fork_session").on(t.session_id)],
)

// ─── Memory Links ─────────────────────────────────────────────────────────────

export const MemoryLinkTable = sqliteTable(
  "memory_links",
  {
    id: text().primaryKey(),
    from_artifact_id: text().notNull(),
    to_artifact_id: text().notNull(),
    relation: text().$type<LinkRelation>().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [index("idx_link_from").on(t.from_artifact_id), index("idx_link_to").on(t.to_artifact_id)],
)

// ─── sqlite-vec Virtual Tables (NOT modeled in Drizzle) ──────────────────────
//
// The following virtual tables exist at runtime but CANNOT be expressed in
// Drizzle ORM because Drizzle has no virtual-table support.
// They are created via raw SQL in:
//   migration/20260408100000_embedding-recall/migration.sql
//
// Table: memory_artifacts_vec
//   vec0 virtual table storing 384-dim float embeddings for memory_artifacts.
//   Columns: artifact_id TEXT PRIMARY KEY, embedding FLOAT[384]
//   Purpose: cross-session semantic similarity search (embedding recall backend)
//
// Table: memory_session_vectors
//   vec0 virtual table for per-session ephemeral message embeddings.
//   Columns: msg_id TEXT, session_id TEXT, chunk_idx INTEGER,
//            embedding FLOAT[384], +text TEXT, +created_at INTEGER
//   Purpose: intra-session recall (session memory)
//   Lifecycle: entries cleared on session close via SessionMemory.clear(sid)
//
// IMPORTANT: sqlite-vec must be loaded (via sqliteVec.load(db)) BEFORE
// any migration that references these tables runs. See db.bun.ts.

// ─── Exported types ───────────────────────────────────────────────────────────

export type WorkingMemoryRow = typeof WorkingMemoryTable.$inferSelect
export type MemoryArtifactRow = typeof MemoryArtifactTable.$inferSelect
export type AgentHandoffRow = typeof AgentHandoffTable.$inferSelect
export type ForkContextRow = typeof ForkContextTable.$inferSelect
export type MemoryLinkRow = typeof MemoryLinkTable.$inferSelect
