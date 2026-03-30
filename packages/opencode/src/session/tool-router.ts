import type { Tool as AITool } from "ai"
import type { Config } from "@/config/config"
import type { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool-router" })

const DEFAULT_BASE = ["read", "task", "skill"]

const RULES: { re: RegExp; add: string[] }[] = [
  { re: /\b(edit|write|patch|refactor)\b/i, add: ["edit", "write", "grep", "read"] },
  { re: /\b(test|npm test|pytest|jest|vitest|mocha|cargo test)\b/i, add: ["bash", "read"] },
  { re: /\b(shell|bash|run|execute|pnpm|yarn|cargo|make)\b/i, add: ["bash", "read"] },
  { re: /\b(find|glob|search files|list files)\b/i, add: ["glob", "grep", "read"] },
  { re: /\b(http|curl|fetch|url|website|web search)\b/i, add: ["webfetch", "websearch"] },
  { re: /\b(todo|task list)\b/i, add: ["todowrite", "read"] },
  { re: /\b(delegate|subagent|sdd-|orchestrat)\b/i, add: ["task", "read"] },
  { re: /\b(question|ask me|choose)\b/i, add: ["question"] },
  { re: /\b(code ?search|codesearch)\b/i, add: ["codesearch", "read"] },
  { re: /\b(skill|load skill)\b/i, add: ["skill", "read"] },
]

function userText(msgs: MessageV2.WithParts[]) {
  const u = msgs.findLast((m) => m.info.role === "user")
  if (!u) return ""
  return u.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n\n")
    .trim()
}

function orderIds(base: string[], extra: Set<string>, available: Set<string>, max: number) {
  const out: string[] = []
  for (const id of base) {
    if (out.length >= max) break
    if (available.has(id) && !out.includes(id)) out.push(id)
  }
  for (const id of extra) {
    if (out.length >= max) break
    if (available.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

export namespace ToolRouter {
  export type Input = {
    tools: Record<string, AITool>
    messages: MessageV2.WithParts[]
    agent: { name: string; mode: string }
    cfg: Config.Info
    mcpIds: Set<string>
    skip: boolean
  }

  export function apply(input: Input): Record<string, AITool> {
    const tr = input.cfg.experimental?.tool_router
    if (!tr?.enabled || input.skip) return input.tools
    if (input.agent.name === "compaction" || input.agent.mode === "compaction") return input.tools

    const hasAssistant = input.messages.some((m) => m.info.role === "assistant")
    if (tr.apply_after_first_assistant !== false && !hasAssistant) return input.tools

    const text = userText(input.messages)
    const available = new Set(Object.keys(input.tools))
    const base = tr.base_tools?.length ? tr.base_tools : DEFAULT_BASE
    const max = tr.max_tools ?? 12
    const mcpAlways = tr.mcp_always_include !== false

    const matched = new Set<string>()
    for (const r of RULES) {
      if (!r.re.test(text)) continue
      for (const id of r.add) matched.add(id)
    }

    const builtinAvailable = new Set([...available].filter((id) => !input.mcpIds.has(id)))
    const ordered = orderIds(base, matched, builtinAvailable, max)

    const out: Record<string, AITool> = {}
    for (const id of ordered) {
      const t = input.tools[id]
      if (t) out[id] = t
    }

    if (mcpAlways) {
      for (const id of input.mcpIds) {
        const t = input.tools[id]
        if (t) out[id] = t
      }
    }

    if (Object.keys(out).length === 0 && Object.keys(input.tools).length > 0) {
      log.warn("tool_router_empty_passthrough")
      return input.tools
    }

    log.info("tool_router", {
      selected: Object.keys(out).sort(),
      builtin: ordered.sort(),
      mcp: mcpAlways ? [...input.mcpIds].filter((id) => out[id]).sort() : [],
      reason: "rules",
      userPreview: text.slice(0, 120),
    })

    return out
  }
}
