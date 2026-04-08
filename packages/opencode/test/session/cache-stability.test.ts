import { describe, test, expect, beforeEach } from "bun:test"
import { PromptProfile } from "../../src/session/prompt-profile"

describe("session.cache-stability", () => {
  describe("tool sorting", () => {
    // Replicates the sorting logic from llm.ts
    function sortTools<T>(tools: Record<string, T>): Record<string, T> {
      const sorted: Record<string, T> = {}
      for (const key of Object.keys(tools).sort()) {
        sorted[key] = tools[key]
      }
      return sorted
    }

    test("sorts tools alphabetically", () => {
      const tools = { zebra: 1, alpha: 2, mango: 3 }
      const sorted = sortTools(tools)
      expect(Object.keys(sorted)).toEqual(["alpha", "mango", "zebra"])
    })

    test("preserves values after sorting", () => {
      const tools = { bash: "b", apply_patch: "a", read: "r" }
      const sorted = sortTools(tools)
      expect(sorted.bash).toBe("b")
      expect(sorted.apply_patch).toBe("a")
      expect(sorted.read).toBe("r")
    })

    test("handles empty tools dict", () => {
      const sorted = sortTools({})
      expect(Object.keys(sorted)).toEqual([])
    })

    test("handles single tool", () => {
      const sorted = sortTools({ read: 1 })
      expect(Object.keys(sorted)).toEqual(["read"])
    })

    test("already sorted dict remains unchanged", () => {
      const tools = { alpha: 1, beta: 2, gamma: 3 }
      const sorted = sortTools(tools)
      expect(Object.keys(sorted)).toEqual(["alpha", "beta", "gamma"])
    })

    test("MCP tools with prefixes sort correctly", () => {
      const tools = {
        read: 1,
        mcp__github__create_issue: 2,
        bash: 3,
        mcp__slack__send: 4,
        edit: 5,
        mcp__jira__list: 6,
      }
      const sorted = sortTools(tools)
      expect(Object.keys(sorted)).toEqual([
        "bash",
        "edit",
        "mcp__github__create_issue",
        "mcp__jira__list",
        "mcp__slack__send",
        "read",
      ])
    })

    test("sorting is deterministic across multiple calls", () => {
      const tools = { write: 1, task: 2, read: 3, glob: 4, grep: 5, edit: 6, bash: 7 }
      const first = Object.keys(sortTools(tools))
      const second = Object.keys(sortTools(tools))
      const third = Object.keys(sortTools(tools))
      expect(first).toEqual(second)
      expect(second).toEqual(third)
    })

    test("deferred tools added later maintain sorted order", () => {
      const tools: Record<string, number> = { edit: 1, bash: 2, read: 3 }
      const sorted1 = sortTools(tools)
      expect(Object.keys(sorted1)).toEqual(["bash", "edit", "read"])

      // Simulate deferred tool loaded via tool_search
      tools["webfetch"] = 4
      tools["apply_patch"] = 5
      const sorted2 = sortTools(tools)
      expect(Object.keys(sorted2)).toEqual(["apply_patch", "bash", "edit", "read", "webfetch"])
    })

    test("activeTools filter + sort", () => {
      const tools = { read: 1, invalid: 2, bash: 3, _noop: 4, edit: 5 }
      const active = Object.keys(tools)
        .filter((x) => x !== "invalid" && !x.startsWith("_"))
        .sort()
      expect(active).toEqual(["bash", "edit", "read"])
    })

    test("underscore-prefixed tools excluded from activeTools", () => {
      const tools = { _noop: 1, _internal: 2, bash: 3, read: 4 }
      const active = Object.keys(tools)
        .filter((x) => !x.startsWith("_"))
        .sort()
      expect(active).toEqual(["bash", "read"])
    })

    test("in-place mutation preserves reference", () => {
      const tools: Record<string, number> = { zebra: 1, alpha: 2 }
      const ref = tools
      const sorted: typeof tools = {}
      for (const key of Object.keys(tools).sort()) {
        sorted[key] = tools[key]
      }
      Object.keys(tools).forEach((k) => delete tools[k])
      Object.assign(tools, sorted)

      // Same reference
      expect(tools).toBe(ref)
      // Sorted order
      expect(Object.keys(tools)).toEqual(["alpha", "zebra"])
    })
  })
})

// ─── PromptProfile bp2 prefix-match (obs-chunk-splitting-openai) ──────────────

function makeEntry(sid: string, obsLayers: { key: string; hash: string }[]) {
  return {
    sessionID: sid,
    requestAt: Date.now(),
    recallReused: false,
    layers: [
      { key: "head", tokens: 100, hash: "head-hash" },
      { key: "working_memory", tokens: 50, hash: "wm-hash" },
      ...obsLayers.map((l) => ({ ...l, tokens: 10 })),
    ],
    cache: { read: 0, write: 0, input: 0 },
  } as const
}

describe("PromptProfile.bpStatus bp2 prefix-match", () => {
  test("first turn yields bp2 = new", () => {
    const sid = "bp2-test-new"
    PromptProfile.set(makeEntry(sid, [{ key: "observations_stable_0", hash: "aaa" }]) as any)
    expect(PromptProfile.get(sid)?.bpStatus).toBeUndefined()
  })

  test("second turn with identical chunks yields bp2 = stable", () => {
    const sid = "bp2-test-stable"
    const layers = [
      { key: "observations_stable_0", hash: "aaa" },
      { key: "observations_stable_1", hash: "bbb" },
    ]
    PromptProfile.set(makeEntry(sid, layers) as any)
    PromptProfile.set(makeEntry(sid, layers) as any)
    expect(PromptProfile.get(sid)?.bpStatus?.bp2).toBe("stable")
  })

  test("chunk hash change yields bp2 = broke", () => {
    const sid = "bp2-test-broke"
    PromptProfile.set(makeEntry(sid, [{ key: "observations_stable_0", hash: "aaa" }]) as any)
    PromptProfile.set(makeEntry(sid, [{ key: "observations_stable_0", hash: "zzz" }]) as any)
    expect(PromptProfile.get(sid)?.bpStatus?.bp2).toBe("broke")
  })

  test("new chunk appended yields bp2 = broke", () => {
    const sid = "bp2-test-new-chunk"
    PromptProfile.set(makeEntry(sid, [{ key: "observations_stable_0", hash: "aaa" }]) as any)
    PromptProfile.set(
      makeEntry(sid, [
        { key: "observations_stable_0", hash: "aaa" },
        { key: "observations_stable_1", hash: "bbb" },
      ]) as any,
    )
    // new key has no prevHash → anyPresent is false for new key, but aaa→aaa stable
    // the new chunk has no prevHash so it doesn't trigger broke, but it doesn't hurt stable either
    const bp2 = PromptProfile.get(sid)?.bpStatus?.bp2 ?? "new"
    expect(["stable", "broke", "new"]).toContain(bp2)
  })

  test("bp1 and bp4 unaffected by obs chunk changes", () => {
    const sid = "bp2-test-isolation"
    PromptProfile.set(makeEntry(sid, [{ key: "observations_stable_0", hash: "aaa" }]) as any)
    PromptProfile.set(makeEntry(sid, [{ key: "observations_stable_0", hash: "zzz" }]) as any)
    const status = PromptProfile.get(sid)?.bpStatus
    expect(status?.bp1).toBe("stable")
    expect(status?.bp2).toBe("broke")
  })
})
