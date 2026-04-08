import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test"

process.env.OPENCODE_SKIP_MIGRATIONS = "1"

let Database: typeof import("../../src/storage/db").Database
let Memory: typeof import("../../src/memory/provider").Memory
let Embedder: typeof import("../../src/memory/embedder").Embedder
let SessionMemory: typeof import("../../src/memory/session-memory").SessionMemory

function reset() {
  Database.use((db) => db.run("DROP TABLE IF EXISTS memory_working"))
  Database.use((db) => db.run("DROP TABLE IF EXISTS memory_artifacts"))
  Database.use((db) => db.run("DROP TABLE IF EXISTS session_observation"))
  boot()
}

function boot() {
  Database.use((db) =>
    db.run(`CREATE TABLE IF NOT EXISTS memory_working (
      id text PRIMARY KEY,
      scope_type text NOT NULL,
      scope_id text NOT NULL,
      key text NOT NULL,
      value text NOT NULL,
      format text NOT NULL DEFAULT 'markdown',
      version integer NOT NULL DEFAULT 1,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    )`),
  )
  Database.use((db) =>
    db.run(`CREATE TABLE IF NOT EXISTS memory_artifacts (
      id text PRIMARY KEY,
      scope_type text NOT NULL,
      scope_id text NOT NULL,
      type text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      topic_key text,
      normalized_hash text,
      revision_count integer NOT NULL DEFAULT 1,
      duplicate_count integer NOT NULL DEFAULT 1,
      last_seen_at integer,
      deleted_at integer,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    )`),
  )
  Database.use((db) =>
    db.run(`CREATE TABLE IF NOT EXISTS session_observation (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      observations text,
      reflections text,
      current_task text,
      suggested_continuation text,
      last_observed_at integer,
      retention_floor_at integer,
      observed_message_ids text,
      generation_count integer NOT NULL DEFAULT 0,
      observation_tokens integer NOT NULL DEFAULT 0,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    )`),
  )
}

beforeEach(() => {
  reset()
})

beforeAll(async () => {
  ;({ Database } = await import("../../src/storage/db"))
  ;({ Memory } = await import("../../src/memory/provider"))
  ;({ Embedder } = await import("../../src/memory/embedder"))
  ;({ SessionMemory } = await import("../../src/memory/session-memory"))
  reset()
})

afterAll(() => {
  delete process.env.OPENCODE_SKIP_MIGRATIONS
})

describe("Memory.buildContext no-embedder integration", () => {
  test("thread scope with semanticQuery leaves sessionRecall undefined when no embedder is configured", async () => {
    const get = spyOn(Embedder, "get").mockResolvedValue(null)

    const result = await Memory.buildContext({
      scope: { type: "thread", id: "t1" },
      ancestorScopes: [{ type: "project", id: "p1" }],
      semanticQuery: "routing recall",
    })

    expect(result.sessionRecall).toBeUndefined()
    get.mockRestore()
  })

  test("non-thread scope leaves sessionRecall undefined", async () => {
    const get = spyOn(Embedder, "get").mockResolvedValue(null)

    const result = await Memory.buildContext({
      scope: { type: "project", id: "p1" },
      semanticQuery: "routing recall",
    })

    expect(result.sessionRecall).toBeUndefined()
    get.mockRestore()
  })

  test("thread scope forwards active msg ids to session recall exclusion", async () => {
    const get = spyOn(Embedder, "get").mockResolvedValue(null)
    const recall = spyOn(SessionMemory, "recall").mockResolvedValue([])

    await Memory.buildContext({
      scope: { type: "thread", id: "t1" },
      ancestorScopes: [{ type: "project", id: "p1" }],
      semanticQuery: "routing recall",
      excludeMsgIds: ["m1", "m2"],
    })

    expect(recall).toHaveBeenCalledWith("t1", "routing recall", 5, ["m1", "m2"])
    recall.mockRestore()
    get.mockRestore()
  })

  test.skip("with embedder configured populates sessionRecall end to end", () => {
    // SKIP: deferred plumbing — provider singleton + embedder wiring makes this too heavy for Phase 4.
  })
})
