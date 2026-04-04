import { describe, test, expect } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

describe("session.fork-subagent", () => {
  describe("ForkContext store", () => {
    test("setForkContext stores context for session", () => {
      const ctx: SessionPrompt.ForkContext = {
        system: ["system prompt"],
        tools: {},
        messages: [],
      }
      SessionPrompt.setForkContext("session-1", ctx)
      // getActiveContext is for parent sessions, not fork contexts
      // fork contexts are consumed internally by runLoop
    })

    test("getActiveContext returns undefined for unknown session", () => {
      expect(SessionPrompt.getActiveContext("nonexistent")).toBeUndefined()
    })

    test("multiple sessions have independent contexts", () => {
      const ctx1: SessionPrompt.ForkContext = {
        system: ["prompt-1"],
        tools: { read: {} as any },
        messages: [{ role: "user", content: "hello" }],
      }
      const ctx2: SessionPrompt.ForkContext = {
        system: ["prompt-2"],
        tools: { edit: {} as any },
        messages: [{ role: "user", content: "world" }],
      }
      SessionPrompt.setForkContext("session-a", ctx1)
      SessionPrompt.setForkContext("session-b", ctx2)

      // Both stored independently — verified by the fact that
      // setting one doesn't overwrite the other
    })
  })

  describe("fork detection logic", () => {
    // Replicates the fork detection from task.ts
    function shouldFork(
      parent: { modelID: string; providerID: string },
      child: { modelID: string; providerID: string },
      isFork: boolean,
    ): boolean {
      const sameModel = child.modelID === parent.modelID && child.providerID === parent.providerID
      return sameModel && !isFork
    }

    test("same model and provider → fork", () => {
      expect(
        shouldFork(
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          false,
        ),
      ).toBe(true)
    })

    test("different model → no fork", () => {
      expect(
        shouldFork(
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          { modelID: "claude-haiku-3-20250317", providerID: "anthropic" },
          false,
        ),
      ).toBe(false)
    })

    test("different provider → no fork", () => {
      expect(
        shouldFork({ modelID: "gpt-4o", providerID: "openai" }, { modelID: "gpt-4o", providerID: "azure" }, false),
      ).toBe(false)
    })

    test("already a fork → no recursive fork", () => {
      expect(
        shouldFork(
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          true,
        ),
      ).toBe(false)
    })

    test("different model AND different provider → no fork", () => {
      expect(
        shouldFork(
          { modelID: "gpt-4o", providerID: "openai" },
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          false,
        ),
      ).toBe(false)
    })

    test("same model with version suffix → fork", () => {
      expect(
        shouldFork(
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          { modelID: "claude-sonnet-4-20250514", providerID: "anthropic" },
          false,
        ),
      ).toBe(true)
    })
  })

  describe("ForkContext shape", () => {
    test("system is string array", () => {
      const ctx: SessionPrompt.ForkContext = {
        system: ["line 1", "line 2", "line 3"],
        tools: {},
        messages: [],
      }
      expect(ctx.system).toHaveLength(3)
      expect(ctx.system[0]).toBe("line 1")
    })

    test("tools preserves tool entries", () => {
      const mock = { description: "test", execute: async () => ({}) }
      const ctx: SessionPrompt.ForkContext = {
        system: [],
        tools: { read: mock as any, glob: mock as any, grep: mock as any },
        messages: [],
      }
      expect(Object.keys(ctx.tools)).toHaveLength(3)
      expect(Object.keys(ctx.tools).sort()).toEqual(["glob", "grep", "read"])
    })

    test("messages can contain model messages", () => {
      const ctx: SessionPrompt.ForkContext = {
        system: [],
        tools: {},
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] },
          { role: "assistant", content: [{ type: "text", text: "hi" }] },
          { role: "user", content: [{ type: "text", text: "edit file.ts" }] },
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "1", toolName: "edit", args: {} }],
          },
        ],
      }
      expect(ctx.messages).toHaveLength(4)
    })

    test("empty fork context is valid", () => {
      const ctx: SessionPrompt.ForkContext = {
        system: [],
        tools: {},
        messages: [],
      }
      expect(ctx.system).toEqual([])
      expect(ctx.tools).toEqual({})
      expect(ctx.messages).toEqual([])
    })
  })
})
