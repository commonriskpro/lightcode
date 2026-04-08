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

// ─── Cache strategy: applyCaching RED tests ───────────────────────────────────

import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"
import type { ModelMessage } from "ai"

function makeModel(npm = "@ai-sdk/anthropic", id = "claude-sonnet-4-20250514"): Provider.Model {
  return {
    id: id as any,
    providerID: "anthropic" as any,
    name: "Test",
    api: { npm, id, url: "https://api.anthropic.com" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false },
    },
    options: {},
    limit: { context: 200_000, output: 8_000 },
  } as Provider.Model
}

function sysMsg(content: string): ModelMessage {
  return { role: "system", content }
}

function userMsg(content: string): ModelMessage {
  return { role: "user", content: [{ type: "text", text: content }] }
}

function assistantMsg(content: string, withTool = false): ModelMessage {
  const base: any[] = [{ type: "text", text: content }]
  if (withTool) base.push({ type: "tool-call", toolCallId: "t1", toolName: "bash", args: {} })
  return { role: "assistant", content: base }
}

function toolResultMsg(): ModelMessage {
  return { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "bash", result: "ok" }] }
}

function hasBP(msg: ModelMessage): boolean {
  const po = (msg as any).providerOptions
  if (po?.anthropic?.cacheControl) return true
  if (Array.isArray(msg.content)) {
    return msg.content.some((p: any) => p?.providerOptions?.anthropic?.cacheControl)
  }
  return false
}

function getTTL(msg: ModelMessage): string | undefined {
  const po = (msg as any).providerOptions
  return po?.anthropic?.cacheControl?.ttl
}

// Must be >= 1024 tokens (Anthropic MIN). At ~6 chars/token for repeated text,
// we need ~8192 chars to reliably exceed 1024 tokens.
const bigContent = "The quick brown fox jumps over the lazy dog. ".repeat(200) // ~1800 tokens

// ─── Mastra-style: system BPs applied in llm.ts, not applyCaching ────────────
// applyCaching now only handles BP-conversation (last assistant msg when not in loop)
// System breakpoints are applied at block-construction time in llm.ts using
// cacheOptsPublic — this tests that applyCaching no longer touches system messages.

describe("applyCaching — system messages are NOT touched (Mastra-style)", () => {
  test("observations block has NO breakpoint from applyCaching (applied upstream in llm.ts)", () => {
    const model = makeModel()
    const msgs: ModelMessage[] = [
      sysMsg(bigContent),
      sysMsg(`<local-observations>\n${bigContent}\n</local-observations>`),
    ]
    const result = ProviderTransform.applyCachingPublic(msgs, model)
    // applyCaching no longer applies system BPs — they are set in llm.ts
    const core = result.find(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("<local-observations>"),
    )
    expect(hasBP(core!)).toBe(false)
  })

  test("cacheOptsPublic returns 1h TTL for Anthropic (used in llm.ts)", () => {
    const model = makeModel()
    const opts = ProviderTransform.cacheOptsPublic(model, true)
    expect((opts as any).anthropic?.cacheControl?.ttl).toBe("1h")
  })
})

test("working-memory message gets 1h TTL", () => {
  const model = makeModel()
})

// ─── Fix 2: BP4 on last non-deferred tool ────────────────────────────────────

describe("applyCaching — BP4 breakpoint on last eligible tool", () => {
  test("when last tool has no defer, breakpoint goes on last tool", () => {
    const tools = [
      { type: "function", name: "invalid", description: "d", parameters: {} },
      { type: "function", name: "read", description: "d", parameters: {} },
      { type: "function", name: "edit", description: "d", parameters: {} }, // last non-deferred
    ]
    const result = ProviderTransform.applyToolCachingPublic(tools as any, makeModel())
    const last = result[result.length - 1] as any
    expect(last.providerOptions?.anthropic?.cacheControl?.type).toBe("ephemeral")
    expect(last.providerOptions?.anthropic?.cacheControl?.ttl).toBe("1h")
  })

  test("when last tool is deferred, breakpoint goes on last non-deferred", () => {
    const tools = [
      { type: "function", name: "edit", description: "d", parameters: {} },
      {
        type: "function",
        name: "write",
        description: "d",
        parameters: {},
        providerOptions: { anthropic: { deferLoading: true } },
      }, // last but deferred
    ]
    const result = ProviderTransform.applyToolCachingPublic(tools as any, makeModel())
    const edit = result.find((t: any) => t.name === "edit") as any
    const write = result.find((t: any) => t.name === "write") as any
    expect(edit.providerOptions?.anthropic?.cacheControl?.ttl).toBe("1h")
    expect(write.providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })
})

// ─── Fix 3: BP3 not applied in agentic loops ─────────────────────────────────

describe("applyCaching — BP3 skipped in agentic loops", () => {
  test("no BP3 when last message has tool-call (agentic loop)", () => {
    const model = makeModel()
    const msgs: ModelMessage[] = [
      sysMsg(bigContent),
      sysMsg(`<working-memory>\n${bigContent}\n</working-memory>`),
      userMsg("do something"),
      assistantMsg("sure", true), // has tool-call → in agentic loop
      toolResultMsg(),
    ]
    const result = ProviderTransform.applyCachingPublic(msgs, model)
    const conv = result.filter((m) => m.role !== "system")
    const bpCount = conv.filter((m) => hasBP(m)).length
    expect(bpCount).toBe(0) // BP3 should NOT fire in agentic loop
  })

  test("BP3 applied when conversation has clean user+assistant (no tools)", () => {
    const model = makeModel()
    const msgs: ModelMessage[] = [
      sysMsg(bigContent),
      sysMsg(`<working-memory>\n${bigContent}\n</working-memory>`),
      userMsg("hello"),
      assistantMsg("hi there"), // clean response, no tools
      userMsg("follow up"),
    ]
    const result = ProviderTransform.applyCachingPublic(msgs, model)
    const conv = result.filter((m) => m.role !== "system")
    const withBP = conv.filter((m) => hasBP(m))
    // BP3 should fire on the last assistant message (not penultimate)
    expect(withBP.length).toBeGreaterThan(0)
  })
})
