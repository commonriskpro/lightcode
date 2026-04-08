import { createClient } from "@libsql/client"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const scope = { type: "project", id: "p1" } as const

const emb = (text: string) => {
  const vec = new Array(384).fill(0)
  for (let i = 0; i < text.length; i++) vec[i % 384] += text.charCodeAt(i) / 1000
  const mag = Math.sqrt(vec.reduce((sum, item) => sum + item * item, 0)) || 1
  return vec.map((item) => item / mag)
}

const dist = (a: string, b: string) => {
  const x = emb(a)
  const y = emb(b)
  return 1 - x.reduce((sum, item, i) => sum + item * y[i]!, 0)
}

const put = async (
  db: ReturnType<typeof createClient>,
  id: string,
  title: string,
  content: string,
  scopeId: string = scope.id,
) => {
  const now = Date.now()
  await db.execute({
    sql: `INSERT INTO memory_artifacts (
      id,
      scope_type,
      scope_id,
      type,
      title,
      content,
      topic_key,
      normalized_hash,
      embedding,
      revision_count,
      duplicate_count,
      last_seen_at,
      deleted_at,
      time_created,
      time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, vector32(?), ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      scope.type,
      scopeId,
      "decision",
      title,
      content,
      null,
      null,
      JSON.stringify(emb(content)),
      1,
      1,
      null,
      null,
      now,
      now,
    ],
  })
}

const search = async (db: ReturnType<typeof createClient>, text: string, limit: number) => {
  const rows = await db.execute({
    sql: `SELECT id, title, content, vector_distance_cos(embedding, vector32(?)) AS dist
      FROM memory_artifacts
      WHERE embedding IS NOT NULL
        AND deleted_at IS NULL
        AND scope_type = ?
        AND scope_id = ?
      ORDER BY dist ASC
      LIMIT ?`,
    args: [JSON.stringify(emb(text)), scope.type, scope.id, limit],
  })
  return rows.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    dist: Number(row.dist),
  }))
}

describe("EmbeddingBackend SQL semantics", () => {
  let dir: string
  let file: string
  let db: ReturnType<typeof createClient>

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ltc-emb-"))
    file = path.join(dir, "test.db")
    db = createClient({ url: `file:${file}`, intMode: "number" })
    await db.execute(`CREATE TABLE memory_artifacts (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      topic_key TEXT,
      normalized_hash TEXT,
      embedding F32_BLOB(384),
      revision_count INTEGER DEFAULT 1,
      duplicate_count INTEGER DEFAULT 1,
      last_seen_at INTEGER,
      deleted_at INTEGER,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    )`)
  })

  beforeEach(async () => {
    await db.execute("DELETE FROM memory_artifacts")
  })

  afterAll(async () => {
    await db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns all inserted artifacts ordered by cosine distance", async () => {
    const qry = "jwt auth decision"
    await put(db, "a", "JWT auth", "jwt auth decision for session refresh")
    await put(db, "b", "Billing", "billing ledger reconciliation and invoice retries")
    await put(db, "c", "Theme", "kanagawa blur theme tokens and palette mapping")

    const rows = await search(db, qry, 3)

    const want = [
      { id: "a", dist: dist(qry, "jwt auth decision for session refresh") },
      { id: "b", dist: dist(qry, "billing ledger reconciliation and invoice retries") },
      { id: "c", dist: dist(qry, "kanagawa blur theme tokens and palette mapping") },
    ]
      .sort((a, b) => a.dist - b.dist)
      .map((row) => row.id)

    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.id)).toEqual(want)
    expect(rows[0]!.dist).toBeLessThanOrEqual(rows[1]!.dist)
    expect(rows[1]!.dist).toBeLessThanOrEqual(rows[2]!.dist)
  })

  test("scope filtering happens in the same query", async () => {
    await put(db, "a", "JWT auth", "jwt auth decision for session refresh", "p1")
    await put(db, "b", "JWT auth", "oauth refresh flow for another scope", "p2")

    const rows = await search(db, "jwt auth", 5)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("a")
  })

  test("deleted rows disappear from later vector queries", async () => {
    await put(db, "a", "JWT auth", "jwt auth decision for session refresh")
    await put(db, "b", "Billing", "billing ledger reconciliation and invoice retries")

    await db.execute({
      sql: "UPDATE memory_artifacts SET deleted_at = ? WHERE id = ?",
      args: [Date.now(), "b"],
    })

    const rows = await search(db, "billing invoice retries", 3)

    expect(rows.map((row) => row.id)).not.toContain("b")
  })
})
