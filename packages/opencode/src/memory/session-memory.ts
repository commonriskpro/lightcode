/**
 * Per-session native vector index for intra-session semantic recall.
 *
 * - Indexes message text into `memory_session_chunks` as messages arrive via
 *   fire-and-forget calls from `projectors.ts`.
 * - Cleans up vectors when sessions are removed via fire-and-forget calls from
 *   `session/index.ts`.
 * - Skips indexing for messages below the 50-token threshold to avoid noise.
 * - Recalls the top 5 nearest matches, filtering out cosine distances >= 0.25.
 * - Deduplicates by `msg_id` when multiple chunks from one long message match.
 * - Silently skips all vector work when no embedder is available.
 */

import { eq, sql } from "drizzle-orm"
import { Database } from "../storage/db"
import { Token } from "../util/token"
import { Embedder } from "./embedder"
import type { SessionID } from "../session/schema"
import type { SessionRecallResult } from "./contracts"
import { MemorySessionChunkTable } from "./schema.sql"

const MIN_TOKENS = 50
const CHUNK_SIZE = 4096 // chars per chunk
const DEFAULT_RECALL_LIMIT = 5
const DISTANCE_THRESHOLD = 0.25

function id(msg: string, idx: number): string {
  return `${msg}:${idx}`
}

function chunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text]
  const parts: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    parts.push(text.slice(i, i + CHUNK_SIZE))
  }
  return parts
}

let _available: boolean | undefined
let _probe: Promise<boolean> | undefined

async function available(): Promise<boolean> {
  if (typeof _available === "boolean") return _available
  _probe ??= Database.use((db) => db.run(sql`SELECT embedding FROM memory_session_chunks LIMIT 0`))
    .then(() => true)
    .catch(() => false)
  _available = await _probe
  return _available
}

export namespace SessionMemory {
  /**
   * Embed and index a message into the session vector store.
   *
   * Skipped if:
   * - text has < 50 tokens
   * - embedder is unavailable
   * - vec table not available
   */
  export async function append(sid: SessionID, msgId: string, text: string): Promise<void> {
    if (Token.estimate(text) < MIN_TOKENS) return
    if (!(await available())) return

    const embedder = await Embedder.get()
    if (!embedder) return

    const parts = chunks(text)
    const vecs = await embedder.embed(parts)
    const now = Date.now()

    for (let i = 0; i < parts.length; i++) {
      const vec = vecs[i]
      if (!vec) continue
      await Database.use((db) =>
        db
          .insert(MemorySessionChunkTable)
          .values({
            id: id(msgId, i),
            msg_id: msgId,
            session_id: sid,
            chunk_idx: i,
            embedding: new Float32Array(vec),
            text: parts[i]!,
            created_at: now,
          })
          .onConflictDoUpdate({
            target: MemorySessionChunkTable.id,
            set: {
              embedding: new Float32Array(vec),
              text: parts[i]!,
              created_at: now,
            },
          })
          .run(),
      )
    }
  }

  /**
   * Recall the top-k most relevant past messages from this session.
   *
   * - Embeds the query
   * - Queries memory_session_chunks with cosine distance
   * - Filters out results with distance >= DISTANCE_THRESHOLD (not similar enough)
   * - Deduplicates by msg_id (keeps closest chunk per message)
   * - Returns top `limit` results
   */
  export async function recall(
    sid: SessionID,
    query: string,
    limit = DEFAULT_RECALL_LIMIT,
    excludeMsgIds: string[] = [],
  ): Promise<SessionRecallResult[]> {
    if (!(await available())) return []

    const embedder = await Embedder.get()
    if (!embedder) return []

    const vecs = await embedder.embed([query])
    const vec = vecs[0]
    if (!vec) return []

    const txt = JSON.stringify(Array.from(vec))
    const over = limit * 5

    type VecRow = { msg_id: string; distance: number; text: string }
    let rows: VecRow[]
    try {
      rows = (await Database.use((db) =>
        db.all(sql`
          SELECT msg_id, vector_distance_cos(embedding, vector32(${txt})) AS distance, text
          FROM memory_session_chunks
          WHERE session_id = ${sid}
            AND embedding IS NOT NULL
          ORDER BY distance ASC
          LIMIT ${over}
        `),
      )) as VecRow[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("no such table")) {
        console.warn("[memory] session recall error:", msg)
      }
      return []
    }

    const exclude = new Set(excludeMsgIds)

    // Filter by distance threshold and deduplicate by msg_id (keep best chunk)
    const seen = new Map<string, SessionRecallResult>()
    for (const row of rows) {
      if (row.distance >= DISTANCE_THRESHOLD) continue
      if (exclude.has(row.msg_id)) continue
      if (!seen.has(row.msg_id)) {
        seen.set(row.msg_id, {
          msgId: row.msg_id,
          text: row.text,
          score: 1 - row.distance, // convert distance to similarity score
        })
      }
    }

    return [...seen.values()].slice(0, limit)
  }

  /**
   * Delete all session vectors for a given session.
   * Called when the session closes.
   */
  export async function clear(sid: SessionID): Promise<void> {
    if (!(await available())) return

    await Database.use((db) =>
      db.delete(MemorySessionChunkTable).where(eq(MemorySessionChunkTable.session_id, sid)).run(),
    )
  }
}
