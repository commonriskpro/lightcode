import type { Tool as AITool } from "ai"
import type { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import type { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { threadHasAssistant } from "./wire-tier"

const log = Log.create({ service: "tool-router" })

/**
 * Offline router: narrows `tools` after permissions, after `applyInitialToolTier`.
 * When `apply_after_first_assistant` is true (default), skips until an assistant message exists (pairs with `initial_tool_tier` on T1).
 * `threadHasAssistant` / `routerFiltersFirstTurn` (`wire-tier.ts`) use the same assistant check for system prompt policy.
 *
 * Rules are **intent buckets** (synonyms / multilingual), not an embedding model — see docs/spec-offline-tool-router.md §6.2 for future semantic routing.
 */
const DEFAULT_BASE = ["read", "task", "skill"]

const RULES: { re: RegExp; add: string[]; label: string }[] = [
  { re: /\b(edit|write|patch|refactor)\b/i, add: ["edit", "write", "grep", "read"], label: "edit/refactor" },
  {
    re: /\b(create|add|implement|new file|scaffold|crear|añadir|implementar)\b/i,
    add: ["write", "edit", "grep", "read"],
    label: "create/implement",
  },
  {
    re: /\b(delete|remove|unlink|erase|trash|rm\b|rmdir|borrar|borra|borras|eliminar|elimina|suprimir)\b/i,
    add: ["bash", "edit", "write", "read", "glob"],
    label: "delete/remove",
  },
  {
    re: /\b(move|rename|mv\b|relocate|mover|renombrar)\b/i,
    add: ["bash", "read", "glob"],
    label: "move/rename",
  },
  { re: /\b(fix|debug|bug|broken|arreglar|depurar)\b/i, add: ["edit", "grep", "read", "bash"], label: "fix/debug" },
  { re: /\b(test|npm test|pytest|jest|vitest|mocha|cargo test)\b/i, add: ["bash", "read"], label: "test" },
  { re: /\b(shell|bash|run|execute|pnpm|yarn|cargo|make)\b/i, add: ["bash", "read"], label: "shell/run" },
  { re: /\b(find|glob|search files|list files)\b/i, add: ["glob", "grep", "read"], label: "find/search" },
  { re: /\b(http|curl|fetch|url|website|web search)\b/i, add: ["webfetch", "websearch"], label: "web" },
  // Avoid matching Spanish "todo" (= everything) in phrases like "borrar todo"
  { re: /\b(todo\s+list|task\s+list|my\s+todo)\b/i, add: ["todowrite", "read"], label: "todo" },
  { re: /\b(delegate|subagent|sdd-|orchestrat)\b/i, add: ["task", "read"], label: "delegate/sdd" },
  { re: /\b(question|ask me|choose)\b/i, add: ["question"], label: "question" },
  { re: /\b(code ?search|codesearch)\b/i, add: ["codesearch", "read"], label: "codesearch" },
  { re: /\b(skill|load skill)\b/i, add: ["skill", "read"], label: "skill" },
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

function promptHint(input: { ids: string[]; labels: string[] }) {
  const intent = input.labels.length ? input.labels.join(", ") : "base only (no keyword rule matched)"
  const lines = [
    "## Offline tool router",
    `Intent from the last user message (keyword rules): ${intent}.`,
    `Tools attached for this request: ${input.ids.sort().join(", ")}.`,
    "Use only these tools; if something is missing, say so and suggest rephrasing the request.",
  ]
  const wantsDelete = input.labels.includes("delete/remove")
  const hasDestructive = ["bash", "edit", "write"].some((id) => input.ids.includes(id))
  if (wantsDelete && !hasDestructive)
    lines.push(
      "Delete/remove intent: this agent has no bash/edit/write in the tool set. Use the **task** tool to delegate to a subagent that can edit or run shell (e.g. `build` or `sdd-apply`), or switch primary agent.",
    )
  return lines.join("\n")
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

  export type Result = {
    tools: Record<string, AITool>
    /** Appended to system prompt so the model sees intent + tool allowlist. */
    promptHint?: string
  }

  export function apply(input: Input): Result {
    const tr = input.cfg.experimental?.tool_router
    const routerOn = Flag.OPENCODE_TOOL_ROUTER || tr?.enabled
    if (!routerOn || input.skip) return { tools: input.tools }
    if (input.agent.name === "compaction" || input.agent.mode === "compaction") return { tools: input.tools }

    const hasAssistant = threadHasAssistant(input.messages)
    if (tr?.apply_after_first_assistant !== false && !hasAssistant) return { tools: input.tools }

    const text = userText(input.messages)
    const available = new Set(Object.keys(input.tools))
    const base = tr?.base_tools?.length ? tr.base_tools : DEFAULT_BASE
    const max = tr?.max_tools ?? 12
    const mcpAlways = tr?.mcp_always_include !== false
    const beforeBytes = JSON.stringify(input.tools).length

    const matched = new Set<string>()
    const labels: string[] = []
    for (const r of RULES) {
      if (!r.re.test(text)) continue
      labels.push(r.label)
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
      return { tools: input.tools }
    }

    const inject = tr?.inject_prompt !== false
    const ids = Object.keys(out)
    const hint = inject ? promptHint({ ids, labels }) : undefined

    log.info("tool_router", {
      selected: ids.sort(),
      builtin: ordered.sort(),
      mcp: mcpAlways ? [...input.mcpIds].filter((id) => out[id]).sort() : [],
      reason: "rules",
      userPreview: text.slice(0, 120),
      bytes_saved_estimate: Math.max(0, beforeBytes - JSON.stringify(out).length),
      inject_prompt: inject,
    })

    return { tools: out, promptHint: hint }
  }
}
