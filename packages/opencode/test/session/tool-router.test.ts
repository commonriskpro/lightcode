import { describe, expect, test } from "bun:test"
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

describe("ToolRouter.apply", () => {
  test("disabled returns tools unchanged", async () => {
    const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("hi"), assistantMsg(), userMsg("run npm test in src")],
      agent: { name: "build", mode: "primary" },
      cfg: { experimental: {} } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
    expect(out.promptHint).toBeUndefined()
  })

  test("enabled after assistant narrows by rules", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("run npm test in src tool_router")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.tools.read).toBeDefined()
    expect(out.tools.edit).toBeUndefined()
    expect(out.promptHint).toContain("Offline tool router")
    expect(out.promptHint).toContain("test")
  })

  test("skip on first user turn when apply_after_first_assistant", async () => {
    const tools = { bash: dummyTool("bash"), read: dummyTool("read") }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("only user")],
      agent: { name: "build", mode: "primary" },
      cfg: { experimental: { tool_router: { enabled: true, apply_after_first_assistant: true } } } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
    expect(out.promptHint).toBeUndefined()
  })

  test("skip flag bypasses router", async () => {
    const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("a"), assistantMsg(), userMsg("b")],
      agent: { name: "build", mode: "primary" },
      cfg: { experimental: { tool_router: { enabled: true } } } as Config.Info,
      mcpIds: new Set(),
      skip: true,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
  })

  test("delete/remove intent adds bash without saying shell", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("borra la carpeta boom")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.promptHint).toContain("delete/remove")
  })

  test("first user turn routes when apply_after_first_assistant false", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      write: dummyTool("write"),
      grep: dummyTool("grep"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("refactor foo.ts")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: false, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.edit).toBeDefined()
    expect(out.promptHint).toContain("edit/refactor")
  })

  test("inject_prompt false omits promptHint", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("run tests")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, inject_prompt: false, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.promptHint).toBeUndefined()
  })

  test("OPENCODE_TOOL_ROUTER enables without experimental.tool_router.enabled", async () => {
    const prev = process.env.OPENCODE_TOOL_ROUTER
    process.env.OPENCODE_TOOL_ROUTER = "1"
    try {
      const tools = {
        read: dummyTool("read"),
        bash: dummyTool("bash"),
        edit: dummyTool("edit"),
        skill: dummyTool("skill"),
        task: dummyTool("task"),
      }
      const out = ToolRouter.apply({
        tools,
        messages: [userMsg("x"), assistantMsg(), userMsg("refactor the module")],
        agent: { name: "build", mode: "primary" },
        cfg: { experimental: {} } as Config.Info,
        mcpIds: new Set(),
        skip: false,
      })
      expect(out.tools.edit).toBeDefined()
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_TOOL_ROUTER
      else process.env.OPENCODE_TOOL_ROUTER = prev
    }
  })
})
