import type { Tool as AITool } from "ai"
import type { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import type { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { threadHasAssistant } from "./wire-tier"

const log = Log.create({ service: "tool-router" })

/**
 * Estimate token count for a string using a fast character-based heuristic.
 * ~4 chars per token for English/Spanish text. Good enough for logging.
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Offline router: after `applyInitialToolTier`, either **narrows** (default) or **adds** (`experimental.tool_router.additive`)
 * from the full registry when the tier left a minimal map.
 *
 * Tool ids are intersected with **agent + session permission + user toggles** (`allowedToolIds` from `resolveTools`)
 * so the model is never advertised tools that `LLM.resolveTools` would strip.
 *
 * When `apply_after_first_assistant` is true (default), skips until an assistant message exists — unless `additive` is true.
 *
 * **Slim descriptions**: tools matched by rules keep their full description; base-only tools get a
 * one-line description to save tokens. The schema (input parameters) is always sent in full.
 *
 * **MCP filtering**: when `mcp_filter_by_intent` is true (default), MCP tools are only attached
 * when a rule matches them or when no rule matches at all (fallback). This avoids sending irrelevant
 * MCP tool definitions on every turn.
 */
const DEFAULT_BASE = ["read", "task", "skill"]

/** Short descriptions for base tools that are available but not the focus of the current turn. */
const SLIM_DESC: Record<string, string> = {
  read: "Read a file or directory.",
  task: "Delegate a task to a subagent.",
  skill: "Load a named skill.",
  glob: "Find files by glob pattern.",
  grep: "Search file contents with regex.",
  bash: "Run a shell command.",
  edit: "Edit a file.",
  write: "Write or overwrite a file.",
  webfetch: "Fetch a URL.",
  websearch: "Search the web.",
  todowrite: "Manage the todo list.",
  question: "Ask the user a question.",
  codesearch: "Search the codebase.",
}

const RULES: { re: RegExp; add: string[]; label: string }[] = [
  { re: /\b(edit|write|patch|refactor)\b/i, add: ["edit", "write", "grep", "read"], label: "edit/refactor" },
  {
    re: /\b(create|add|implement|new file|scaffold|crear|añadir|implementar)\b/i,
    add: ["write", "edit", "grep", "read"],
    label: "create/implement",
  },
  {
    // Spanish: "borralo/borrarlos/borrarlo" are one word — \bborra\b does not match inside them.
    re: /\b(delete|remove|unlink|erase|trash|rm\b|rmdir|borr(?:as|ar|a|alo|ala|arlos|arlas|arlo|arla)|eliminar|elimina|suprimir)\b/i,
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
  {
    re: /\b(find|glob|search files|list files|documentos?|archivos?|listar|repositorio|directorio|chequea|revisa|explora)\b/i,
    add: ["glob", "grep", "read"],
    label: "find/search",
  },
  {
    // Trimmed: removed overly generic words (ver, mira, busca, ejecuta, instala) that matched almost everything.
    re: /\b(verificar|muéstrame|analiza|analizar|encuentra|comprueba|explica|cuáles|cuales|dónde|donde|fichero|código|codigo|proyecto|compila)\b/i,
    add: ["glob", "grep", "read", "task"],
    label: "explore/es",
  },
  {
    // Trimmed: removed overly generic words (show, display, check, look at, browse) that matched almost everything.
    re: /\b(verify|analyze|analyse|install|build|compile|inspect)\b/i,
    add: ["glob", "grep", "read", "task"],
    label: "explore/en",
  },
  {
    re: /https?:\/\/[^\s]+|www\.[^\s]+/i,
    add: ["webfetch", "websearch", "read"],
    label: "web/url",
  },
  {
    re: /\b(http|curl|fetch|url|website|web\s+search|internet|navegador|wikipedia|búsqueda\s+web|en\s+internet|investigar\s+sobre|investigaci[oó]n\s+sobre|investigaci[oó]n\s+de|investigues\s+sobre|investigue\s+sobre|buscar\s+informaci[oó]n\s+sobre|buscar\s+informaci[oó]n\s+de|busca\s+informaci[oó]n\s+sobre|busca\s+informaci[oó]n\s+de|informaci[oó]n\s+sobre|producto\s+externo|software\s+externo|herramienta\s+externa|documentaci[oó]n\s+pública|documentaci[oó]n\s+oficial|mercado\s+externo|research\s+(on|about|into)|look\s+up\s+online|third[- ]party|external\s+(product|software|tool|vendor))\b/i,
    add: ["webfetch", "websearch", "read"],
    label: "web/research",
  },
  { re: /\b(todo\s+list|task\s+list|my\s+todo)\b/i, add: ["todowrite", "read"], label: "todo" },
  { re: /\b(delegate|subagent|sdd-|orchestrat)\b/i, add: ["task", "read"], label: "delegate/sdd" },
  { re: /\b(question|ask me|choose)\b/i, add: ["question"], label: "question" },
  { re: /\b(code ?search|codesearch)\b/i, add: ["codesearch", "read"], label: "codesearch" },
  { re: /\b(skill|load skill)\b/i, add: ["skill", "read"], label: "skill" },
]

/**
 * Context tier returned by the router to tell prompt.ts how much system context to include.
 * - "conversation": greetings, chit-chat — no tools, minimal prompt (~50 tokens)
 * - "minimal": simple questions — base tools only, reduced prompt
 * - "full": everything else — full tool set, full system prompt
 */
export type ContextTier = "conversation" | "minimal" | "full"

/**
 * Conversational keywords — greetings, chit-chat, agent identity questions.
 * These should NOT overlap with tool-related intent.
 * Covers Spanish (rioplatense), English, and Portuguese basics.
 */
const CONVERSATIONAL_RE =
  /^(hi|hello|hey|howdy|hola|buenas|qué tal|como estas|cómo estás|qué onda|que onda|buen día|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|good evening|good night|what'?s up|whats up|yo)\b/i

const CONVERSATIONAL_FULL_RE =
  /\b(what'?s your name|who are you|what can you do|cómo te llamas|quién sos|cómo te llamás|quién eres|qué podés hacer|qué sabes hacer|qué podés|qué hacés|qué haces|ayudame|ayúdame|help me|can you help|podés ayudarme|me ayudás|gracias|thank you|thanks|cheers|appreciate it|te agradezco|chau|bye|goodbye|see you|nos vemos|hasta luego|adiós|saludos|greetings|jaja|lol|xd|😂|👋|🤖|hello there|hi there)\b/i

/**
 * Detect if the user message is purely conversational (no coding/project intent).
 * Must be short and consist only of conversational phrases — no tool keywords.
 */
function detectConversational(text: string): boolean {
  const trimmed = text.trim()
  // Must be reasonably short (conversational messages are typically short)
  if (trimmed.length > 300) return false
  // Check for any tool-related keywords first — if found, NOT conversational
  for (const r of RULES) {
    if (r.re.test(text)) return false
  }
  // Now check if it matches conversational patterns
  return CONVERSATIONAL_RE.test(text) || CONVERSATIONAL_FULL_RE.test(text)
}

function normalizeUserText(raw: string) {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16_000)
}

function userText(msgs: MessageV2.WithParts[]) {
  const u = msgs.findLast((m) => m.info.role === "user")
  if (!u) return ""
  return normalizeUserText(u.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n\n"))
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

function promptHint(input: {
  ids: string[]
  labels: string[]
  additive: boolean
  matched: Set<string>
  allowed?: Set<string>
  availableKeys: Set<string>
}) {
  const intent = input.labels.length ? input.labels.join(", ") : "base only (no keyword rule matched)"
  const lines = [
    "## Offline tool router",
    input.additive
      ? "Mode: additive (minimal tier + rule matches merged from full registry)."
      : "Mode: subtractive (subset of attached tools).",
    `Intent from the last user message (keyword rules): ${intent}.`,
    `Tools attached for this request: ${input.ids.sort().join(", ")}.`,
    "Use only these tools; if something is missing, say so and suggest rephrasing the request.",
  ]
  const blockedByPermission = [...input.matched].filter(
    (id) => input.allowed && !input.allowed.has(id) && input.availableKeys.has(id),
  )
  if (blockedByPermission.length)
    lines.push(
      `Rules suggested tools not available for this agent (permissions or session toggles): ${blockedByPermission.sort().join(", ")}. Delegate with **task** or switch agent if the user needs those capabilities.`,
    )
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
    /** After `applyInitialToolTier` (may be minimal allowlist on first turn). */
    tools: Record<string, AITool>
    /** Full tool map before tier strip; required for additive mode to attach rule-matched ids not in `tools`. */
    registryTools?: Record<string, AITool>
    /** Agent + session permission + user tool toggles; tools not in this set are never attached. */
    allowedToolIds?: Set<string>
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
    /** Tells prompt.ts how much system context to include. */
    contextTier: ContextTier
  }

  export function apply(input: Input): Result {
    const tr = input.cfg.experimental?.tool_router
    const routerOn = Flag.OPENCODE_TOOL_ROUTER || tr?.enabled
    if (!routerOn || input.skip) {
      const ids = Object.keys(input.tools).sort()
      const hint = `## Offline tool router\nMode: disabled.\nAll ${ids.length} tools available: ${ids.join(", ")}.\nUse the tools that match the user's request.`
      log.info("tool_router", {
        tier: "full",
        selected: ids,
        reason: "router off or skipped",
        tokens: { toolCount: ids.length },
      })
      return { tools: input.tools, promptHint: hint, contextTier: "full" }
    }
    if (input.agent.name === "compaction" || input.agent.mode === "compaction") {
      const ids = Object.keys(input.tools).sort()
      const hint = `## Offline tool router\nMode: compaction agent.\nAll ${ids.length} tools available: ${ids.join(", ")}.\nUse the tools that match the user's request.`
      log.info("tool_router", {
        tier: "full",
        selected: ids,
        reason: "compaction agent",
        tokens: { toolCount: ids.length },
      })
      return { tools: input.tools, promptHint: hint, contextTier: "full" }
    }

    const additive = tr?.additive === true
    const hasAssistant = threadHasAssistant(input.messages)

    // ── Conversational mode: greetings, chit-chat — no tools, minimal prompt.
    // Check BEFORE apply_after_first_assistant so T1 "hola" doesn't get full context.
    const text = userText(input.messages)
    if (detectConversational(text)) {
      log.info("tool_router", {
        tier: "conversation",
        selected: [],
        builtin: [],
        mcp: [],
        reason: "conversational",
        userPreview: text.slice(0, 120),
        hasAssistant,
        tokens: { toolCount: 0, toolTokens: 0, promptHintTokens: 0 },
      })
      return { tools: {}, promptHint: undefined, contextTier: "conversation" }
    }

    if (!additive && tr?.apply_after_first_assistant !== false && !hasAssistant) {
      const ids = Object.keys(input.tools).sort()
      const hint = `## Offline tool router\nMode: first turn (all tools).\nAll ${ids.length} tools available: ${ids.join(", ")}.\nUse the tools that match the user's request.`
      log.info("tool_router", {
        tier: "full",
        selected: ids,
        reason: "first turn, apply_after_first_assistant=true",
        userPreview: text.slice(0, 120),
        tokens: { toolCount: ids.length },
      })
      return { tools: input.tools, promptHint: hint, contextTier: "full" }
    }

    const full = input.registryTools ?? input.tools
    const availableKeys = new Set(Object.keys(additive ? full : input.tools))
    const allowed = input.allowedToolIds
    const available = new Set([...availableKeys].filter((id) => (allowed ? allowed.has(id) : true)))
    const base = tr?.base_tools?.length ? tr.base_tools : DEFAULT_BASE
    const max = tr?.max_tools ?? 12
    const mcpAlways = tr?.mcp_always_include !== false

    const matched = new Set<string>()
    const labels: string[] = []
    for (const r of RULES) {
      if (!r.re.test(text)) continue
      labels.push(r.label)
      for (const id of r.add) matched.add(id)
    }

    const noMatchFb = tr?.no_match_fallback !== false
    const fbTools = tr?.no_match_fallback_tools ?? ["glob", "grep", "read", "task"]
    if (labels.length === 0 && noMatchFb) {
      labels.push("fallback/no_match")
      for (const id of fbTools) matched.add(id)
    }

    const builtinAvailable = new Set([...available].filter((id) => !input.mcpIds.has(id)))
    const fromRules = orderIds(base, matched, builtinAvailable, max)
    // Additive: keep every tool from the tier-limited map (e.g. minimal + bash for sdd-init), then rule matches — otherwise rule orderIds can drop bash.
    const ordered = additive ? [...new Set([...Object.keys(input.tools), ...fromRules])].slice(0, max) : fromRules

    // Tools matched by rules keep full descriptions; base-only tools get slim descriptions.
    const ruleMatched = new Set<string>()
    for (const r of RULES) {
      if (r.re.test(text)) {
        for (const id of r.add) ruleMatched.add(id)
      }
    }

    const out: Record<string, AITool> = {}
    for (const id of ordered) {
      const t = additive ? (input.tools[id] ?? input.registryTools?.[id]) : input.tools[id]
      if (!t) continue
      // Apply slim description for base tools not matched by any rule
      if (!ruleMatched.has(id) && SLIM_DESC[id] && t.description !== SLIM_DESC[id]) {
        out[id] = { ...t, description: SLIM_DESC[id] }
      } else {
        out[id] = t
      }
    }

    // MCP tools: filter by intent when mcp_filter_by_intent is true (default).
    // MCP tools whose id is matched by a rule are included;
    // otherwise they are only included on fallback (no rule matched) or when mcp_always_include is true.
    const mcpFilter = tr?.mcp_filter_by_intent !== false
    const rulesMatched = labels.length > 0 && labels[0] !== "fallback/no_match"
    if (mcpAlways) {
      for (const id of input.mcpIds) {
        const t = additive ? (input.tools[id] ?? input.registryTools?.[id]) : input.tools[id]
        if (!t) continue
        if (mcpFilter && rulesMatched && !matched.has(id)) {
          // Rule matched but this MCP tool was not in any rule — skip it.
          continue
        }
        if (!mcpFilter && SLIM_DESC[id] && t.description !== SLIM_DESC[id]) {
          out[id] = { ...t, description: SLIM_DESC[id] }
        } else {
          out[id] = t
        }
      }
    }

    if (Object.keys(out).length === 0 && Object.keys(input.tools).length > 0) {
      const ids = Object.keys(input.tools).sort()
      const hint = `## Offline tool router\nMode: empty passthrough.\nAll ${ids.length} tools available: ${ids.join(", ")}.\nUse the tools that match the user's request.`
      log.warn("tool_router_empty_passthrough")
      return { tools: input.tools, promptHint: hint, contextTier: "full" }
    }

    const inject = tr?.inject_prompt !== false
    const ids = Object.keys(out)
    const hint = inject ? promptHint({ ids, labels, additive, matched, allowed, availableKeys }) : undefined

    // ── Token accounting for logging
    const toolTokens = (() => {
      let total = 0
      for (const id of ids) {
        const t = out[id]
        if (t?.description) total += estimateTokens(t.description)
      }
      return total
    })()
    const promptHintTokens = hint ? estimateTokens(hint) : 0

    log.info("tool_router", {
      tier: labels.length === 0 ? "minimal" : "full",
      selected: ids.sort(),
      builtin: fromRules.sort(),
      mcp: mcpAlways ? [...input.mcpIds].filter((id) => out[id]).sort() : [],
      reason: additive ? "additive" : "rules",
      labels,
      userPreview: text.slice(0, 120),
      hasAssistant,
      tokens: {
        toolCount: ids.length,
        toolTokens,
        promptHintTokens,
        total: toolTokens + promptHintTokens,
      },
    })

    return { tools: out, promptHint: hint, contextTier: labels.length === 0 ? "minimal" : "full" }
  }
}
