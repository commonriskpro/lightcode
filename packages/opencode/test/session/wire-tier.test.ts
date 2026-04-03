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
  test("always true (minimal tier removed)", () => {
    expect(includeInstructionBodies(baseCfg, [user()])).toBe(true)
    expect(includeInstructionBodies(baseCfg, [user(), assistant()])).toBe(true)
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
    expect(mergedInstructionBodies(baseCfg, [user()], true)).toBe(true)
  })

  test("router filters first turn forces full", () => {
    const cfg = {
      experimental: {
        tool_router: { enabled: true, apply_after_first_assistant: false },
      },
    } as Config.Info
    expect(mergedInstructionBodies(cfg, [user()], false)).toBe(true)
  })

  test("otherwise merged", () => {
    const cfg = {
      experimental: {
        tool_router: { enabled: true, apply_after_first_assistant: true },
      },
    } as Config.Info
    expect(mergedInstructionBodies(cfg, [user()], false)).toBe(true)
  })
})

describe("instructionMode", () => {
  test("full when router filters first turn", () => {
    const cfg = {
      experimental: {
        tool_router: { enabled: true, apply_after_first_assistant: false },
      },
    } as Config.Info
    expect(instructionMode(cfg, [user()], false)).toBe("full")
  })

  test("index after assistant when router does not filter T1", () => {
    const cfg = {
      experimental: {
        tool_router: { enabled: true, apply_after_first_assistant: true },
      },
    } as Config.Info
    expect(instructionMode(cfg, [user(), assistant()], false)).toBe("index")
  })
})
