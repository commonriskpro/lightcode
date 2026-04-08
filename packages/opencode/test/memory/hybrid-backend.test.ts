import { describe, expect, test } from "bun:test"
import { HybridBackend } from "../../src/memory/hybrid-backend"

process.env.OPENCODE_SKIP_MIGRATIONS = "1"

function item(id: string) {
  return {
    id,
    scope_type: "project" as const,
    scope_id: "p1",
    type: "decision" as const,
    title: id,
    content: id,
    topic_key: null,
    normalized_hash: null,
    revision_count: 1,
    duplicate_count: 1,
    last_seen_at: null,
    deleted_at: null,
    time_created: 1,
    time_updated: 1,
  }
}

function cast<T>(value: unknown): T {
  return value as T
}

class StubFTS {
  constructor(private list: ReturnType<typeof item>[]) {}
  async index() {
    return "fts"
  }
  async search() {
    return this.list
  }
  async remove() {}
}

class StubVec {
  constructor(private list: ReturnType<typeof item>[]) {}
  async index() {
    return "vec"
  }
  async search() {
    return this.list
  }
  async remove() {}
}

describe("HybridBackend", () => {
  test("no embedding backend returns FTS5 output as-is", async () => {
    const a = item("A")
    const b = item("B")
    const backend = new HybridBackend(cast(new StubFTS([a, b])), null)

    expect(await backend.search("q", [], 5)).toEqual([a, b])
  })

  test("both backends combine overlapping results and rank overlap higher", async () => {
    const a = item("A")
    const b = item("B")
    const c = item("C")
    const d = item("D")
    const backend = new HybridBackend(cast(new StubFTS([a, b, c])), cast(new StubVec([c, d, a])))

    const result = await backend.search("q", [{ type: "project", id: "p1" }], 4)

    expect(result.map((x) => x.id)).toEqual(["A", "C", "B", "D"])
  })

  test("both backends empty returns []", async () => {
    const backend = new HybridBackend(cast(new StubFTS([])), cast(new StubVec([])))

    expect(await backend.search("q", [{ type: "project", id: "p1" }], 3)).toEqual([])
  })

  test("RRF with limit=3 prioritizes artifacts that appear in both lists", async () => {
    const a = item("A")
    const b = item("B")
    const c = item("C")
    const d = item("D")
    const backend = new HybridBackend(cast(new StubFTS([a, b, c])), cast(new StubVec([c, d, a])))

    const result = await backend.search("q", [{ type: "project", id: "p1" }], 3)

    expect(result[0]?.id).toBe("A")
    expect(result[1]?.id).toBe("C")
    expect(result).toHaveLength(3)
  })
})
