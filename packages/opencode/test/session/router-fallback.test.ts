import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ToolRouter } from "../../src/session/tool-router"
import type { Tool as AITool } from "ai"
import type { Config } from "../../src/config/config"
import type { MessageV2 } from "../../src/session/message-v2"

function dummyTool(id: string): AITool {
  return { description: `Tool ${id}` } as AITool
}

function userMsg(text: string) {
  return {
    info: {
      id: "u1" as any,
      sessionID: "s1" as any,
      role: "user" as const,
      time: { created: 1 },
      agent: "build",
      model: { providerID: "opencode" as any, modelID: "m1" as any },
    },
    parts: [{ type: "text" as const, text, id: "p1" as any, sessionID: "s1" as any, messageID: "u1" as any }],
  } as MessageV2.WithParts
}

function assistantMsg() {
  return {
    info: {
      id: "a1" as any,
      sessionID: "s1" as any,
      role: "assistant" as const,
      parentID: "u1" as any,
      time: { created: 2 },
      mode: "primary",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "m" as any,
      providerID: "opencode" as any,
    },
    parts: [],
  } as MessageV2.WithParts
}

describe("ToolRouter fallback (empty selection recovery)", () => {
  let prev: string | undefined
  beforeAll(() => {
    prev = process.env.OPENCODE_TOOL_ROUTER
    process.env.OPENCODE_TOOL_ROUTER = "1"
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.OPENCODE_TOOL_ROUTER
    else process.env.OPENCODE_TOOL_ROUTER = prev
  })

  test("expands once to full allowed set when routing yields no tools", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("opaque router_only no signal zzz")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            keyword_rules: false,
            local_intent_embed: false,
            fallback: {
              enabled: true,
              max_expansions_per_turn: 1,
              expand_to: "full",
              recover_empty_without_signal: true,
            },
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
      fallback: {
        expansionsUsedThisTurn: 0,
        maxPerTurn: 1,
        expandTo: "full",
        sessionID: "s1" as any,
        messageID: "m1" as any,
        turn: 2,
      },
    })
    expect(out.usedFallbackExpansion).toBe(true)
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "edit", "read"])
    expect(out.contextTier).toBe("full")
  })

  test("does not expand without recover_empty_without_signal when router had no signal", async () => {
    const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("strict silence zzz")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            keyword_rules: false,
            local_intent_embed: false,
            fallback: { enabled: true, recover_empty_without_signal: false },
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
      fallback: { expansionsUsedThisTurn: 0, maxPerTurn: 1, expandTo: "full" },
    })
    expect(out.usedFallbackExpansion).not.toBe(true)
    expect(Object.keys(out.tools).length).toBe(0)
  })

  test("does not expand again when per-turn budget is exhausted", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("zzz no match")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            keyword_rules: false,
            local_intent_embed: false,
            fallback: {
              enabled: true,
              max_expansions_per_turn: 1,
              expand_to: "full",
              recover_empty_without_signal: true,
            },
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
      fallback: {
        expansionsUsedThisTurn: 1,
        maxPerTurn: 1,
        expandTo: "full",
        turn: 1,
      },
    })
    expect(out.usedFallbackExpansion).not.toBe(true)
    expect(Object.keys(out.tools).length).toBe(0)
  })

  test("expanded set is subset of allowed tools (permissions)", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
    }
    const allowedToolIds = new Set(["read", "edit"])
    const out = await ToolRouter.apply({
      tools,
      allowedToolIds,
      messages: [userMsg("x"), assistantMsg(), userMsg("no signal")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            keyword_rules: false,
            local_intent_embed: false,
            fallback: { expand_to: "full", recover_empty_without_signal: true },
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
      fallback: {
        expansionsUsedThisTurn: 0,
        maxPerTurn: 1,
        expandTo: "full",
      },
    })
    expect(out.usedFallbackExpansion).toBe(true)
    for (const id of Object.keys(out.tools)) {
      expect(allowedToolIds.has(id)).toBe(true)
    }
    expect(Object.keys(out.tools).sort()).toEqual(["edit", "read"])
  })

  test("expand_to base limits recovery to base_tools intersected with pool", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
      glob: dummyTool("glob"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("no")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            keyword_rules: false,
            local_intent_embed: false,
            base_tools: ["read", "task", "skill"],
            fallback: { expand_to: "base", recover_empty_without_signal: true },
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
      fallback: {
        expansionsUsedThisTurn: 0,
        maxPerTurn: 1,
        expandTo: "base",
      },
    })
    expect(out.usedFallbackExpansion).toBe(true)
    expect(Object.keys(out.tools)).toEqual(["read"])
  })
})
