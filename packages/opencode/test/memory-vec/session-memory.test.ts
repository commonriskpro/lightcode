import { createClient } from "@libsql/client"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Token } from "../../src/util/token"

const emb = (text: string) => {
  const vec = new Array(384).fill(0)
  for (let i = 0; i < text.length; i++) vec[i % 384] += text.charCodeAt(i) / 1000
  const mag = Math.sqrt(vec.reduce((sum, item) => sum + item * item, 0)) || 1
  return vec.map((item) => item / mag)
}

const words = (n: number, seed: string) => new Array(n).fill(seed).join(" ")

const put = async (db: ReturnType<typeof createClient>, sid: string, id: string, idx: number, text: string) => {
  await db.execute({
    sql: `INSERT INTO memory_session_chunks (id, msg_id, session_id, chunk_idx, embedding, text, created_at)
      VALUES (?, ?, ?, ?, vector32(?), ?, ?)`,
    args: [`${id}:${idx}`, id, sid, idx, JSON.stringify(emb(text)), text, Date.now()],
  })
}

const recall = async (db: ReturnType<typeof createClient>, sid: string, text: string, limit = 5) => {
  const rows = await db.execute({
    sql: `SELECT msg_id, vector_distance_cos(embedding, vector32(?)) AS distance, text
      FROM memory_session_chunks
      WHERE session_id = ?
        AND embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ?`,
    args: [JSON.stringify(emb(text)), sid, limit * 5],
  })

  const seen = rows.rows.reduce((map, row) => {
    const msg = String(row.msg_id)
    const dist = Number(row.distance)
    if (dist >= 0.25) return map
    if (!map.has(msg)) {
      map.set(msg, {
        msgId: msg,
        text: String(row.text),
        distance: dist,
        score: 1 - dist,
      })
    }
    return map
  }, new Map<string, { msgId: string; text: string; distance: number; score: number }>())

  return [...seen.values()].slice(0, limit)
}

const append = async (embedder: { embed: (text: string[]) => Promise<number[][]> } | null, text: string) => {
  if (Token.estimate(text) < 50) return false
  if (!embedder) return false
  await embedder.embed([text])
  return true
}

describe("SessionMemory SQL semantics", () => {
  let dir: string
  let file: string
  let db: ReturnType<typeof createClient>

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ltc-sess-"))
    file = path.join(dir, "test.db")
    db = createClient({ url: `file:${file}`, intMode: "number" })
    await db.execute(`CREATE TABLE memory_session_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      msg_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      chunk_idx INTEGER NOT NULL,
      embedding F32_BLOB(384) NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    await db.execute("CREATE UNIQUE INDEX idx_session_chunk_msg ON memory_session_chunks (msg_id, chunk_idx)")
    await db.execute("CREATE INDEX idx_session_chunk_session ON memory_session_chunks (session_id)")
  })

  beforeEach(async () => {
    await db.execute("DELETE FROM memory_session_chunks")
  })

  afterAll(async () => {
    await db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns top-k session matches ordered by distance", async () => {
    await put(db, "A", "m1", 0, words(80, "routing routing"))
    await put(db, "A", "m2", 0, words(80, "routing routing routing routing"))
    await put(db, "A", "m3", 0, words(80, "routing routing routing routing routing routing"))

    const rows = await recall(db, "A", words(80, "routing routing"), 3)

    expect(rows).toHaveLength(3)
    expect(rows[0]?.msgId).toBe("m1")
    expect(rows[0]!.distance).toBeLessThanOrEqual(rows[1]!.distance)
    expect(rows[1]!.distance).toBeLessThanOrEqual(rows[2]!.distance)
  })

  test("session filter keeps other sessions out of recall", async () => {
    await put(db, "A", "ma", 0, words(80, "auth"))
    await put(db, "B", "mb", 0, words(80, "auth"))
    await put(db, "B", "mc", 0, words(80, "billing"))

    const rows = await recall(db, "A", words(80, "auth"), 5)

    expect(rows.map((row) => row.msgId)).toEqual(["ma"])
  })

  test("multi-chunk matches dedupe to one result per msg id", async () => {
    await put(db, "A", "m1", 0, words(80, "chunk"))
    await put(db, "A", "m1", 1, words(80, "chunk"))
    await put(db, "A", "m1", 2, words(80, "chunk"))
    await put(db, "A", "m2", 0, words(80, "routing"))

    const rows = await recall(db, "A", words(80, "chunk"), 5)

    expect(rows.filter((row) => row.msgId === "m1")).toHaveLength(1)
  })

  test("deleting one session clears later recall for that session", async () => {
    await put(db, "A", "ma", 0, words(80, "cleanup"))
    await put(db, "B", "mb", 0, words(80, "cleanup"))

    await db.execute({ sql: "DELETE FROM memory_session_chunks WHERE session_id = ?", args: ["A"] })

    expect(await recall(db, "A", words(80, "cleanup"), 5)).toEqual([])
    expect((await recall(db, "B", words(80, "cleanup"), 5)).map((row) => row.msgId)).toEqual(["mb"])
  })

  test("token estimate stays below threshold for short text and above it for long text", () => {
    expect(Token.estimate(words(20, "short"))).toBeLessThan(50)
    expect(Token.estimate(words(120, "long"))).toBeGreaterThanOrEqual(50)
  })

  test("no embedder available skips indexing", async () => {
    expect(await append(null, words(120, "skip"))).toBe(false)
  })
})
