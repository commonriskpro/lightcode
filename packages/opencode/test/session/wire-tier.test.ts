import { describe, expect, test } from "bun:test"
import {
  includeInstructionBodies,
  instructionMode,
  mergedInstructionBodies,
  routerFiltersFirstTurn,
} from "../../src/session/wire-tier"
import type { Config } from "@/config/config"
import type { MessageV2 } from "../../src/session/message-v2"

const baseCfg = { experimental: {} } as Config.Info

function user() {
  return {
    info: {
      id: "u1" as any,
      sessionID: "s1" as any,
      role: "user" as const,
      time: { created: 1 },
      agent: "build",
      model: { providerID: "opencode" as any, modelID: "m1" as any },
    },
    parts: [],
  } as MessageV2.WithParts
}

function assistant() {
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

describe("includeInstructionBodies", () => {
  test("full tier always includes", () => {
    const prev = process.env.OPENCODE_INITIAL_TOOL_TIER
    delete process.env.OPENCODE_INITIAL_TOOL_TIER
    try {
      const cfg = { ...baseCfg, experimental: { ...baseCfg.experimental, initial_tool_tier: "full" as const } }
      expect(includeInstructionBodies(cfg, [user()])).toBe(true)
      expect(includeInstructionBodies(cfg, [user(), assistant()])).toBe(true)
    } finally {
      if (prev !== undefined) process.env.OPENCODE_INITIAL_TOOL_TIER = prev
    }
  })

  test("minimal first turn omits", () => {
    const cfg = { ...baseCfg, experimental: { ...baseCfg.experimental, initial_tool_tier: "minimal" as const } }
    expect(includeInstructionBodies(cfg, [user()])).toBe(false)
  })

  test("minimal after assistant includes", () => {
    const cfg = { ...baseCfg, experimental: { ...baseCfg.experimental, initial_tool_tier: "minimal" as const } }
    expect(includeInstructionBodies(cfg, [user(), assistant()])).toBe(true)
  })
})

describe("routerFiltersFirstTurn", () => {
  test("default apply_after_first_assistant does not filter T1", () => {
    const cfg = {
      experimental: { tool_router: { enabled: true, apply_after_first_assistant: true } },
    } as Config.Info
    expect(routerFiltersFirstTurn(cfg, [user()])).toBe(false)
  })

  test("apply_after_first_assistant false filters T1 when router enabled", () => {
    const cfg = {
      experimental: { tool_router: { enabled: true, apply_after_first_assistant: false } },
    } as Config.Info
    expect(routerFiltersFirstTurn(cfg, [user()])).toBe(true)
    expect(routerFiltersFirstTurn(cfg, [user(), assistant()])).toBe(false)
  })
})

describe("mergedInstructionBodies", () => {
  test("skipRouter forces full (e.g. json_schema)", () => {
    const cfg = { ...baseCfg, experimental: { initial_tool_tier: "minimal" as const } }
    expect(mergedInstructionBodies(cfg, [user()], true)).toBe(true)
  })

  test("router filters first turn forces full even with minimal tier", () => {
    const cfg = {
      experimental: {
        initial_tool_tier: "minimal" as const,
        tool_router: { enabled: true, apply_after_first_assistant: false },
      },
    } as Config.Info
    expect(mergedInstructionBodies(cfg, [user()], false)).toBe(true)
  })

  test("minimal_tier_all_turns keeps merged off on T1 even when router filters T1", () => {
    const cfg = {
      experimental: {
        initial_tool_tier: "minimal" as const,
        minimal_tier_all_turns: true,
        tool_router: { enabled: true, apply_after_first_assistant: false },
      },
    } as Config.Info
    expect(mergedInstructionBodies(cfg, [user()], false)).toBe(false)
  })

  test("minimal default router defers instructions on T1", () => {
    const cfg = {
      experimental: {
        initial_tool_tier: "minimal" as const,
        tool_router: { enabled: true, apply_after_first_assistant: true },
      },
    } as Config.Info
    expect(mergedInstructionBodies(cfg, [user()], false)).toBe(false)
  })
})

describe("instructionMode minimal_tier_all_turns", () => {
  test("defers even when router would force full on T1", () => {
    const cfg = {
      experimental: {
        initial_tool_tier: "minimal" as const,
        minimal_tier_all_turns: true,
        tool_router: { enabled: true, apply_after_first_assistant: false },
      },
    } as Config.Info
    expect(instructionMode(cfg, [user()], false)).toBe("deferred")
    expect(instructionMode(cfg, [user(), assistant()], false)).toBe("deferred")
  })
})
