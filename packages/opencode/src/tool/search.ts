import z from "zod"
import { Tool } from "./tool"

export namespace ToolSearch {
  export interface Entry {
    id: string
    hint: string
    description: string
  }

  function score(entry: Entry, terms: string[]): number {
    let total = 0
    const id = entry.id.toLowerCase()
    const hint = entry.hint.toLowerCase()
    const desc = entry.description.toLowerCase()
    for (const term of terms) {
      if (id === term) total += 20
      else if (id.includes(term)) total += 10
      if (hint.includes(term)) total += 5
      if (desc.includes(term)) total += 2
    }
    return total
  }

  export function search(entries: Entry[], query: string, max: number): Entry[] {
    const lower = query.toLowerCase().trim()

    // select:tool1,tool2 — exact multi-select
    const select = lower.match(/^select:(.+)$/)
    if (select) {
      const names = new Set(select[1].split(",").map((s) => s.trim()))
      return entries.filter((e) => names.has(e.id.toLowerCase()) || names.has(e.id))
    }

    // +required term filtering
    const raw = lower.split(/\s+/).filter((t) => t.length > 0)
    const required: string[] = []
    const optional: string[] = []
    for (const t of raw) {
      if (t.startsWith("+") && t.length > 1) required.push(t.slice(1))
      else optional.push(t)
    }

    let pool = entries
    if (required.length > 0) {
      pool = entries.filter((e) => {
        const hay = `${e.id} ${e.hint} ${e.description}`.toLowerCase()
        return required.every((r) => hay.includes(r))
      })
    }

    const terms = [...required, ...optional]
    return pool
      .map((entry) => ({ entry, score: score(entry, terms) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((s) => s.entry)
  }

  export function fmt(entries: Entry[]): string {
    if (entries.length === 0) return ""
    return [
      "<deferred-tools>",
      "The following tools are available but not loaded. Use tool_search to load them:",
      ...entries.map((e) => `- ${e.id}: ${e.hint}`),
      "</deferred-tools>",
    ].join("\n")
  }
}

export const ToolSearchTool = Tool.define("tool_search", {
  description: `Search and load deferred tools by name or keyword.

After this tool returns, the matched tools become callable in subsequent turns.
Available deferred tools are listed in <deferred-tools> in the system prompt.

Query formats:
- "select:webfetch,lsp" — load specific tools by exact name
- "web search" — keyword search, returns up to max_results
- "+mcp slack" — require "mcp" in name, rank by remaining terms`,
  parameters: z.object({
    query: z.string().describe("Search query or select:tool_name,tool_name2"),
    max_results: z.number().optional().default(5).describe("Max results (default 5)"),
  }),
  // execute is a placeholder — the real execution is wired in SessionPrompt.resolveTools
  // where we have access to the deferred tools dict
  async execute({ query, max_results }) {
    return {
      title: "tool_search",
      metadata: { matches: [] as string[] },
      output: "No deferred tools available.",
    }
  },
})
