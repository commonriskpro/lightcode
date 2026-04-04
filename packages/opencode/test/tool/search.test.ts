import { describe, test, expect } from "bun:test"
import { ToolSearch } from "../../src/tool/search"

const ENTRIES: ToolSearch.Entry[] = [
  {
    id: "lsp",
    hint: "Language server diagnostics and hover",
    description: "Interact with language servers for code intelligence",
  },
  { id: "websearch", hint: "Web search via Exa", description: "Search the web using Exa API for real-time results" },
  { id: "codesearch", hint: "Search code via Context7", description: "Search code documentation using Context7 API" },
  {
    id: "webfetch",
    hint: "Fetch URL content as markdown",
    description: "Fetch a URL and return its content as markdown or text",
  },
  {
    id: "todo",
    hint: "Create and manage todo lists",
    description: "Create and manage structured task lists for the session",
  },
  { id: "apply_patch", hint: "Apply unified diff patches", description: "Apply a unified diff patch to modify files" },
  { id: "batch", hint: "Run multiple tools in parallel", description: "Execute multiple tool calls concurrently" },
  {
    id: "mcp__slack__send_message",
    hint: "Send a Slack message",
    description: "Send a message to a Slack channel using the MCP server",
  },
  {
    id: "mcp__github__create_issue",
    hint: "Create GitHub issue",
    description: "Create an issue on a GitHub repository",
  },
  { id: "mcp__jira__list_tasks", hint: "List Jira tasks", description: "List tasks from a Jira project board" },
]

