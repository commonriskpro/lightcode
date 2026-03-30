import { describe, expect, test } from "bun:test"
import { applyInitialToolTier, minimalTierPromptHint } from "../../src/session/initial-tool-tier"
import type { Tool as AITool } from "ai"
import type { MessageV2 } from "../../src/session/message-v2"

function dummyTool(): AITool {
  return { description: "x".repeat(250) } as AITool
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

describe("applyInitialToolTier", () => {
  test("full tier returns same map", () => {
    const tools = { read: dummyTool(), bash: dummyTool() }
    const out = applyInitialToolTier({ tools, messages: [userMsg("hi")], tier: "full", includeBash: false })
    expect(out).toBe(tools)
  })

  test("minimal first turn allowlists and slims descriptions", () => {
    const tools = {
      read: dummyTool(),
      grep: dummyTool(),
      glob: dummyTool(),
      skill: dummyTool(),
      bash: dummyTool(),
      edit: dummyTool(),
    }
    const out = applyInitialToolTier({
      tools,
      messages: [userMsg("hi")],
      tier: "minimal",
      includeBash: false,
    })
    expect(Object.keys(out).sort()).toEqual(["glob", "grep", "read", "skill"])
    expect(out.read?.description?.length).toBeLessThanOrEqual(200)
  })

  test("minimal includes bash when flag", () => {
    const tools = {
      read: dummyTool(),
      grep: dummyTool(),
      glob: dummyTool(),
      skill: dummyTool(),
      bash: dummyTool(),
    }
    const out = applyInitialToolTier({
      tools,
      messages: [userMsg("hi")],
      tier: "minimal",
      includeBash: true,
    })
    expect(Object.keys(out).sort()).toEqual(["bash", "glob", "grep", "read", "skill"])
  })

  test("minimal after assistant message returns full map", () => {
    const tools = { read: dummyTool(), bash: dummyTool(), edit: dummyTool() }
    const out = applyInitialToolTier({
      tools,
      messages: [userMsg("hi"), assistantMsg()],
      tier: "minimal",
      includeBash: false,
    })
    expect(out).toBe(tools)
  })

  test("minimal includes webfetch/websearch when flags", () => {
    const tools = {
      read: dummyTool(),
      grep: dummyTool(),
      glob: dummyTool(),
      skill: dummyTool(),
      webfetch: dummyTool(),
      websearch: dummyTool(),
    }
    const out = applyInitialToolTier({
      tools,
      messages: [userMsg("hi")],
      tier: "minimal",
      includeBash: false,
      includeWebfetch: true,
      includeWebsearch: true,
    })
    expect(Object.keys(out).sort()).toEqual([
      "glob",
      "grep",
      "read",
      "skill",
      "webfetch",
      "websearch",
    ])
  })

  test("minimalTierPromptHint lists ids", () => {
    expect(minimalTierPromptHint({ includeBash: false })).toContain("read, grep, glob, skill")
    expect(minimalTierPromptHint({ includeBash: true })).toContain("bash")
    expect(
      minimalTierPromptHint({
        includeBash: false,
        includeWebfetch: true,
        includeWebsearch: true,
      }),
    ).toContain("webfetch")
  })

  test("empty allowlist with tools present falls back to full", () => {
    const tools = { other: dummyTool() }
    const out = applyInitialToolTier({
      tools,
      messages: [userMsg("hi")],
      tier: "minimal",
      includeBash: false,
    })
    expect(out).toBe(tools)
  })
})
