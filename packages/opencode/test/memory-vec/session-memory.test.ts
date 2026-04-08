/**
 * Isolated vec test suite.
 *
 * These tests open additional bun:sqlite Database instances with sqlite-vec
 * loaded. When combined with the preload.ts global Database in the same
 * process, Bun crashes with a C++ exception during teardown.
 *
 * Workaround: run this suite in a separate `bun test` invocation via
 * `bun run test:vec` from packages/opencode/.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Database as BunDB } from "bun:sqlite"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import * as sqliteVec from "sqlite-vec"
import { Token } from "../../src/util/token"

process.env.OPENCODE_SKIP_MIGRATIONS = "1"

const emb = (text: string) => {
  const v = new Array(384).fill(0)
  for (let i = 0; i < text.length; i++) v[i % 384] += text.charCodeAt(i) / 1000
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1
  return v.map((x) => x / mag)
}

const words = (n: number, seed: string) => new Array(n).fill(seed).join(" ")

const put = (db: BunDB, sid: string, id: string, idx: number, text: string) => {
  db.prepare(
    `INSERT INTO memory_session_vectors (msg_id, session_id, chunk_idx, embedding, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, sid, idx, new Float32Array(emb(text)), text, Date.now())
}

const recall = (db: BunDB, sid: string, text: string, limit = 5) => {
  const rows = db
    .prepare(
      `SELECT msg_id, distance, text
       FROM memory_session_vectors
       WHERE embedding MATCH ?
         AND k = ?
         AND session_id = ?
       ORDER BY distance`,
    )
    .all(new Float32Array(emb(text)), limit * 5, sid) as { msg_id: string; distance: number; text: string }[]

  const seen = rows.reduce((map, row) => {
    if (row.distance >= 0.25) return map
    if (!map.has(row.msg_id)) {
      map.set(row.msg_id, {
        msgId: row.msg_id,
        text: row.text,
        distance: row.distance,
        score: 1 - row.distance,
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
  let db: BunDB

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ltc-sess-"))
    file = path.join(dir, "test.db")
    process.env.OPENCODE_DB = file
    // @ts-expect-error Bun runtime supports enableExtensions
    db = new BunDB(file, { create: true, enableExtensions: true })
    sqliteVec.load(db)
    db.run(`
      CREATE VIRTUAL TABLE memory_session_vectors USING vec0(
        msg_id TEXT,
        session_id TEXT,
        chunk_idx INTEGER,
        embedding FLOAT[384],
        +text TEXT,
        +created_at INTEGER
      )
    `)
  })

  beforeEach(() => {
    db.run("DELETE FROM memory_session_vectors")
  })

  afterAll(() => {
    db.close()
  })

  test("returns top-k session matches ordered by distance", () => {
    put(db, "A", "m1", 0, words(80, "routing routing"))
    put(db, "A", "m2", 0, words(80, "routing routing routing routing"))
    put(db, "A", "m3", 0, words(80, "routing routing routing routing routing routing"))

    const rows = recall(db, "A", words(80, "routing routing"), 3)

    expect(rows).toHaveLength(3)
    expect(rows[0]?.msgId).toBe("m1")
    expect(rows[0]!.distance).toBeLessThanOrEqual(rows[1]!.distance)
    expect(rows[1]!.distance).toBeLessThanOrEqual(rows[2]!.distance)
  })

  test("session filter keeps other sessions out of recall", () => {
    put(db, "A", "ma", 0, words(80, "auth"))
    put(db, "B", "mb", 0, words(80, "auth"))
    put(db, "B", "mc", 0, words(80, "billing"))

    const rows = recall(db, "A", words(80, "auth"), 5)

    expect(rows.map((row) => row.msgId)).toEqual(["ma"])
  })

  test("multi-chunk matches dedupe to one result per msg id", () => {
    put(db, "A", "m1", 0, words(80, "chunk"))
    put(db, "A", "m1", 1, words(80, "chunk"))
    put(db, "A", "m1", 2, words(80, "chunk"))
    put(db, "A", "m2", 0, words(80, "routing"))

    const rows = recall(db, "A", words(80, "chunk"), 5)

    expect(rows.filter((row) => row.msgId === "m1")).toHaveLength(1)
  })

  test("deleting one session clears later recall for that session", () => {
    put(db, "A", "ma", 0, words(80, "cleanup"))
    put(db, "B", "mb", 0, words(80, "cleanup"))

    db.prepare("DELETE FROM memory_session_vectors WHERE session_id = ?").run("A")

    expect(recall(db, "A", words(80, "cleanup"), 5)).toEqual([])
    expect(recall(db, "B", words(80, "cleanup"), 5).map((row) => row.msgId)).toEqual(["mb"])
  })

  test("token estimate stays below threshold for short text and above it for long text", () => {
    expect(Token.estimate(words(20, "short"))).toBeLessThan(50)
    expect(Token.estimate(words(120, "long"))).toBeGreaterThanOrEqual(50)
  })

  test("no embedder available skips indexing", async () => {
    expect(await append(null, words(120, "skip"))).toBe(false)
  })
})
