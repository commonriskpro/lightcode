import { describe, test, expect } from "bun:test"
import z from "zod"
import { Tool } from "../../src/tool/tool"
import { ToolSearchTool } from "../../src/tool/search"

describe("Tool.Info deferred fields", () => {
  test("define preserves shouldDefer and searchHint", () => {
    const info: Tool.Info = {
      ...Tool.define("test", {
        description: "test",
        parameters: z.object({}),
        async execute() {
          return { title: "", output: "", metadata: {} }
        },
      }),
      shouldDefer: true,
      searchHint: "A test hint",
    }
    expect(info.shouldDefer).toBe(true)
    expect(info.searchHint).toBe("A test hint")
  })

  test("shouldDefer defaults to undefined", () => {
    const info = Tool.define("plain", {
      description: "plain tool",
      parameters: z.object({}),
      async execute() {
        return { title: "", output: "", metadata: {} }
      },
    })
    expect(info.shouldDefer).toBeUndefined()
    expect(info.searchHint).toBeUndefined()
  })

  test("shouldDefer on Def is accessible after init", async () => {
    const info = Tool.define("deferred", {
      description: "deferred tool",
      parameters: z.object({}),
      shouldDefer: true,
      searchHint: "hint",
      async execute() {
        return { title: "", output: "", metadata: {} }
      },
    })
    const def = await info.init()
    expect(def.shouldDefer).toBe(true)
    expect(def.searchHint).toBe("hint")
  })
})

describe("ToolSearchTool", () => {
  test("is a valid Tool.Info", () => {
    expect(ToolSearchTool.id).toBe("tool_search")
    expect(typeof ToolSearchTool.init).toBe("function")
  })

  test("init returns a valid Def", async () => {
    const def = await ToolSearchTool.init()
    expect(def.description).toContain("deferred tools")
    expect(def.parameters).toBeDefined()
  })

  test("placeholder execute returns empty matches", async () => {
    const def = await ToolSearchTool.init()
    const result = await def.execute({ query: "lsp", max_results: 5 }, {} as any)
    expect(result.output).toBe("No deferred tools available.")
    expect(result.metadata.matches).toEqual([])
  })

  test("parameters accept query and max_results", async () => {
    const def = await ToolSearchTool.init()
    const valid = def.parameters.safeParse({ query: "test", max_results: 3 })
    expect(valid.success).toBe(true)
  })

  test("parameters require query", async () => {
    const def = await ToolSearchTool.init()
    const invalid = def.parameters.safeParse({ max_results: 3 })
    expect(invalid.success).toBe(false)
  })

  test("max_results defaults to 5", async () => {
    const def = await ToolSearchTool.init()
    const result = def.parameters.safeParse({ query: "test" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_results).toBe(5)
    }
  })
})
