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
    const prev = process.env.OPENCODE_TOOL_ROUTER
    delete process.env.OPENCODE_TOOL_ROUTER
    try {
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
    } finally {
      if (prev !== undefined) process.env.OPENCODE_TOOL_ROUTER = prev
    }
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

  test("borrar todo does not match todo list rule (Spanish todo = everything)", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("borrar todo en la carpeta tmp")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toContain("delete/remove")
    expect(out.promptHint).not.toContain("todowrite")
    expect(out.tools.bash).toBeDefined()
  })

  test("Spanish borralo one word matches delete rule (bash)", async () => {
    const minimal = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const registry = { ...minimal, bash: dummyTool("bash"), edit: dummyTool("edit"), write: dummyTool("write") }
    const out = ToolRouter.apply({
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
            base_tools: ["read", "task", "skill", "grep", "glob"],
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.promptHint).toContain("delete/remove")
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

  test("delete intent subtractive without bash in tool map injects delegate hint", async () => {
    const tools = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("elimina los archivos viejos")],
      agent: { name: "sdd-orchestrator", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: false, max_tools: 8 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toContain("delete/remove")
    expect(out.promptHint).toContain("task")
    expect(out.promptHint).toContain("delegate")
  })

  test("orchestrator delete intent gets bash when additive and registry permit", async () => {
    const minimal = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const registry = {
      ...minimal,
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
      write: dummyTool("write"),
    }
    const allowed = new Set(["read", "grep", "glob", "skill", "task", "bash", "edit", "write"])
    const out = ToolRouter.apply({
      tools: minimal,
      registryTools: registry,
      allowedToolIds: allowed,
      messages: [userMsg("elimina los archivos viejos")],
      agent: { name: "sdd-orchestrator", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            additive: true,
            apply_after_first_assistant: false,
            max_tools: 12,
            base_tools: ["read", "task", "skill", "grep", "glob"],
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.promptHint).toContain("delete/remove")
    expect(out.promptHint).not.toContain("this agent has no bash")
  })

  test("Spanish list repo intent includes glob/grep", async () => {
    const tools = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("chequea que documentos hay en el repo")],
      agent: { name: "sdd-orchestrator", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: false, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.glob).toBeDefined()
    expect(out.tools.grep).toBeDefined()
    expect(out.promptHint).toContain("find/search")
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

  test("no_match_fallback adds glob/grep/read/task when text matches nothing", async () => {
    const tools = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("hello")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: false, max_tools: 100 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toContain("fallback/no_match")
    expect(out.tools.glob).toBeDefined()
    expect(out.tools.grep).toBeDefined()
  })

  test("allowedToolIds surfaces blocked tools in hint", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      grep: dummyTool("grep"),
    }
    const allowed = new Set(["read", "grep"])
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("refactor the module")],
      allowedToolIds: allowed,
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toContain("permissions")
    expect(out.promptHint).toContain("edit")
    expect(out.tools.edit).toBeUndefined()
  })

  test("additive first turn adds tools from registry not in minimal map", async () => {
    const registry: Record<string, AITool> = {
      read: dummyTool("read"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
      edit: dummyTool("edit"),
      write: dummyTool("write"),
    }
    const minimal: Record<string, AITool> = {
      read: registry.read,
      grep: registry.grep,
      glob: registry.glob,
      skill: registry.skill,
    }
    const out = ToolRouter.apply({
      tools: minimal,
      registryTools: registry,
      messages: [userMsg("refactor foo.ts")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            additive: true,
            apply_after_first_assistant: true,
            max_tools: 100,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.edit).toBeDefined()
    expect(out.tools.write).toBeDefined()
    expect(out.promptHint).toContain("additive")
  })

  test("web research Spanish adds webfetch websearch (subagent explore)", async () => {
    const tools = {
      read: dummyTool("read"),
      glob: dummyTool("glob"),
      webfetch: dummyTool("webfetch"),
      websearch: dummyTool("websearch"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("investiga sobre DealerCenter y el mercado externo")],
      agent: { name: "sdd-explore", mode: "subagent" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: false, max_tools: 24 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.webfetch).toBeDefined()
    expect(out.tools.websearch).toBeDefined()
    expect(out.promptHint).toContain("web/research")
  })

  test("literal URL in message adds web tools", async () => {
    const tools = {
      read: dummyTool("read"),
      webfetch: dummyTool("webfetch"),
      websearch: dummyTool("websearch"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("open https://example.com/docs")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: false, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.webfetch).toBeDefined()
    expect(out.promptHint).toContain("web/url")
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

  // --- Slim descriptions ---

  test("base tools not matched by rules get slim descriptions", async () => {
    const tools = {
      read: {
        description:
          "Read a file or directory from the filesystem. Use this tool when you need to inspect the contents of a file.",
      } as AITool,
      edit: { description: "Edit a file by replacing or inserting content." } as AITool,
      task: { description: "Delegate a task to a sub-agent for parallel execution." } as AITool,
      skill: { description: "Load a named skill from the skill registry." } as AITool,
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit the config file")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    // edit is matched by rule → keeps full description
    expect(out.tools.edit.description).toContain("replacing or inserting")
    // read is in edit/refactor rule's add list → matched → keeps full description
    expect(out.tools.read.description).toContain("filesystem")
    // task and skill are base-only → get slim descriptions
    expect(out.tools.task.description).toBe("Delegate a task to a subagent.")
    expect(out.tools.skill.description).toBe("Load a named skill.")
  })

  test("all matched tools keep full descriptions", async () => {
    const tools = {
      edit: { description: "Full edit description" } as AITool,
      write: { description: "Full write description" } as AITool,
      grep: { description: "Full grep description" } as AITool,
      read: { description: "Full read description" } as AITool,
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("create a new file")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    // All tools are matched by the create/implement rule → keep full descriptions
    expect(out.tools.edit.description).toBe("Full edit description")
    expect(out.tools.write.description).toBe("Full write description")
    expect(out.tools.grep.description).toBe("Full grep description")
    expect(out.tools.read.description).toBe("Full read description")
  })

  // --- MCP filtering by intent ---

  test("MCP tools filtered when rule matches but MCP not in rule", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      db_query: dummyTool("db_query"), // MCP tool
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit the config")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(["db_query"]),
      skip: false,
    })
    // edit rule matched → db_query MCP tool should be filtered out
    expect(out.tools.edit).toBeDefined()
    expect(out.tools.db_query).toBeUndefined()
  })

  test("MCP tools included on fallback (no rule matched)", async () => {
    const tools = {
      read: dummyTool("read"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      db_query: dummyTool("db_query"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("hello world")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(["db_query"]),
      skip: false,
    })
    // No rule matched → fallback → MCP tools included
    expect(out.tools.db_query).toBeDefined()
    expect(out.promptHint).toContain("fallback/no_match")
  })

  test("mcp_filter_by_intent false includes all MCP tools always", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      db_query: dummyTool("db_query"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit the config")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: true,
            max_tools: 12,
            mcp_filter_by_intent: false,
          },
        },
      } as Config.Info,
      mcpIds: new Set(["db_query"]),
      skip: false,
    })
    // MCP filtering disabled → db_query always included
    expect(out.tools.db_query).toBeDefined()
  })

  // --- Edge cases ---

  test("compaction agent skips router", async () => {
    const tools = { read: dummyTool("read"), bash: dummyTool("bash") }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit something")],
      agent: { name: "compaction", mode: "compaction" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).sort()).toEqual(["bash", "read"])
    expect(out.promptHint).toBeUndefined()
  })

  test("max_tools caps the result", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
      write: dummyTool("write"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("delete everything")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 3 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(Object.keys(out.tools).length).toBeLessThanOrEqual(3)
  })

  test("multiple rules union their tools", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      edit: dummyTool("edit"),
      write: dummyTool("write"),
      grep: dummyTool("grep"),
      glob: dummyTool("glob"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit foo.ts and run tests")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    // "edit" matches edit/refactor rule; "run" matches shell/run rule
    expect(out.tools.edit).toBeDefined()
    expect(out.tools.bash).toBeDefined()
    expect(out.tools.grep).toBeDefined()
    expect(out.promptHint).toContain("edit/refactor")
    expect(out.promptHint).toContain("shell/run")
  })

  test("empty user text triggers fallback", async () => {
    const tools = {
      read: dummyTool("read"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg(""), assistantMsg(), userMsg("")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.promptHint).toContain("fallback/no_match")
    expect(out.tools.read).toBeDefined()
    expect(out.tools.task).toBeDefined()
  })

  test("no_match_fallback false returns only base tools on no match", async () => {
    const tools = {
      read: dummyTool("read"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      glob: dummyTool("glob"),
      grep: dummyTool("grep"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("zzz nothing")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: true,
            max_tools: 12,
            no_match_fallback: false,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    // No fallback → only base tools
    expect(out.tools.read).toBeDefined()
    expect(out.tools.task).toBeDefined()
    expect(out.tools.skill).toBeDefined()
    expect(out.tools.glob).toBeUndefined()
    expect(out.tools.grep).toBeUndefined()
  })

  test("mcp_always_include false skips MCP tools", async () => {
    const tools = {
      read: dummyTool("read"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
      db_query: dummyTool("db_query"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("hello")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: false,
            max_tools: 12,
            mcp_always_include: false,
          },
        },
      } as Config.Info,
      mcpIds: new Set(["db_query"]),
      skip: false,
    })
    expect(out.tools.db_query).toBeUndefined()
  })

  test("unicode and non-breaking spaces are normalized", async () => {
    const tools = {
      read: dummyTool("read"),
      edit: dummyTool("edit"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    // Non-breaking space between words
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("edit\u00a0the\u00a0file")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.edit).toBeDefined()
    expect(out.promptHint).toContain("edit/refactor")
  })

  test("tool not in input.tools or registryTools is skipped gracefully", async () => {
    const tools = {
      read: dummyTool("read"),
      task: dummyTool("task"),
      skill: dummyTool("skill"),
    }
    // "edit" is in base_tools but not in tools or registry
    const out = ToolRouter.apply({
      tools,
      registryTools: { read: dummyTool("read"), task: dummyTool("task"), skill: dummyTool("skill") },
      messages: [userMsg("x"), assistantMsg(), userMsg("edit the file")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: { enabled: true, apply_after_first_assistant: true, max_tools: 12 },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    // edit not available → should not crash, just omitted
    expect(out.tools.edit).toBeUndefined()
    expect(out.tools.read).toBeDefined()
  })

  test("custom base_tools overrides defaults", async () => {
    const tools = {
      bash: dummyTool("bash"),
      glob: dummyTool("glob"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("zzz nothing")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: true,
            max_tools: 12,
            base_tools: ["bash", "glob"],
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.tools.glob).toBeDefined()
  })

  test("custom no_match_fallback_tools uses specified tools", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
    }
    const out = ToolRouter.apply({
      tools,
      messages: [userMsg("x"), assistantMsg(), userMsg("zzz nothing")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            apply_after_first_assistant: true,
            max_tools: 12,
            no_match_fallback_tools: ["bash", "read"],
            base_tools: ["read"],
          },
        },
      } as unknown as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.tools.bash).toBeDefined()
    expect(out.tools.read).toBeDefined()
    expect(out.tools.skill).toBeUndefined()
  })
})
