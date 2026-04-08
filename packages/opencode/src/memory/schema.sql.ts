/**
 * LightCode Memory Core V1 — Drizzle Schema
 *
 * All tables are additive. No existing tables are modified.
 * Mirrors the SQL in migration/20260405000000_memory_core_v1/migration.sql.
 */

import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { MemoryScope, ArtifactType, LinkRelation } from "./contracts"
import { f32blob } from "./vector-type"

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
    embedding: f32blob(384)(),
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

export const MemorySessionChunkTable = sqliteTable(
  "memory_session_chunks",
  {
    id: text().primaryKey(),
    msg_id: text().notNull(),
    session_id: text().notNull(),
    chunk_idx: integer().notNull(),
    embedding: f32blob(384)().notNull(),
    text: text().notNull(),
    created_at: integer().notNull(),
  },
  (t) => [
    uniqueIndex("idx_session_chunk_msg").on(t.msg_id, t.chunk_idx),
    index("idx_session_chunk_session").on(t.session_id),
    index("idx_session_chunk_created").on(t.created_at),
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

// ─── Native libSQL vector columns ─────────────────────────────────────────────
//
// `memory_artifacts.embedding` stores durable semantic-recall vectors.
// `memory_session_chunks.embedding` stores per-session recall chunks.
// Both use libSQL native `F32_BLOB(384)` columns and are queried with
// `vector_distance_cos(...)`.

// ─── Exported types ───────────────────────────────────────────────────────────

export type WorkingMemoryRow = typeof WorkingMemoryTable.$inferSelect
export type MemoryArtifactRow = typeof MemoryArtifactTable.$inferSelect
export type MemorySessionChunkRow = typeof MemorySessionChunkTable.$inferSelect
export type AgentHandoffRow = typeof AgentHandoffTable.$inferSelect
export type ForkContextRow = typeof ForkContextTable.$inferSelect
export type MemoryLinkRow = typeof MemoryLinkTable.$inferSelect
