import { describe, expect, test } from "bun:test"
import { ToolRouter, stickyToolIdsFromMessages } from "../../src/session/tool-router"
import { defaultEvalRouterConfig, runRouterEvalCase } from "../../src/session/router-eval-context"
import { shutdownRouterEmbedIpc } from "../../src/session/router-embed-ipc"
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

function assistantMsgWithSticky(ids: string[]) {
  const base = assistantMsg()
  return {
    ...base,
    info: {
      ...(base.info as MessageV2.Assistant),
      toolRouterActiveIds: ids,
    },
  } as MessageV2.WithParts
}

describe("ToolRouter.apply", () => {
  const baseCfg = {
    experimental: {
      tool_router: {
        enabled: true,
        apply_after_first_assistant: false,
        max_tools: 12,
      },
    },
  } as Config.Info

  test("disabled returns tools unchanged", async () => {
    const prev = process.env.OPENCODE_TOOL_ROUTER
    delete process.env.OPENCODE_TOOL_ROUTER
    try {
      const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
      const out = await ToolRouter.apply({
        tools,
        messages: [userMsg("hi"), assistantMsg(), userMsg("run npm test in src")],
        agent: { name: "build", mode: "primary" },
        cfg: { experimental: {} } as Config.Info,
        mcpIds: new Set(),
        skip: false,
      })
      expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
      expect(out.promptHint).toContain("Offline tool router")
    } finally {
      if (prev !== undefined) process.env.OPENCODE_TOOL_ROUTER = prev
    }
  })

  test("xenova mode returns a routed subset or minimal base", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("run npm test in src tool_router")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).length).toBeGreaterThanOrEqual(0)
    expect(out.promptHint).toContain("Offline tool router")
    expect(out.promptHint).toContain("xenova")
  })

  test("skip on first user turn when apply_after_first_assistant", async () => {
    const tools = { bash: dummyTool("bash"), read: dummyTool("read") }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("only user")],
      agent: { name: "build", mode: "primary" },
      cfg: { experimental: { tool_router: { keyword_rules: true, enabled: true, apply_after_first_assistant: true } } } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
    expect(out.promptHint).toContain("first turn")
  })

  test("skip flag bypasses router", async () => {
    const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("a"), assistantMsg(), userMsg("b")],
      agent: { name: "build", mode: "primary" },
      cfg: { experimental: { tool_router: { keyword_rules: true, enabled: true } } } as Config.Info,
      mcpIds: new Set(),
      skip: true,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
  })

  test("leading Ask me … attaches question tool when available", async () => {
    const tools = {
      read: dummyTool("read"),
      question: dummyTool("question"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("Ask me whether to use pnpm or npm for this migration")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.question).toBeDefined()
  })

  test("trailing ? attaches question tool via lexical hint when available", async () => {
    const tools = {
      read: dummyTool("read"),
      question: dummyTool("question"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [
        userMsg("x"),
        assistantMsg(),
        userMsg("Should we use Zod or plain JSON schema for this API?"),
      ],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.question).toBeDefined()
  })

  test("single-word this attaches grep and read for follow-up context", async () => {
    const tools = { read: dummyTool("read"), grep: dummyTool("grep") }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("this")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.grep).toBeDefined()
    expect(out.tools.read).toBeDefined()
  })

  test("xenova no-match can return minimal set", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("borrar todo en la carpeta tmp")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toContain("Offline tool router")
    expect(out.contextTier).not.toBe("conversation")
  })

  test("additive keeps current tier tools and can expand from registry", async () => {
    const minimal = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const registry = { ...minimal, bash: dummyTool("bash"), edit: dummyTool("edit"), write: dummyTool("write") }
    const out = await ToolRouter.apply({
      tools: minimal,
      registryTools: registry,
      allowedToolIds: new Set([...Object.keys(registry)]),
      messages: [userMsg("si, al directorio actual borralo todo")],
      agent: { name: "sdd-orchestrator", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            additive: true,
            apply_after_first_assistant: false,
            max_tools: 12,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).length).toBeGreaterThanOrEqual(0)
    expect(out.promptHint).toContain("additive")
  })

  test("inject_prompt false omits promptHint", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
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
    expect(out.promptHint).toBeUndefined()
  })

  test("allowedToolIds still filters unavailable ids", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      grep: dummyTool("grep"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const allowed = new Set(["read", "grep", "skill", "task"])
    const out = await ToolRouter.apply({
      tools,
      allowedToolIds: allowed,
      messages: [userMsg("x"), assistantMsg(), userMsg("refactor the module")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.edit).toBeUndefined()
  })

  test("URL-oriented message can select web tools through xenova embeddings", async () => {
    const tools = {
      read: dummyTool("read"),
      webfetch: dummyTool("webfetch"),
      websearch: dummyTool("websearch"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("open https://example.com/docs")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            ...baseCfg.experimental?.tool_router,
            keyword_rules: true,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).length).toBeGreaterThan(0)
    expect(out.promptHint).toContain("xenova")
  })

  test("OPENCODE_TOOL_ROUTER env enables router path", async () => {
    const prev = process.env.OPENCODE_TOOL_ROUTER
    process.env.OPENCODE_TOOL_ROUTER = "1"
    try {
      const tools = {
        read: dummyTool("read"),
        edit: dummyTool("edit"),
        skill: dummyTool("skill"),
        task: dummyTool("task"),
      }
      const out = await ToolRouter.apply({
        tools,
        messages: [userMsg("refactor the module")],
        agent: { name: "build", mode: "primary" },
        cfg: { experimental: {} } as Config.Info,
        mcpIds: new Set(),
        skip: false,
      })
      expect(out.promptHint).toContain("Offline tool router")
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_TOOL_ROUTER
      else process.env.OPENCODE_TOOL_ROUTER = prev
    }
  })

  test("MCP tools are filtered when unrelated to xenova match", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      db_query: dummyTool("db_query"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("edit the config")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(["db_query"]),
      skip: false,
    })
    expect(out.tools.db_query).toBeUndefined()
  })

  test("mcp_filter_by_intent false does not force MCP tools without xenova match", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      db_query: dummyTool("db_query"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("edit the config")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: false,
            max_tools: 12,
            mcp_filter_by_intent: false,
          },
        },
      } as Config.Info,
      mcpIds: new Set(["db_query"]),
      skip: false,
    })
    expect(out.tools.db_query).toBeUndefined()
  })

  test("compaction agent skips router", async () => {
    const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit something")],
      agent: { name: "compaction", mode: "compaction" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
    expect(out.promptHint).toContain("compaction agent")
  })

  test("max_tools caps the result", async () => {
    const registry: Record<string, AITool> = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
      edit: dummyTool("edit"),
      write: dummyTool("write"),
      bash: dummyTool("bash"),
    }
    const out = await ToolRouter.apply({
      tools: registry,
      registryTools: registry,
      messages: [userMsg("edit and run tests and search refs")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: false,
            max_tools: 3,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).length).toBeLessThanOrEqual(3)
  })

  test("conversation intent without tool match returns conversation tier with no tools", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("hola gracias, solo queria saludar")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: false,
            max_tools: 12,
            local_intent_embed: true,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.contextTier).toBe("conversation")
    expect(Object.keys(out.tools).length).toBe(0)
  })

  test("sticky previous turn does not force tools without xenova match", async () => {
    const tools = {
      read: dummyTool("read"),
      webfetch: dummyTool("webfetch"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const msgs = [userMsg("x"), assistantMsgWithSticky(["read", "webfetch"]), userMsg("hola")]
    const sticky = stickyToolIdsFromMessages(msgs)
    expect(sticky?.sort()).toEqual(["read", "webfetch"])
    const out = await ToolRouter.apply({
      tools,
      messages: msgs,
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            apply_after_first_assistant: false,
            max_tools: 12,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
      stickyToolIds: sticky,
    })
    expect(out.tools.webfetch).toBeUndefined()
    expect(out.tools.read).toBeUndefined()
  })

  test("base tools not matched by xenova get slim descriptions", async () => {
    const tools = {
      read: {
        description:
          "Read a file or directory from the filesystem. Use this tool when you need to inspect the contents of a file.",
      } as AITool,
      edit: { description: "Edit a file by replacing or inserting content." } as AITool,
      task: { description: "Delegate a task to a sub-agent for parallel execution." } as AITool,
      skill: { description: "Load a named skill from the skill registry." } as AITool,
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("very random unrelated tokens")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    if (out.tools.task) expect(out.tools.task.description).toBe("Delegate a task to a subagent.")
    if (out.tools.skill) expect(out.tools.skill.description).toBe("Load a named skill.")
  })

  test("matched tools keep full descriptions", async () => {
    const tools = {
      edit: { description: "Full edit description" } as AITool,
      write: { description: "Full write description" } as AITool,
      grep: { description: "Full grep description" } as AITool,
      read: { description: "Full read description" } as AITool,
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("refactor edit write file changes")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    if (out.tools.edit) expect(out.tools.edit.description).toBe("Full edit description")
    if (out.tools.write) expect(out.tools.write.description).toBe("Full write description")
  })

  test("tool not in input.tools or registryTools is skipped gracefully", async () => {
    const tools = {
      read: dummyTool("read"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
    }
    // "edit" is suggested by rules but not in tools or registry
    const out = await ToolRouter.apply({
      tools,
      registryTools: { read: dummyTool("read"), task: dummyTool("task"), skill: dummyTool("skill") },
      messages: [userMsg("x"), assistantMsg(), userMsg("edit the file")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            ...baseCfg.experimental?.tool_router,
            keyword_rules: true,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    // edit not available → should not crash, just omitted
    expect(out.tools.edit).toBeUndefined()
    expect(out.tools.read).toBeDefined()
  })

  test("no local intent embed: casual message is not conversation tier", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("aburrido"), assistantMsg(), userMsg("dale")],
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.contextTier).not.toBe("conversation")
    expect(out.promptHint).toContain("xenova")
  })

  test("keyword_rules true applies regex RULES to the prompt", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("run npm test in the package")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            keyword_rules: true,
            apply_after_first_assistant: false,
            max_tools: 12,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools)).toContain("bash")
  })

  test("router_only still avoids fallback labels on gibberish", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("xyzzy 42 nonsense")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            router_only: true,
            apply_after_first_assistant: false,
            max_tools: 12,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toBeDefined()
    expect(out.promptHint).not.toContain("fallback/no_match")
  })
})

