import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"

process.env.OPENCODE_SKIP_MIGRATIONS = "1"

const scope = { type: "project" as const, id: "p1" }

let Database: typeof import("../../src/storage/db").Database
let FTS5Backend: typeof import("../../src/memory/fts5-backend").FTS5Backend

async function reset() {
  const db = await Database.Client()
  await db.$client.execute("DROP TRIGGER IF EXISTS art_fts_insert")
  await db.$client.execute("DROP TRIGGER IF EXISTS art_fts_update")
  await db.$client.execute("DROP TRIGGER IF EXISTS art_fts_delete")
  await db.$client.execute("DROP TABLE IF EXISTS memory_artifacts_fts")
  await db.$client.execute("DROP TABLE IF EXISTS memory_artifacts")
  await boot()
}

async function boot() {
  const db = await Database.Client()
  await db.$client.execute(`CREATE TABLE IF NOT EXISTS memory_artifacts (
      id text PRIMARY KEY,
      scope_type text NOT NULL,
      scope_id text NOT NULL,
      type text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      topic_key text,
      normalized_hash text,
      embedding F32_BLOB(384),
      revision_count integer NOT NULL DEFAULT 1,
      duplicate_count integer NOT NULL DEFAULT 1,
      last_seen_at integer,
      deleted_at integer,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    )`)
  await db.$client.execute(
    "CREATE VIRTUAL TABLE IF NOT EXISTS memory_artifacts_fts USING fts5(title, content, topic_key, type, scope_type, scope_id, content='memory_artifacts', content_rowid='rowid')",
  )
  await db.$client.execute(
    "CREATE TRIGGER IF NOT EXISTS art_fts_insert AFTER INSERT ON memory_artifacts BEGIN INSERT INTO memory_artifacts_fts(rowid, title, content, topic_key, type, scope_type, scope_id) VALUES (new.rowid, new.title, new.content, new.topic_key, new.type, new.scope_type, new.scope_id); END",
  )
  await db.$client.execute(
    "CREATE TRIGGER IF NOT EXISTS art_fts_update AFTER UPDATE ON memory_artifacts BEGIN INSERT INTO memory_artifacts_fts(memory_artifacts_fts, rowid, title, content, topic_key, type, scope_type, scope_id) VALUES ('delete', old.rowid, old.title, old.content, old.topic_key, old.type, old.scope_type, old.scope_id); INSERT INTO memory_artifacts_fts(rowid, title, content, topic_key, type, scope_type, scope_id) VALUES (new.rowid, new.title, new.content, new.topic_key, new.type, new.scope_type, new.scope_id); END",
  )
  await db.$client.execute(
    "CREATE TRIGGER IF NOT EXISTS art_fts_delete AFTER DELETE ON memory_artifacts BEGIN INSERT INTO memory_artifacts_fts(memory_artifacts_fts, rowid, title, content, topic_key, type, scope_type, scope_id) VALUES ('delete', old.rowid, old.title, old.content, old.topic_key, old.type, old.scope_type, old.scope_id); END",
  )
}

async function row(id: string) {
  const db = await Database.Client()
  const res = await db.$client.execute({
    sql: "SELECT id, revision_count, deleted_at FROM memory_artifacts WHERE id = ?",
    args: [id],
  })
  const val = res.rows[0]
  if (!val) return
  return {
    id: String(val.id),
    revision_count: Number(val.revision_count),
    deleted_at: val.deleted_at === null ? null : Number(val.deleted_at),
  }
}

function art(content: string, topic?: string | null) {
  return {
    scope_type: scope.type,
    scope_id: scope.id,
    type: "decision" as const,
    title: content,
    content,
    topic_key: topic ?? null,
    normalized_hash: null,
    revision_count: 1,
    duplicate_count: 1,
    last_seen_at: null,
    deleted_at: null,
  }
}

beforeEach(async () => {
  await reset()
})

beforeAll(async () => {
  ;({ Database } = await import("../../src/storage/db"))
  ;({ FTS5Backend } = await import("../../src/memory/fts5-backend"))
  await reset()
})

afterAll(() => {
  delete process.env.OPENCODE_SKIP_MIGRATIONS
})

describe("FTS5Backend", () => {
  test("search on empty backend returns []", async () => {
    const fts = new FTS5Backend()

    expect(await fts.search("typescript auth", [scope], 5)).toEqual([])
  })

  test("index + search finds the artifact via exact keyword", async () => {
    const fts = new FTS5Backend()
    const id = await fts.index(art("TypeScript architecture decision for auth flow"))

    const result = await fts.search("TypeScript auth", [scope], 5)

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(id)
  })

  test("prefix search finds the artifact via two-pass OR fallback", async () => {
    const fts = new FTS5Backend()
    const id = await fts.index(art("TypeScript architecture decision for auth flow"))

    const result = await fts.search("TypeScript arch", [scope], 5)

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(id)
  })

  test("topic_key re-index increments revision_count and reuses the id", async () => {
    const fts = new FTS5Backend()
    const first = await fts.index(art("Version one", "auth/jwt"))
    const second = await fts.index(art("Version two", "auth/jwt"))

    expect(second).toBe(first)
    expect((await row(first))?.revision_count).toBe(2)

    const result = await fts.search("auth/jwt", [scope], 5)
    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe("Version two")
  })

  test("soft delete makes the artifact disappear from search", async () => {
    const fts = new FTS5Backend()
    const id = await fts.index(art("Delete me from search results"))

    await fts.remove(id)

    expect((await row(id))?.deleted_at).not.toBeNull()
    expect(await fts.search("Delete me", [scope], 5)).toEqual([])
  })
})