describe("ToolSearch.search", () => {
  describe("select: syntax", () => {
    test("single tool by exact name", () => {
      const result = ToolSearch.search(ENTRIES, "select:lsp", 5)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("lsp")
    })

    test("multiple tools comma-separated", () => {
      const result = ToolSearch.search(ENTRIES, "select:lsp,websearch", 5)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.id)).toEqual(["lsp", "websearch"])
    })

    test("case insensitive", () => {
      const result = ToolSearch.search(ENTRIES, "select:LSP,WebSearch", 5)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.id)).toEqual(["lsp", "websearch"])
    })

    test("returns empty for nonexistent tool", () => {
      const result = ToolSearch.search(ENTRIES, "select:nonexistent", 5)
      expect(result).toHaveLength(0)
    })

    test("partial match returns only exact matches", () => {
      const result = ToolSearch.search(ENTRIES, "select:web", 5)
      expect(result).toHaveLength(0)
    })

    test("handles spaces in comma list", () => {
      const result = ToolSearch.search(ENTRIES, "select:lsp , todo", 5)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.id)).toEqual(["lsp", "todo"])
    })

    test("ignores trailing commas", () => {
      const result = ToolSearch.search(ENTRIES, "select:lsp,", 5)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("lsp")
    })

    test("selects MCP tools by full name", () => {
      const result = ToolSearch.search(ENTRIES, "select:mcp__slack__send_message", 5)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("mcp__slack__send_message")
    })
  })

  describe("keyword search", () => {
    test("matches by id", () => {
      const result = ToolSearch.search(ENTRIES, "lsp", 5)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].id).toBe("lsp")
    })

    test("matches by hint", () => {
      const result = ToolSearch.search(ENTRIES, "diagnostics", 5)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].id).toBe("lsp")
    })

    test("matches by description", () => {
      const result = ToolSearch.search(ENTRIES, "real-time results", 5)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].id).toBe("websearch")
    })

    test("returns empty for no match", () => {
      const result = ToolSearch.search(ENTRIES, "zzzznotfound", 5)
      expect(result).toHaveLength(0)
    })

    test("respects max_results", () => {
      const result = ToolSearch.search(ENTRIES, "search", 2)
      expect(result.length).toBeLessThanOrEqual(2)
    })

    test("ranks exact id match highest", () => {
      const result = ToolSearch.search(ENTRIES, "todo", 5)
      expect(result[0].id).toBe("todo")
    })

    test("ranks id-contains higher than description-only", () => {
      const result = ToolSearch.search(ENTRIES, "web", 5)
      expect(result[0].id).toMatch(/web/)
    })

    test("multi-word query scores across all fields", () => {
      const result = ToolSearch.search(ENTRIES, "language server", 5)
      expect(result[0].id).toBe("lsp")
    })

    test("handles extra whitespace", () => {
      const result = ToolSearch.search(ENTRIES, "  lsp  ", 5)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].id).toBe("lsp")
    })

    test("empty query returns nothing", () => {
      const result = ToolSearch.search(ENTRIES, "", 5)
      expect(result).toHaveLength(0)
    })

    test("whitespace-only query returns nothing", () => {
      const result = ToolSearch.search(ENTRIES, "   ", 5)
      expect(result).toHaveLength(0)
    })
  })

  describe("required terms (+prefix)", () => {
    test("filters by required term in id", () => {
      const result = ToolSearch.search(ENTRIES, "+mcp slack", 5)
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((r) => r.id.includes("mcp"))).toBe(true)
    })

    test("filters by required term in description", () => {
      const result = ToolSearch.search(ENTRIES, "+github issue", 5)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].id).toBe("mcp__github__create_issue")
    })

    test("multiple required terms must all match", () => {
      const result = ToolSearch.search(ENTRIES, "+mcp +slack", 5)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("mcp__slack__send_message")
    })

    test("required term with no match returns empty", () => {
      const result = ToolSearch.search(ENTRIES, "+zzzzz", 5)
      expect(result).toHaveLength(0)
    })

    test("plus sign alone is treated as optional", () => {
      const result = ToolSearch.search(ENTRIES, "+", 5)
      expect(result).toHaveLength(0)
    })

    test("required + optional combined", () => {
      const result = ToolSearch.search(ENTRIES, "+mcp jira", 5)
      expect(result.length).toBeGreaterThan(0)
      // jira should rank first among mcp tools
      expect(result[0].id).toBe("mcp__jira__list_tasks")
    })
  })

  describe("scoring order", () => {
    test("exact id match beats partial id match", () => {
      const entries: ToolSearch.Entry[] = [
        { id: "web", hint: "Web tool", description: "A web tool" },
        { id: "websearch", hint: "Web search", description: "Search the web" },
      ]
      const result = ToolSearch.search(entries, "web", 5)
      expect(result[0].id).toBe("web")
    })

    test("id match beats hint-only match", () => {
      const entries: ToolSearch.Entry[] = [
        { id: "fetch", hint: "Fetch URL", description: "Fetch stuff" },
        { id: "other", hint: "fetch content", description: "Other tool" },
      ]
      const result = ToolSearch.search(entries, "fetch", 5)
      expect(result[0].id).toBe("fetch")
    })

    test("hint match beats description-only match", () => {
      const entries: ToolSearch.Entry[] = [
        { id: "alpha", hint: "search code", description: "Alpha tool" },
        { id: "beta", hint: "Beta tool", description: "Can search for code" },
      ]
      const result = ToolSearch.search(entries, "search", 5)
      expect(result[0].id).toBe("alpha")
    })
  })

  describe("empty inputs", () => {
    test("empty entries returns nothing", () => {
      const result = ToolSearch.search([], "lsp", 5)
      expect(result).toHaveLength(0)
    })

    test("select on empty entries returns nothing", () => {
      const result = ToolSearch.search([], "select:lsp", 5)
      expect(result).toHaveLength(0)
    })

    test("max 0 returns nothing", () => {
      const result = ToolSearch.search(ENTRIES, "lsp", 0)
      expect(result).toHaveLength(0)
    })
  })
})

describe("ToolSearch.fmt", () => {
  test("empty entries returns empty string", () => {
    expect(ToolSearch.fmt([])).toBe("")
  })

  test("formats single entry", () => {
    const result = ToolSearch.fmt([{ id: "lsp", hint: "Language server", description: "" }])
    expect(result).toContain("<deferred-tools>")
    expect(result).toContain("</deferred-tools>")
    expect(result).toContain("- lsp: Language server")
    expect(result).toContain("Use tool_search to load them")
  })

  test("formats multiple entries", () => {
    const entries = [
      { id: "lsp", hint: "Language server", description: "" },
      { id: "websearch", hint: "Web search", description: "" },
    ]
    const result = ToolSearch.fmt(entries)
    expect(result).toContain("- lsp: Language server")
    expect(result).toContain("- websearch: Web search")
  })

  test("result is parseable as xml-like block", () => {
    const result = ToolSearch.fmt([{ id: "test", hint: "Test hint", description: "" }])
    expect(result.startsWith("<deferred-tools>")).toBe(true)
    expect(result.endsWith("</deferred-tools>")).toBe(true)
  })
})
