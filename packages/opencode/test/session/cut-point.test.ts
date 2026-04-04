import { describe, test, expect } from "bun:test"
import { CutPoint } from "../../src/session/cut-point"
import type { MessageV2 } from "../../src/session/message-v2"

function msg(role: "user" | "assistant", text: string, opts?: Partial<MessageV2.Info>): MessageV2.WithParts {
  const base = {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    sessionID: "test-session",
    time: { created: Date.now() },
  } as any
  return {
    info: { ...base, ...opts },
    parts: [{ type: "text", text, id: "p1", messageID: base.id, sessionID: base.id }] as any[],
  }
}

function toolMsg(input: string, output: string): MessageV2.WithParts {
  const id = `msg-${Math.random().toString(36).slice(2, 8)}`
  return {
    info: {
      id,
      role: "assistant",
      sessionID: "test-session",
      time: { created: Date.now() },
      finish: "tool-calls",
    } as any,
    parts: [
      {
        type: "tool",
        tool: "read",
        id: "t1",
        messageID: id,
        sessionID: "test-session",
        state: { status: "completed", input: JSON.stringify({ path: input }), output, time: { start: 0, end: 1 } },
      } as any,
    ],
  }
}

function compactionMsg(): MessageV2.WithParts {
  const id = `msg-${Math.random().toString(36).slice(2, 8)}`
  return {
    info: { id, role: "user", sessionID: "test-session", time: { created: Date.now() } } as any,
    parts: [{ type: "compaction", id: "c1", messageID: id, sessionID: "test-session", auto: true } as any],
  }
}

function summaryMsg(): MessageV2.WithParts {
  const id = `msg-${Math.random().toString(36).slice(2, 8)}`
  return {
    info: {
      id,
      role: "assistant",
      sessionID: "test-session",
      time: { created: Date.now() },
      summary: true,
      finish: "stop",
    } as any,
    parts: [{ type: "text", text: "## Goal\nDo things", id: "s1", messageID: id, sessionID: "test-session" } as any],
  }
}

// Helper: generate a message with roughly N tokens of content (4 chars per token)
function bigMsg(role: "user" | "assistant", tokens: number): MessageV2.WithParts {
  return msg(role, "x".repeat(tokens * 4), role === "assistant" ? { finish: "stop" } : {})
}

describe("CutPoint.find", () => {
  test("returns type:full when conversation has < 3 messages", () => {
    const msgs = [msg("user", "hello"), msg("assistant", "hi", { finish: "stop" })]
    const result = CutPoint.find(msgs, 1000)
    expect(result.type).toBe("full")
    expect(result.keep).toEqual([])
  })

  test("returns type:full when conversation is very short (below keepTokens)", () => {
    const msgs = [msg("user", "short"), msg("assistant", "reply", { finish: "stop" }), msg("user", "another")]
    const result = CutPoint.find(msgs, 100_000)
    expect(result.type).toBe("full")
  })

  test("returns type:cut with correct split for conversation exceeding keepTokens", () => {
    // 5 messages, each ~5000 tokens (20000 chars). keepTokens = 15000
    const msgs = [
      bigMsg("user", 5000),
      bigMsg("assistant", 5000),
      bigMsg("user", 5000),
      bigMsg("assistant", 5000),
      bigMsg("user", 5000),
    ]
    const result = CutPoint.find(msgs, 15_000)
    expect(result.type).toBe("cut")
    expect(result.summarize.length).toBeGreaterThan(0)
    expect(result.keep.length).toBeGreaterThan(0)
    expect(result.summarize.length + result.keep.length).toBe(msgs.length)
  })

  test("respects keepTokens budget — keeps approximately the requested amount", () => {
    const msgs = [
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
    ]
    const result = CutPoint.find(msgs, 10_000)
    expect(result.type).toBe("cut")
    // With 3000 tokens per msg and keepTokens=10000, we should keep ~3-4 messages
    expect(result.keep.length).toBeGreaterThanOrEqual(3)
    expect(result.keep.length).toBeLessThanOrEqual(5)
  })

  test("skips compaction messages as cut point candidates", () => {
    const msgs = [
      bigMsg("user", 5000),
      bigMsg("assistant", 5000), // finish: "stop" from bigMsg
      compactionMsg(),
      summaryMsg(),
      bigMsg("user", 5000),
      bigMsg("assistant", 5000), // finish: "stop" from bigMsg
      bigMsg("user", 5000),
      bigMsg("assistant", 5000), // finish: "stop" from bigMsg
      bigMsg("user", 5000),
    ]
    const result = CutPoint.find(msgs, 15_000)
    expect(result.type).toBe("cut")
    if (result.cutIndex !== undefined) {
      const atCut = msgs[result.cutIndex]
      expect(atCut.parts.some((p) => p.type === "compaction")).toBe(false)
    }
  })

  test("returns type:full when no valid cut boundary exists", () => {
    // Only tool results after the budget boundary — no valid user/assistant cut
    const msgs = [bigMsg("user", 20000), toolMsg("/big/file.ts", "x".repeat(80000))]
    const result = CutPoint.find(msgs, 5_000)
    // Only 2 messages, cutIndex would be <= 1, so falls back to full
    expect(result.type).toBe("full")
  })

  test("cut point falls on a user message boundary", () => {
    const msgs = [
      bigMsg("user", 4000),
      bigMsg("assistant", 4000), // finish: "stop"
      bigMsg("user", 4000),
      bigMsg("assistant", 4000), // finish: "stop"
      bigMsg("user", 4000),
      bigMsg("assistant", 4000), // finish: "stop"
      bigMsg("user", 4000),
    ]
    const result = CutPoint.find(msgs, 12_000)
    expect(result.type).toBe("cut")
    if (result.cutIndex !== undefined) {
      const atCut = msgs[result.cutIndex]
      // Cut should land on a user message
      expect(atCut.info.role).toBe("user")
    }
  })

  test("summarize + keep equals original message list", () => {
    const msgs = [
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
      bigMsg("user", 3000),
      bigMsg("assistant", 3000),
    ]
    const result = CutPoint.find(msgs, 8_000)
    expect(result.type).toBe("cut")
    expect([...result.summarize, ...result.keep]).toEqual(msgs)
  })

  test("default keepTokens is 20000 when not specified", () => {
    // 10 messages of 5000 tokens each = 50000 total. Default keep = 20000
    const msgs = Array.from({ length: 10 }, (_, i) => bigMsg(i % 2 === 0 ? "user" : "assistant", 5000))
    // Set finish on assistant msgs
    msgs
      .filter((m) => m.info.role === "assistant")
      .forEach((m) => {
        ;(m.info as any).finish = "stop"
      })
    const result = CutPoint.find(msgs)
    expect(result.type).toBe("cut")
    // With 5000 tokens per msg, keepTokens=20000 should keep ~4 messages
    expect(result.keep.length).toBeGreaterThanOrEqual(3)
    expect(result.keep.length).toBeLessThanOrEqual(6)
  })
})
