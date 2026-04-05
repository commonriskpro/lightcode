import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Note: SystemPrompt.recall() was removed in the final memory cleanup (V4).
// The canonical recall path is now Memory.buildContext({ semanticQuery, ... })
// called from prompt.ts at step===1. The tests below verify the remaining
// SystemPrompt helpers that are still in use.

describe("session.system.wrapRecall", () => {
  test("wrapRecall wraps content in memory-recall tags (renamed from engram-recall in V4)", () => {
    const body = "some memory content"
    const result = SystemPrompt.wrapRecall(body)
    expect(result).toContain("<memory-recall>")
    expect(result).toContain("</memory-recall>")
    expect(result).toContain(body)
    expect(result).toBe(`<memory-recall>\n${body}\n</memory-recall>`)
  })

  test("capRecallBody passes through content under 2000 tokens", () => {
    const small = "a".repeat(100)
    expect(SystemPrompt.capRecallBody(small)).toBe(small)
  })

  test("capRecallBody caps content at 2000 tokens (8000 chars)", () => {
    // Token.estimate uses 4 chars per token
    // A 10000-char string exceeds 2000 tokens → sliced to cap*4 = 8000 chars
    const large = "a".repeat(10_000)
    const result = SystemPrompt.capRecallBody(large)
    expect(result.length).toBe(8_000)
    expect(result.length).toBeLessThan(large.length)
  })

  test("capRecallBody does not truncate exactly at cap boundary", () => {
    // 8000 chars = exactly 2000 tokens → not over cap → no truncation
    const exact = "a".repeat(8_000)
    expect(SystemPrompt.capRecallBody(exact)).toBe(exact)
  })

  test("wrapRecall uses <memory-recall> not <engram-recall> (V4 cleanup)", () => {
    const result = SystemPrompt.wrapRecall("content")
    expect(result).not.toContain("engram-recall")
    expect(result).toContain("memory-recall")
  })
})
