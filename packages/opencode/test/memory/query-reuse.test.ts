import { describe, expect, test } from "bun:test"
import { QueryReuse } from "../../src/memory/query-reuse"

describe("memory.query-reuse", () => {
  test("reuses recall for short same-topic follow-up", () => {
    expect(QueryReuse.reuse({ query: "auth architecture", norm: "auth architecture" }, "auth?")).toBe(true)
  })

  test("does not reuse recall on topic shift", () => {
    expect(QueryReuse.reuse({ query: "auth architecture", norm: "auth architecture" }, "release pipeline")).toBe(false)
  })

  test("does not reuse recall for long new query", () => {
    expect(
      QueryReuse.reuse(
        { query: "auth architecture", norm: "auth architecture" },
        "please compare the auth architecture, deployment pipeline, ci strategy, provider behavior and full release plan in detail",
      ),
    ).toBe(false)
  })
})
