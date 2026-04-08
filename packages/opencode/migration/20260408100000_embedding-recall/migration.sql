-- sqlite-vec virtual tables for embedding-based recall
-- These tables cannot be modeled in Drizzle ORM (no virtual table support).
-- They require sqlite-vec extension to be loaded before migrations run.
-- See packages/opencode/src/storage/db.bun.ts for extension loading.

CREATE VIRTUAL TABLE IF NOT EXISTS memory_artifacts_vec USING vec0(
  artifact_id TEXT PRIMARY KEY,
  embedding FLOAT[384]
);

--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS memory_session_vectors USING vec0(
  msg_id TEXT,
  session_id TEXT,
  chunk_idx INTEGER,
  embedding FLOAT[384],
  +text TEXT,
  +created_at INTEGER
);
