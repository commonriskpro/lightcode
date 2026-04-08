DROP TABLE IF EXISTS memory_artifacts_vec;

--> statement-breakpoint

DROP TABLE IF EXISTS memory_session_vectors;

--> statement-breakpoint

ALTER TABLE memory_artifacts ADD COLUMN embedding F32_BLOB(384);

--> statement-breakpoint

CREATE TABLE memory_session_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  msg_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  chunk_idx INTEGER NOT NULL,
  embedding F32_BLOB(384) NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

--> statement-breakpoint

CREATE UNIQUE INDEX idx_session_chunk_msg ON memory_session_chunks (msg_id, chunk_idx);

--> statement-breakpoint

CREATE INDEX idx_session_chunk_session ON memory_session_chunks (session_id);

--> statement-breakpoint

CREATE INDEX idx_session_chunk_created ON memory_session_chunks (created_at);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS memory_artifacts_embedding_idx
  ON memory_artifacts (libsql_vector_idx(embedding))
  WHERE deleted_at IS NULL;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS memory_session_chunks_embedding_idx
  ON memory_session_chunks (libsql_vector_idx(embedding));
