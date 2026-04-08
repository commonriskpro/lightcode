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
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import * as sqliteVec from "sqlite-vec"

process.env.OPENCODE_SKIP_MIGRATIONS = "1"

const scope = { type: "project", id: "p1" } as const

const emb = (text: string) => {
  const v = new Array(384).fill(0)
  for (let i = 0; i < text.length; i++) v[i % 384] += text.charCodeAt(i) / 1000
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1
  return v.map((x) => x / mag)
}

const dist = (a: string, b: string) => {
  const x = emb(a)
  const y = emb(b)
  return 1 - x.reduce((sum, n, i) => sum + n * y[i]!, 0)
}

const probe = (db: BunDB) =>
  Promise.resolve()
    .then(() => db.prepare("SELECT 1 FROM memory_artifacts_vec LIMIT 0").get())
    .then(() => true)
    .catch(() => false)

const fail = (db: BunDB) =>
  Promise.resolve()
    .then(() => db.prepare("SELECT 1 FROM memory_artifacts_vec LIMIT 0").get())
    .then(() => null)
    .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))

const put = (db: BunDB, id: string, title: string, content: string, scopeId = scope.id) => {
  const now = Date.now()
  db.prepare(
    `INSERT INTO memory_artifacts (
      id,
      scope_type,
      scope_id,
      type,
      title,
      content,
      topic_key,
      normalized_hash,
      revision_count,
      duplicate_count,
      last_seen_at,
      deleted_at,
      time_created,
      time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, scope.type, scopeId, "decision", title, content, null, null, 1, 1, null, null, now, now)
  db.prepare("INSERT INTO memory_artifacts_vec(artifact_id, embedding) VALUES (?, ?)").run(
    id,
    new Float32Array(emb(content)),
  )
}

const search = (db: BunDB, text: string, limit: number) => {
  const rows = db
    .prepare(
      `SELECT artifact_id, distance
       FROM memory_artifacts_vec
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(new Float32Array(emb(text)), limit * 3) as { artifact_id: string; distance: number }[]

  const ids = rows.map((row) => row.artifact_id)
  if (!ids.length) return []

  const marks = ids.map(() => "?").join(", ")
  const list = db
    .prepare(
      `SELECT id, title, content
       FROM memory_artifacts
       WHERE deleted_at IS NULL
         AND scope_type = ?
         AND scope_id = ?
         AND id IN (${marks})`,
    )
    .all(scope.type, scope.id, ...ids) as { id: string; title: string; content: string }[]

  const by = new Map(list.map((row) => [row.id, row]))

  return rows
    .map((row) => ({ ...row, art: by.get(row.artifact_id) }))
    .filter(
      (row): row is { artifact_id: string; distance: number; art: { id: string; title: string; content: string } } =>
        Boolean(row.art),
    )
    .slice(0, limit)
}

describe("EmbeddingBackend SQL semantics", () => {
  let dir: string
  let file: string
  let db: BunDB

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ltc-emb-"))
    file = path.join(dir, "test.db")
    process.env.OPENCODE_DB = file
    // @ts-expect-error Bun runtime supports enableExtensions
    db = new BunDB(file, { create: true, enableExtensions: true })
    sqliteVec.load(db)
    db.run(`
      CREATE TABLE memory_artifacts (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        topic_key TEXT,
        normalized_hash TEXT,
        revision_count INTEGER DEFAULT 1,
        duplicate_count INTEGER DEFAULT 1,
        last_seen_at INTEGER,
        deleted_at INTEGER,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE VIRTUAL TABLE memory_artifacts_vec USING vec0(
        artifact_id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      )
    `)
  })

  beforeEach(() => {
    db.run("DELETE FROM memory_artifacts_vec")
    db.run("DELETE FROM memory_artifacts")
  })

  afterAll(() => {
    db.close()
  })

  test("returns all inserted artifacts ordered by cosine distance", () => {
    const qry = "jwt auth decision"
    const all = [
      ["a", "JWT auth", "jwt auth decision for session refresh"],
      ["b", "Billing", "billing ledger reconciliation and invoice retries"],
      ["c", "Theme", "kanagawa blur theme tokens and palette mapping"],
    ] as const

    all.forEach(([id, title, text]) => put(db, id, title, text))

    const rows = search(db, qry, 3)
    const want = [...all]
      .map(([id, _title, text]) => ({ id, dist: dist(qry, text) }))
      .sort((a, b) => a.dist - b.dist)
      .map((row) => row.id)

    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.art.id)).toEqual(want)
    expect(rows[0]!.distance).toBeLessThanOrEqual(rows[1]!.distance)
    expect(rows[1]!.distance).toBeLessThanOrEqual(rows[2]!.distance)
  })

  test("similar query ranks the closest artifact first", () => {
    put(db, "a", "JWT auth", "jwt jwt jwt jwt jwt jwt")
    put(db, "b", "OAuth", "oauth oauth oauth oauth oauth oauth")
    put(db, "c", "Billing", "billing billing billing billing billing billing")

    const rows = search(db, "oauth oauth oauth oauth oauth oauth", 3)

    expect(rows[0]?.art.id).toBe("b")
  })

  test("deleted vec rows disappear from later KNN queries", () => {
    put(db, "a", "JWT auth", "jwt auth decision for session refresh")
    put(db, "b", "Billing", "billing ledger reconciliation and invoice retries")
    put(db, "c", "Theme", "kanagawa blur theme tokens and palette mapping")

    db.prepare("DELETE FROM memory_artifacts_vec WHERE artifact_id = ?").run("b")

    const rows = search(db, "billing invoice retries", 3)

    expect(rows.map((row) => row.art.id)).not.toContain("b")
  })

  test("missing vec table reports no such table and probe degrades to false", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ltc-emb-miss-"))
    const file = path.join(dir, "test.db")
    // @ts-expect-error Bun runtime supports enableExtensions
    const miss = new BunDB(file, { create: true, enableExtensions: true })
    sqliteVec.load(miss)
    miss.run("CREATE TABLE memory_artifacts (id TEXT PRIMARY KEY)")

    const err = await fail(miss)
    expect(err?.message).toContain("no such table")
    expect(await probe(miss)).toBe(false)

    miss.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
