import { describe, expect, test } from "bun:test"
import {
  lastPromptContextTokens,
  promptTokensForContext,
  sessionTotalRequestTokens,
} from "../../src/cli/cmd/tui/util/session-usage"

describe("session-usage", () => {
  test("lastPromptContextTokens sums input and cache for prompt footprint", () => {
    const messages = [
      { role: "user" as const },
      {
        role: "assistant" as const,
        tokens: { input: 38, output: 10, reasoning: 0, cache: { read: 27924, write: 0 } },
      },
    ]
    expect(lastPromptContextTokens(messages)).toBe(27962)
  })

  test("lastPromptContextTokens uses last assistant with usage", () => {
    const messages = [
      { role: "user" as const },
      {
        role: "assistant" as const,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      { role: "user" as const },
      {
        role: "assistant" as const,
        tokens: { input: 28000, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ]
    expect(lastPromptContextTokens(messages)).toBe(28000)
  })

  test("promptTokensForContext uses total when input slice is underreported", () => {
    const t = {
      total: 2840,
      input: 38,
      output: 120,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }
    expect(promptTokensForContext(t)).toBe(2720)
  })

  test("sessionTotalRequestTokens sums all assistant usage", () => {
    const messages = [
      {
        role: "assistant" as const,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      {
        role: "assistant" as const,
        tokens: { input: 5000, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ]
    expect(sessionTotalRequestTokens(messages)).toBe(100 + 10 + 5000 + 20)
  })
})
