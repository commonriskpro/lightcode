import { describe, expect, test } from "bun:test"
import { buildEvalTools, buildEvalMessages, defaultEvalRouterConfig } from "@/session/router-eval-context"
import { applyExposure, memoryFromMessages, normalizeExposureMode, toolIdsFromCompletedTools } from "@/session/tool-exposure"
import { ToolRouter } from "@/session/tool-router"
import type { MessageV2 } from "@/session/message-v2"

function withRouterEnv<T>(fn: () => Promise<T>) {
  const prev = process.env.OPENCODE_TOOL_ROUTER
  process.env.OPENCODE_TOOL_ROUTER = "1"
  return fn().finally(() => {
    if (prev === undefined) delete process.env.OPENCODE_TOOL_ROUTER
    else process.env.OPENCODE_TOOL_ROUTER = prev
  })
}

describe("tool-exposure", () => {
  test("default mode unchanged vs router output", async () => {
    const cfg = defaultEvalRouterConfig()
    const tools = buildEvalTools(["read", "edit", "bash"])
    const allowed = new Set(["read", "edit", "bash"])
    const messages = buildEvalMessages("run tests")
    process.env.OPENCODE_TOOL_ROUTER = "1"
    const routed = await ToolRouter.apply({
      tools,
      registryTools: tools,
      allowedToolIds: allowed,
      messages,
      agent: { name: "build", mode: "primary" },
      cfg,
      mcpIds: new Set(),
      skip: false,
    })
    delete process.env.OPENCODE_TOOL_ROUTER
    const out = applyExposure({
      mode: "per_turn_subset",
      routed,
      registryTools: tools,
      allowedToolIds: allowed,
      messages,
      prior: { unlocked: [], sessionCallable: [] },
    })
    expect(Object.keys(out.tools).sort()).toEqual(Object.keys(routed.tools).sort())
    expect(out.updated.unlocked).toEqual([])
    expect(out.updated.sessionCallable).toEqual([])
  })

  test("session_accumulative_callable widens attach set vs router when prior memory present", async () => {
    const cfg = defaultEvalRouterConfig()
    const ids = ["read", "edit", "grep", "bash", "glob"]
    const tools = buildEvalTools(ids)
    const allowed = new Set(ids)
    const messages = buildEvalMessages("fix the bug in foo.ts")
    process.env.OPENCODE_TOOL_ROUTER = "1"
    const routed = await ToolRouter.apply({
      tools,
      registryTools: tools,
      allowedToolIds: allowed,
      messages,
      agent: { name: "build", mode: "primary" },
      cfg,
      mcpIds: new Set(),
      skip: false,
    })
    delete process.env.OPENCODE_TOOL_ROUTER
    const out = applyExposure({
      mode: "session_accumulative_callable",
      routed,
      registryTools: tools,
      allowedToolIds: allowed,
      messages,
      prior: { unlocked: ["glob"], sessionCallable: ["glob"] },
    })
    expect(Object.keys(out.tools).sort()).toContain("glob")
    expect(out.widenedVsRouter).toBe(true)
  })

  test("memory_from_messages reads last assistant exposure fields", () => {
    const a = {
      info: {
        id: "a1" as any,
        sessionID: "s" as any,
        role: "assistant" as const,
        time: { created: 1 },
        parentID: "u0" as any,
        mode: "x",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: "m" as any,
        providerID: "p" as any,
        toolExposureUnlockedIds: ["read", "edit"],
        toolExposureSessionCallableIds: ["read"],
      },
      parts: [],
    } as MessageV2.WithParts
    const u = {
      info: {
        id: "u2" as any,
        sessionID: "s" as any,
        role: "user" as const,
        time: { created: 2 },
        agent: "build",
        model: { providerID: "p" as any, modelID: "m" as any },
      },
      parts: [{ type: "text" as const, text: "hi", id: "p" as any, sessionID: "s" as any, messageID: "u2" as any }],
    } as MessageV2.WithParts
    const m = memoryFromMessages([a, u])
    expect(m.unlocked).toEqual(["edit", "read"])
    expect(m.sessionCallable).toEqual(["read"])
  })

  test("tool_ids_from_completed_tools collects tool names", () => {
    const tp = {
      type: "tool" as const,
      id: "t1" as any,
      sessionID: "s" as any,
      messageID: "a1" as any,
      tool: "read",
      callID: "c1",
      state: { status: "completed" as const, time: { start: 1, end: 2 }, input: {}, output: "x" },
    }
    const m = [
      {
        info: {
          id: "a1" as any,
          sessionID: "s" as any,
          role: "assistant" as const,
          time: { created: 1 },
          parentID: "u0" as any,
          mode: "x",
          agent: "build",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "m" as any,
          providerID: "p" as any,
        },
        parts: [tp],
      },
    ] as MessageV2.WithParts[]
    expect(toolIdsFromCompletedTools(m)).toEqual(["read"])
  })

  test("normalizeExposureMode defaults unknown to per_turn_subset", () => {
    expect(normalizeExposureMode(undefined)).toBe("per_turn_subset")
    expect(normalizeExposureMode("garbage")).toBe("per_turn_subset")
    expect(normalizeExposureMode("session_accumulative_callable")).toBe("session_accumulative_callable")
  })

  test("session_accumulative_callable keeps write after first file-creation turn", async () => {
    const cfg = defaultEvalRouterConfig()
    const ids = [
      "read",
      "write",
      "grep",
      "glob",
      "edit",
      "bash",
      "task",
      "skill",
      "webfetch",
      "websearch",
      "question",
      "todowrite",
      "codesearch",
    ]
    const tools = buildEvalTools(ids)
    const allowed = new Set(ids)
    await withRouterEnv(async () => {
      const msg1 = buildEvalMessages("créame un archivo que se llame hecho.md en el root del repo")
      const routed1 = await ToolRouter.apply({
        tools,
        registryTools: tools,
        allowedToolIds: allowed,
        messages: msg1,
        agent: { name: "build", mode: "primary" },
        cfg,
        mcpIds: new Set(),
        skip: false,
      })
      const ex1 = applyExposure({
        mode: "session_accumulative_callable",
        routed: routed1,
        registryTools: tools,
        allowedToolIds: allowed,
        messages: msg1,
        prior: { unlocked: [], sessionCallable: [] },
      })
      expect(Object.keys(ex1.tools).includes("write")).toBe(true)
      const msg2 = buildEvalMessages("lista los archivos en src/")
      const routed2 = await ToolRouter.apply({
        tools,
        registryTools: tools,
        allowedToolIds: allowed,
        messages: msg2,
        agent: { name: "build", mode: "primary" },
        cfg,
        mcpIds: new Set(),
        skip: false,
      })
      const ex2 = applyExposure({
        mode: "session_accumulative_callable",
        routed: routed2,
        registryTools: tools,
        allowedToolIds: allowed,
        messages: msg2,
        prior: ex1.updated,
      })
      expect(Object.keys(ex2.tools).includes("write")).toBe(true)
    })
  })
})