describe("ToolRouter hybrid multi-clause", () => {
  const tools = [
    "read",
    "grep",
    "glob",
    "bash",
    "edit",
    "write",
    "webfetch",
    "websearch",
    "task",
    "skill",
    "question",
    "todowrite",
    "codesearch",
  ]

  test("ES read then document row includes read edit write", async () => {
    const out = await runRouterEvalCase({
      prompt: "Revisa router-eval-score.ts y luego documenta la métrica en docs/router-eval.md",
      agent: { name: "build", mode: "primary" },
      available_tools: tools,
      cfg: defaultEvalRouterConfig(),
    })
    shutdownRouterEmbedIpc()
    expect(out.selected.includes("read")).toBe(true)
    expect(out.selected.includes("edit")).toBe(true)
    expect(out.selected.includes("write")).toBe(true)
  })

  test("forbids bash when user says do not run terminal", async () => {
    const out = await runRouterEvalCase({
      prompt: "Read the router policy file, then grep for bash — do not run terminal",
      agent: { name: "build", mode: "primary" },
      available_tools: tools,
      cfg: defaultEvalRouterConfig(),
    })
    shutdownRouterEmbedIpc()
    expect(out.selected.includes("bash")).toBe(false)
    expect(out.selected.includes("grep")).toBe(true)
  })

  test("ES créame archivo hecho.md en root selects write", async () => {
    const out = await runRouterEvalCase({
      prompt: "créame un archivo que se llame hecho.md en el root del repo",
      agent: { name: "build", mode: "primary" },
      available_tools: tools,
      cfg: defaultEvalRouterConfig(),
    })
    shutdownRouterEmbedIpc()
    expect(out.selected.includes("write")).toBe(true)
  })

  test("ES creame sin acento + archivo.md en root seeds write (keyword_rules off)", async () => {
    const out = await runRouterEvalCase({
      prompt: "creame un archivo hecho.md en el root del repo",
      agent: { name: "build", mode: "primary" },
      available_tools: tools,
      cfg: defaultEvalRouterConfig(),
    })
    shutdownRouterEmbedIpc()
    expect(out.selected.includes("write")).toBe(true)
  })

  test("ES créame archivo.md en root sin que se llame seeds write", async () => {
    const out = await runRouterEvalCase({
      prompt: "créame un archivo hecho.md en el root del repo",
      agent: { name: "build", mode: "primary" },
      available_tools: tools,
      cfg: defaultEvalRouterConfig(),
    })
    shutdownRouterEmbedIpc()
    expect(out.selected.includes("write")).toBe(true)
  })

  test("EN create a file named done.md in the repo root selects write", async () => {
    const out = await runRouterEvalCase({
      prompt: "create a file named done.md in the repo root",
      agent: { name: "build", mode: "primary" },
      available_tools: tools,
      cfg: defaultEvalRouterConfig(),
    })
    shutdownRouterEmbedIpc()
    expect(out.selected.includes("write")).toBe(true)
  })
})
