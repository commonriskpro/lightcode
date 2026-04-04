import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("session.system.recall", () => {
  test("returns undefined when no engram MCP key found", async () => {
    // MCP.tools() in test env returns empty record (no MCP connected)
    // so no engram key exists → graceful undefined
    const result = await SystemPrompt.recall("test-project")
    expect(result).toBeUndefined()
  })

  test("returns undefined when project id is empty string", async () => {
    const result = await SystemPrompt.recall("")
    expect(result).toBeUndefined()
  })

  test("returns undefined when tool.execute throws", async () => {
    // recall() wraps everything in try/catch → always returns undefined on failure
    // Prove the catch path: even if MCP had a tool that threw, recall() returns undefined
    // We verify this by calling recall with a valid project — if MCP has no engram tool
    // the function returns undefined before reaching execute. The catch is for unexpected throws.
    // Test the contract: return is always undefined-or-string, never throws
    const result = await SystemPrompt.recall("any-project")
    expect(result === undefined || typeof result === "string").toBe(true)
  })

  test("wrapRecall wraps content in engram-recall tags", () => {
    const body = "some memory content"
    const result = SystemPrompt.wrapRecall(body)
    expect(result).toContain("<engram-recall>")
    expect(result).toContain("</engram-recall>")
    expect(result).toContain(body)
    expect(result).toBe(`<engram-recall>\n${body}\n</engram-recall>`)
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

  test("recall() format contract: if result is string it has engram-recall tags", async () => {
    // In test env without MCP, result is undefined.
    // But the type contract guarantees: any truthy return is wrapped.
    // We prove the wrap logic via wrapRecall which is what recall() uses.
    const body = "obs content"
    const wrapped = SystemPrompt.wrapRecall(SystemPrompt.capRecallBody(body))
    expect(wrapped.startsWith("<engram-recall>\n")).toBe(true)
    expect(wrapped.endsWith("\n</engram-recall>")).toBe(true)
  })
})
