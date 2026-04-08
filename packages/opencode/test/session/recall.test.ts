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

  test("capRecallBody caps content and returns at most cap*4 chars", () => {
    // Use realistic varied text so tokenx estimates are above the 2000 token cap.
    // capRecallBody slices to cap*4 chars when token estimate exceeds 2000.
    const line = "The user mentioned they prefer TypeScript over JavaScript for type safety. "
    const large = line.repeat(200) // ~16600 chars → ~3400 tokens, well above cap
    const result = SystemPrompt.capRecallBody(large)
    expect(result.length).toBe(2000 * 4)
    expect(result.length).toBeLessThan(large.length)
  })

  test("capRecallBody does not truncate content under the token cap", () => {
    // Short varied text stays well under 2000 tokens → returned unchanged
    const small = "The user prefers TypeScript. ".repeat(10)
    expect(SystemPrompt.capRecallBody(small)).toBe(small)
  })

  test("wrapRecall uses <memory-recall> not <engram-recall> (V4 cleanup)", () => {
    const result = SystemPrompt.wrapRecall("content")
    expect(result).not.toContain("engram-recall")
    expect(result).toContain("memory-recall")
  })
})
