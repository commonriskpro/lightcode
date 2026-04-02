import type { Tool as AITool } from "ai"
import type { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import {
  augmentMatchedEmbed,
  classifyIntentEmbed,
  CONVERSATION_INTENT_LABEL,
  DEFAULT_LOCAL_EMBED_MODEL,
  ROUTER_INTENT_PROTOTYPES,
} from "./router-embed"
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
 * When `apply_after_first_assistant` is `true`, skip narrowing on the first user turn (full tools until an assistant exists). Config default is `false` (router narrows from turn 1). `additive` bypasses the skip branch.
 *
 * **Slim descriptions**: tools matched by rules keep their full description; base-only tools get a
 * one-line description to save tokens. The schema (input parameters) is always sent in full.
 *
 * **MCP filtering**: when `mcp_filter_by_intent` is true (default), MCP tools are only attached
 * when a rule matches them or when no rule matches at all (fallback). This avoids sending irrelevant
 * MCP tool definitions on every turn.
 *
 * **Hybrid mode** (`experimental.tool_router.mode: "hybrid"` or `OPENCODE_TOOL_ROUTER_MODE=hybrid`): optionally
 * **intent classification** (`local_intent_embed`: embedding similarity vs built-in multilingual prototypes) merges tools
 * **before** keyword rules (unless `keyword_rules: false`); then augment with **local embeddings** (`local_embed` / `local_embed_model`,
 * `@huggingface/transformers`, default `Xenova/paraphrase-multilingual-MiniLM-L12-v2`) or a **remote small LLM**
 * (`router_model`, `small_model`, `Provider.getSmallModel`). Local embed path takes precedence when enabled.
 * Default `keyword_rules` is **false**: local intent + tool embeddings only. Set `keyword_rules: true` to also apply regex `RULES` (legacy).
 *
 * **Conversation tier** (`contextTier: "conversation"`) comes **only** from local intent embed: `hybrid` + `local_embed` + `local_intent_embed`, and `classifyIntentEmbed` must label the message as the built-in **conversation** prototype (see `ROUTER_INTENT_PROTOTYPES`). There are **no** regex/heuristic shortcuts for chit-chat.
 */
const DEFAULT_BASE = ["read", "task", "skill"]

/** Short descriptions for base tools when not rule-matched (keeps tool list tokens small). */
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

/**
 * Richer lines **only** for `augmentMatchedEmbed` (Xenova): synonyms + ES gloss so multilingual
 * similarity matches real user phrasing. Not used for on-wire tool descriptions.
 */
const EMBED_PHRASE: Record<string, string> = {
  read: "Read a file or directory. Open file contents. Leer archivo o carpeta. Ver fichero.",
  task: "Delegate a task to a subagent. Spawn agent. Delegar subtarea. Otro agente.",
  skill: "Load a named skill. Activate skill by name. Cargar skill.",
  glob: "Find files by glob pattern. List matching paths. Buscar archivos por patrón. Listar rutas.",
  grep: "Search file contents with regex. Ripgrep text in repo. Buscar texto en código. Patrón en archivos.",
  bash: "Run a shell command. Terminal script. Ejecutar comando consola. Correr script.",
  edit: "Edit a file. Apply patch to source. Modificar código. Cambiar implementación.",
  write: "Write or overwrite a file. Create new file. Escribir archivo. Crear fichero nuevo.",
  webfetch: "Fetch a URL. Download HTTP page. Descargar página web. GET url.",
  websearch: "Search the web. Look up online. Búsqueda en internet. Documentación online.",
  todowrite: "Manage the todo list. Track tasks. Lista de tareas. Pendientes.",
  question: "Ask the user a question. Clarify choice. Preguntar al usuario. Elegir opción.",
  codesearch: "Search the codebase semantically. Find code by meaning. Búsqueda semántica en repo.",
}

const RULES: { re: RegExp; add: string[]; label: string }[] = [
  {
    re: /\b(edit|editá|edita|write|patch|refactor)\b/i,
    add: ["edit", "write", "grep", "read"],
    label: "edit/refactor",
  },
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
    re: /\b(screenshots?|fotos?|im[aá]genes?|miniaturas?|thumbnails?|photos?|pics?|capturas?|mostrar\s+(?:unas?\s+)?(?:fotos?|im[aá]genes?|capturas?))\b/i,
    add: ["webfetch", "websearch", "read"],
    label: "web/screenshot-media",
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

function embedPhraseFor(
  input: { tools: Record<string, AITool>; registryTools?: Record<string, AITool> },
  id: string,
) {
  const builtin = EMBED_PHRASE[id] ?? SLIM_DESC[id]
  if (builtin) return `${id}. ${builtin}`
  const t = input.registryTools?.[id] ?? input.tools[id]
  const d = typeof t?.description === "string" ? t.description.slice(0, 240) : ""
  return d ? `${id}. ${d}` : `${id} coding agent tool`
}

/**
 * Context tier returned by the router to tell prompt.ts how much system context to include.
 * - "conversation": local intent embed `conversation` only — no tools, minimal prompt (~50 tokens)
 * - "minimal": simple questions — base tools only, reduced prompt
 * - "full": everything else — full tool set, full system prompt
 */
export type ContextTier = "conversation" | "minimal" | "full"

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

/** Strip prompt-injection wrappers so routing matches the user's real words (multi-step turns). */
function stripRouterDecorators(raw: string): string {
  return raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim()
}

function routerUserText(msgs: MessageV2.WithParts[]) {
  return stripRouterDecorators(userText(msgs))
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

function orderMatched(matched: Set<string>, available: Set<string>, max: number) {
  const out: string[] = []
  for (const id of matched) {
    if (out.length >= max) break
    if (available.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** Last completed assistant message may store which tool ids were sent to the model; carry them forward for cache-aligned tool defs. */
export function stickyToolIdsFromMessages(messages: MessageV2.WithParts[]): string[] | undefined {
  const last = messages.findLast((m) => m.info.role === "assistant")
  if (!last || last.info.role !== "assistant") return
  const ids = last.info.toolRouterActiveIds
  if (!ids?.length) return
  return ids
}

function trimToolMap(out: Record<string, AITool>, max: number, sticky: Set<string>) {
  const keys = Object.keys(out)
  if (keys.length <= max) return out
  const stickyKeys = keys.filter((k) => sticky.has(k))
  const rest = keys.filter((k) => !sticky.has(k))
  const restKeep = rest.slice(0, Math.max(0, max - stickyKeys.length))
  const keep = new Set([...stickyKeys, ...restKeep])
  const next: Record<string, AITool> = {}
  for (const id of keys) {
    if (keep.has(id)) next[id] = out[id]!
  }
  return next
}

function promptHint(input: {
  ids: string[]
  labels: string[]
  additive: boolean
  matched: Set<string>
  allowed?: Set<string>
  availableKeys: Set<string>
}) {
  const intent = input.labels.length ? input.labels.join(", ") : "no xenova intent/tool match"
  const lines = [
    "## Offline tool router",
    input.additive
      ? "Mode: additive (minimal tier + rule matches merged from full registry)."
      : "Mode: subtractive (subset of attached tools).",
    `Intent from the last user message (xenova): ${intent}.`,
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
    /** Session chat model — used to pick a small model via Provider.getSmallModel when hybrid mode has no router_model/small_model. */
    model?: Provider.Model
    cfg: Config.Info
    mcpIds: Set<string>
    skip: boolean
    /** Tool ids from the previous assistant message (`toolRouterActiveIds`); merged so the model does not lose tools between turns. */
    stickyToolIds?: string[]
  }

  export type Result = {
    tools: Record<string, AITool>
    /** Appended to system prompt so the model sees intent + tool allowlist. */
    promptHint?: string
    /** Tells prompt.ts how much system context to include. */
    contextTier: ContextTier
  }

  export async function apply(input: Input): Promise<Result> {
    const start = performance.now()
    const ms = () => Math.round((performance.now() - start) * 100) / 100
    const tr = input.cfg.experimental?.tool_router
    const routerOnly = Flag.OPENCODE_TOOL_ROUTER_ONLY || tr?.router_only === true
    const routerOn = Flag.OPENCODE_TOOL_ROUTER || tr?.enabled
    if (!routerOn || input.skip) {
      const ids = Object.keys(input.tools).sort()
      const hint = `## Offline tool router\nMode: disabled.\nAll ${ids.length} tools available: ${ids.join(", ")}.\nUse the tools that match the user's request.`
      log.info("tool_router", {
        tier: "full",
        selected: ids,
        reason: "router off or skipped",
        tokens: { toolCount: ids.length },
        duration_ms: ms(),
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
        duration_ms: ms(),
      })
      return { tools: input.tools, promptHint: hint, contextTier: "full" }
    }

    const additive = tr?.additive === true
    const hasAssistant = threadHasAssistant(input.messages)
    const text = routerUserText(input.messages)

    const trLlm = input.cfg.experimental?.tool_router
    const useEmbed = true
    const embedModel =
      process.env.OPENCODE_TOOL_ROUTER_EMBED_MODEL?.trim() ||
      trLlm?.local_embed_model?.trim() ||
      DEFAULT_LOCAL_EMBED_MODEL
    const hybridIntent = trLlm?.local_intent_embed === true

    let intentHit: Awaited<ReturnType<typeof classifyIntentEmbed>> | undefined

    if (hybridIntent) {
      intentHit = await classifyIntentEmbed({
        userText: text,
        model: embedModel,
        minScore: trLlm?.local_intent_min_score ?? 0.38,
        prototypes: ROUTER_INTENT_PROTOTYPES,
      })
      if (intentHit?.label === CONVERSATION_INTENT_LABEL) {
        log.info("tool_router", {
          tier: "conversation",
          selected: [],
          builtin: [],
          mcp: [],
          reason: "xenova_conversation",
          score: intentHit.score,
          userPreview: text.slice(0, 120),
          hasAssistant,
          tokens: { toolCount: 0, toolTokens: 0, promptHintTokens: 0 },
          duration_ms: ms(),
        })
        return { tools: {}, promptHint: undefined, contextTier: "conversation" }
      }
    }

    if (!additive && tr?.apply_after_first_assistant === true && !hasAssistant) {
      const ids = Object.keys(input.tools).sort()
      const hint = `## Offline tool router\nMode: first turn (all tools).\nAll ${ids.length} tools available: ${ids.join(", ")}.\nUse the tools that match the user's request.`
      log.info("tool_router", {
        tier: "full",
        selected: ids,
        reason: "first turn, apply_after_first_assistant=true",
        userPreview: text.slice(0, 120),
        tokens: { toolCount: ids.length },
        duration_ms: ms(),
      })
      return { tools: input.tools, promptHint: hint, contextTier: "full" }
    }

    const full = input.registryTools ?? input.tools
    const availableKeys = new Set(Object.keys(additive ? full : input.tools))
    const allowed = input.allowedToolIds
    const available = new Set([...availableKeys].filter((id) => (allowed ? allowed.has(id) : true)))
    const base = tr?.base_tools?.length ? tr.base_tools : DEFAULT_BASE
    const autoPick = trLlm?.auto_tool_selection === true
    const max = autoPick ? (trLlm?.max_tools_cap ?? 100) : (tr?.max_tools ?? 12)
    const mcpAlways = tr?.mcp_always_include !== false
    const stickyList =
      (tr?.sticky_previous_turn_tools !== false ? input.stickyToolIds : undefined)?.filter((id) =>
        input.allowedToolIds ? input.allowedToolIds.has(id) : true,
      ) ?? []
    const stickySet = new Set(stickyList)

    const matched = new Set<string>()
    const intentLabels: string[] = []

    const builtinAvailable = new Set([...available].filter((id) => !input.mcpIds.has(id)))

    const keywordRules = false

    if (hybridIntent && intentHit) {
      for (const id of intentHit.added) {
        if (builtinAvailable.has(id)) matched.add(id)
      }
      intentLabels.push(`intent:${intentHit.label}`)
    }

    const ruleLabels: string[] = []
    if (keywordRules) {
      for (const r of RULES) {
        if (!r.re.test(text)) continue
        ruleLabels.push(r.label)
        for (const id of r.add) matched.add(id)
      }
    }

    const labels = [...intentLabels, ...ruleLabels]

    let hybridAugmented = false
    const aug = await augmentMatchedEmbed({
      userText: text,
      matched,
      allowedBuiltin: builtinAvailable,
      model: embedModel,
      topK: trLlm?.local_embed_top_k ?? 4,
      minScore: trLlm?.local_embed_min_score ?? 0.32,
      auto: autoPick
        ? {
            enabled: true,
            ratio: trLlm?.auto_score_ratio ?? 0.88,
            tokenBudget: trLlm?.auto_token_budget ?? 1_200,
            maxCap: trLlm?.max_tools_cap ?? 100,
          }
        : undefined,
      phraseFor: (id) => embedPhraseFor(input, id),
    })
    if (aug?.added.length) {
      hybridAugmented = true
      for (const id of aug.added) matched.add(id)
      labels.push(aug.note ? `embed:${aug.note.slice(0, 100)}` : "embed/extra")
    }
    if (autoPick) {
      log.info("router_embed_auto_policy", {
        added: aug?.added.length ?? 0,
        ratio: trLlm?.auto_score_ratio ?? 0.88,
        token_budget: trLlm?.auto_token_budget ?? 1_200,
        max_cap: trLlm?.max_tools_cap ?? 100,
      })
    }

    const hadRouterSignal = intentLabels.length > 0 || ruleLabels.length > 0 || hybridAugmented
    // Xenova is the direct decision engine: rank/order by embed-selected ids.
    // Keep base tools only if explicitly configured and xenova produced no match.
    const fromEmbed = orderMatched(matched, builtinAvailable, max)
    const ordered = fromEmbed.length > 0 ? fromEmbed : orderIds(base, new Set(), builtinAvailable, max)

    // Tools matched by rules (or embed-only path: everything in `matched`) keep full descriptions; base-only tools get slim.
    const ruleMatched = new Set<string>()
    if (keywordRules) {
      for (const r of RULES) {
        if (r.re.test(text)) {
          for (const id of r.add) ruleMatched.add(id)
        }
      }
    } else {
      for (const id of matched) ruleMatched.add(id)
    }

    let out: Record<string, AITool> = {}
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
    const rulesMatched = matched.size > 0
    if (mcpAlways && (!routerOnly || hadRouterSignal)) {
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

    // Carry-over from previous turn: keep tool defs aligned with prompt cache (sticky ids are cheap to retain).
    if (stickyList.length > 0) {
      for (const id of stickyList) {
        if (out[id]) continue
        const t = additive ? (input.tools[id] ?? input.registryTools?.[id]) : input.tools[id]
        if (!t) continue
        out[id] = t
      }
      if (Object.keys(out).length > max) {
        out = trimToolMap(out, max, stickySet)
      }
    }

    if (Object.keys(out).length === 0) {
      const hint = tr?.inject_prompt !== false ? promptHint({ ids: [], labels, additive, matched, allowed, availableKeys }) : undefined
      log.info("tool_router", {
        tier: "minimal",
        selected: [],
        reason: "xenova_no_match",
        labels,
        userPreview: text.slice(0, 120),
        hasAssistant,
        tokens: { toolCount: 0, toolTokens: 0, promptHintTokens: hint ? estimateTokens(hint) : 0 },
        duration_ms: ms(),
      })
      return { tools: {}, promptHint: hint, contextTier: "minimal" }
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
      builtin: ordered.slice().sort(),
      mcp: mcpAlways ? [...input.mcpIds].filter((id) => out[id]).sort() : [],
      reason: additive ? "additive" : "xenova",
      labels,
      userPreview: text.slice(0, 120),
      hasAssistant,
      tokens: {
        toolCount: ids.length,
        toolTokens,
        promptHintTokens,
        total: toolTokens + promptHintTokens,
      },
      duration_ms: ms(),
    })

    return { tools: out, promptHint: hint, contextTier: labels.length === 0 ? "minimal" : "full" }
  }
}
