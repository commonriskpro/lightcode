import type { Tool as AITool } from "ai"
import type { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import {
  augmentMatchedEmbed,
  classifyIntentEmbedMerged,
  CONVERSATION_INTENT_LABEL,
  DEFAULT_LOCAL_EMBED_MODEL,
  ROUTER_INTENT_PROTOTYPES,
} from "./router-embed"
import { applyRouterPolicy, isWebIntentEmbed, lexicalSignals, splitClauses } from "./router-policy"
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
 * Offline router: **narrows** (default) or **adds** (`experimental.tool_router.additive`) from the full registry
 * when the additive flag is set.
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
 * Default `keyword_rules` is **false** (intent + local embed first); set **`keyword_rules: true`** to also union regex `RULES` on the user text. Lexical seeds (ask_me, question, strong_write, …) run either way. With `keyword_rules: true`, full tool descriptions apply to regex hits **and** semantic ids (intent/embed augment/lexical/sticky).
 *
 * **Conversation tier** (`contextTier: "conversation"`) comes **only** from local intent embed: `hybrid` + `local_embed` + `local_intent_embed`, and `classifyIntentEmbedMerged` must mark **conversation** exclusive (see `ROUTER_INTENT_PROTOTYPES`). No regex shortcuts for chit-chat; augment is skipped when conversation wins clearly.
 */
/** Short descriptions for tools when not rule-matched (keeps tool list tokens small). */
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
  apply_patch: "Apply patch to files.",
  batch: "Run multiple tools in parallel.",
  lsp: "Language server navigation.",
  plan_exit: "Exit plan mode and offer build agent.",
}

/**
 * Richer lines **only** for `augmentMatchedEmbed` (Xenova): synonyms + ES gloss so multilingual
 * similarity matches real user phrasing. Not used for on-wire tool descriptions.
 */
const EMBED_PHRASE: Record<string, string> = {
  read:
    "Read-only: open file or directory and view contents. Summarize, extract, explain defaults from file text without modifying. Leer y explicar; revisa contenido y dime; solo lectura.",
  task: "Delegate a task to a subagent. Spawn agent. Delegar subtarea. Otro agente.",
  skill: "Load a named skill. Activate skill by name. Cargar skill.",
  glob:
    "List file paths by glob mask (*.ts **/test). Find files by name pattern. Not searching text inside files. Archivos por patrón; rutas que coinciden.",
  grep:
    "Ripgrep: literal or regex search inside file contents. Find string TODO in sources. Not semantic meaning search. Texto literal en archivos.",
  bash:
    "Run a shell command in terminal: npm run, bun, pnpm, git status, cargo test, typecheck. ejecuta comando consola. Not reading a file.",
  edit:
    "Change an existing file in place: patch, refactor lines already on disk. Editar archivo existente. Not creating a brand-new file from scratch.",
  write:
    "Create new file or overwrite whole file: changelog entry, plan.md, save report. crear archivo nuevo; escribir markdown nuevo; rollout doc file.",
  webfetch: "Fetch a URL. Download HTTP page. Descargar página web. GET url.",
  websearch: "Search the web. Look up online. Búsqueda en internet. Documentación online.",
  todowrite:
    "Update session todo checklist: mark task done, pending items in the todo list. Not project rollout steps or creating plan.md files.",
  question: "Ask the user a question. Clarify choice. Preguntar al usuario. Elegir opción.",
  codesearch:
    "Semantic codebase search by concept (embeddings). Find implementation by meaning. Not npm run or shell. Not ripgrep literal string.",
  apply_patch:
    "Begin/End Patch envelope to add, update, delete, or move files. Structured GPT-style diff; not search_replace or single-hunk edit/write for whole files.",
  batch:
    "Execute multiple independent tool calls in parallel (read many files, grep plus bash). Reduce latency; ordering not guaranteed between calls.",
  lsp:
    "Language Server: go to definition, find references, hover, workspace symbols. Navigate code; not ripgrep text search or plain read.",
  plan_exit:
    "Exit plan agent after the plan file is ready. Ask user to switch to build agent for implementation. Not general edit/write; only when planning phase is complete.",
}

const RULES: { re: RegExp; add: string[]; label: string }[] = [
  {
    re: /\b(edit|editá|edita|write|patch|refactor)\b/i,
    add: ["edit", "write", "grep", "read"],
    label: "edit/refactor",
  },
  {
    re: /\b(create|add|implement|new file|scaffold|crear|añadir|implementar|crea\s+un\s+archivo)\b/i,
    add: ["write", "edit", "grep", "read"],
    label: "create/implement",
  },
  {
    re: /cr[eé]ame\s+un\s+archivo|creame\s+un\s+archivo|archivo\s+que\s+se\s+llame|un\s+archivo\s+que\s+se\s+llame|create\s+a\s+file\s+(?:named|called)|create\s+a\s+file\s+in\s+the\s+repo\s+root|create\s+a\s+new\s+markdown\s+file|create\s+a\s+new\s+file\s+in\s+the\s+repo\s+root|(?:\.md|\.txt)\s+(?:en\s+el\s+root\s+del\s+repo|at\s+the\s+repo\s+root|in\s+the\s+repo\s+root)/i,
    add: ["write", "edit", "grep", "read"],
    label: "create/file-named",
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
    // Do not use bare \binternet\b or \ben internet\b — too many false positives. Require research/doc/search phrasing.
    re: /\b(http|curl|fetch|url|website|web\s+search|navegador|wikipedia|búsqueda\s+web|investigar\s+sobre|investigaci[oó]n\s+sobre|investigaci[oó]n\s+de|investigues\s+sobre|investigue\s+sobre|buscar\s+informaci[oó]n\s+sobre|buscar\s+informaci[oó]n\s+de|busca\s+informaci[oó]n\s+sobre|busca\s+informaci[oó]n\s+de|informaci[oó]n\s+sobre|producto\s+externo|software\s+externo|herramienta\s+externa|documentaci[oó]n\s+pública|documentaci[oó]n\s+oficial|mercado\s+externo|research\s+(on|about|into)|look\s+up\s+online|third[- ]party|external\s+(product|software|tool|vendor))\b/i,
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
    /** Tool map for this request (permissions + session toggles already applied upstream). */
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
    /** Per logical user turn: budget + ids for structured `router.fallback` logs. */
    fallback?: {
      expansionsUsedThisTurn: number
      maxPerTurn: number
      expandTo: "full"
      sessionID?: string
      messageID?: string
      turn?: number
    }
  }

  export type Result = {
    tools: Record<string, AITool>
    /** Appended to system prompt so the model sees intent + tool allowlist. */
    promptHint?: string
    /** Tells prompt.ts how much system context to include. */
    contextTier: ContextTier
    /** True when empty routing recovered by expanding to configured pool (same request). */
    usedFallbackExpansion?: boolean
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
    const clauses = splitClauses(text)

    const trLlm = input.cfg.experimental?.tool_router
    const useEmbed = true
    const embedModel =
      process.env.OPENCODE_TOOL_ROUTER_EMBED_MODEL?.trim() ||
      trLlm?.local_embed_model?.trim() ||
      DEFAULT_LOCAL_EMBED_MODEL
    const hybridIntent = trLlm?.local_intent_embed === true
    const minIntent = trLlm?.local_intent_min_score ?? 0.38
    const clauseIntentMin = Math.max(0.28, minIntent - 0.08)
    const marginBase = trLlm?.intent_merge_margin ?? 0.04
    const maxIntentN = trLlm?.intent_max_intents ?? 3
    const gapConv = trLlm?.intent_conversation_gap ?? 0.05

    let intentPrimary = ""
    let intentMerged: string[] = []
    let conversationExclusive = false
    let mergedFull: Awaited<ReturnType<typeof classifyIntentEmbedMerged>> | undefined
    let intentEmbedWeb = false

    if (hybridIntent) {
      mergedFull = await classifyIntentEmbedMerged({
        userText: text,
        model: embedModel,
        minScore: minIntent,
        prototypes: ROUTER_INTENT_PROTOTYPES,
        margin: marginBase,
        maxIntents: maxIntentN,
        conversationGap: gapConv,
      })
      if (mergedFull) {
        intentPrimary = mergedFull.primary
        intentMerged = [...mergedFull.merged]
        conversationExclusive = mergedFull.conversationExclusive
        intentEmbedWeb = isWebIntentEmbed(mergedFull.primary, mergedFull.labels)
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
    const autoPick = trLlm?.auto_tool_selection === true
    const max = autoPick ? (trLlm?.max_tools_cap ?? 100) : (tr?.max_tools ?? 12)

    const matched = new Set<string>()
    /** Ids from intent embed, Xenova augment, lexical seeds, fallback — not regex RULES alone (for full tool descriptions when keyword_rules is on). */
    const semanticIds = new Set<string>()
    const intentLabels: string[] = []

    const builtinAvailable = new Set([...available].filter((id) => !input.mcpIds.has(id)))

    const keywordRules = trLlm?.keyword_rules === true

    if (hybridIntent && !conversationExclusive) {
      const scan = !mergedFull ? (clauses.length ? clauses : [text]) : clauses.length > 1 ? clauses : []
      const cap = 4
      let n = 0
      const bag = new Set(intentMerged)
      let best: { primary: string; score: number } | undefined
      let clauseHit = false
      for (const clause of scan) {
        if (n >= cap) break
        const c = clause.trim()
        if (c.length < 8) continue
        n += 1
        const sub = await classifyIntentEmbedMerged({
          userText: c,
          model: embedModel,
          minScore: clauseIntentMin,
          prototypes: ROUTER_INTENT_PROTOTYPES,
          margin: marginBase + 0.03,
          maxIntents: Math.min(maxIntentN, 2),
          conversationGap: gapConv,
        })
        if (!sub || sub.conversationExclusive) continue
        if (sub.primary === CONVERSATION_INTENT_LABEL) continue
        clauseHit = true
        if (isWebIntentEmbed(sub.primary, sub.labels)) intentEmbedWeb = true
        if (!best || sub.score > best.score) best = { primary: sub.primary, score: sub.score }
        for (const id of sub.merged) bag.add(id)
      }
      if (clauseHit) {
        intentMerged = [...bag]
        if (!mergedFull && best) intentPrimary = best.primary
      }
    }

    if (hybridIntent && intentPrimary) {
      for (const id of intentMerged) {
        if (builtinAvailable.has(id)) {
          matched.add(id)
          semanticIds.add(id)
        }
      }
      intentLabels.push(`intent:${intentPrimary}`)
    }

    const ruleLabels: string[] = []
    if (keywordRules && !conversationExclusive) {
      for (const r of RULES) {
        if (!r.re.test(text)) continue
        ruleLabels.push(r.label)
        for (const id of r.add) matched.add(id)
      }
    }

    const labels = [...intentLabels, ...ruleLabels]

    let hybridAugmented = false
    if (!conversationExclusive) {
      for (const clause of clauses) {
        const aug = await augmentMatchedEmbed({
          userText: clause,
          matched,
          allowedBuiltin: builtinAvailable,
          model: embedModel,
          topK: trLlm?.local_embed_top_k ?? 4,
          minScore: trLlm?.local_embed_min_score ?? 0.32,
          intentLabel: intentPrimary || undefined,
          exactMatch: trLlm?.exact_match,
          auto: autoPick
            ? {
                enabled: true,
                ratio: trLlm?.auto_score_ratio ?? 0.88,
                tokenBudget: trLlm?.auto_token_budget ?? 1_200,
                maxCap: trLlm?.max_tools_cap ?? 100,
              }
            : undefined,
          rerank:
            trLlm?.rerank === true
              ? {
                  enabled: true,
                  candidates: trLlm?.rerank_candidates ?? 8,
                  semanticWeight: trLlm?.rerank_semantic_weight ?? 0.7,
                  lexicalWeight: trLlm?.rerank_lexical_weight ?? 0.3,
                }
              : undefined,
          phraseFor: (id) => embedPhraseFor(input, id),
        })
        if (aug?.added.length) {
          hybridAugmented = true
          for (const id of aug.added) {
            matched.add(id)
            semanticIds.add(id)
          }
          if (!labels.some((l) => l.startsWith("embed:")))
            labels.push(aug.note ? `embed:${aug.note.slice(0, 100)}` : "embed/extra")
        }
      }
    }

    let askMeLead = false
    let lexicalHint = false
    let strongWriteSeed = false
    if (!conversationExclusive) {
      const sig = lexicalSignals(text)
      if (sig.strongWrite && builtinAvailable.has("write")) {
        matched.add("write")
        semanticIds.add("write")
        strongWriteSeed = true
        if (!labels.some((l) => l === "lexical/strong_write")) labels.push("lexical/strong_write")
      }
      const lead = text.trim()
      if (/^ask\s+me\b/i.test(lead) || /^pregúntame\b/i.test(lead)) {
        askMeLead = true
        if (builtinAvailable.has("question")) {
          matched.add("question")
          semanticIds.add("question")
        }
        labels.push("hint/ask_me")
      }
      if (sig.questionIntent && builtinAvailable.has("question")) {
        if (!matched.has("question")) lexicalHint = true
        matched.add("question")
        semanticIds.add("question")
        if (!askMeLead) labels.push("hint/question_lexical")
      }
      if ((/^this$/i.test(lead) || /^this\s*\(/i.test(lead)) && builtinAvailable.has("grep")) {
        matched.add("grep")
        semanticIds.add("grep")
        if (builtinAvailable.has("read")) {
          matched.add("read")
          semanticIds.add("read")
        }
        if (builtinAvailable.has("question")) {
          matched.add("question")
          semanticIds.add("question")
        }
        lexicalHint = true
        labels.push("hint/edge_this")
      }
      if (
        /¿qué\s+hace/i.test(text) &&
        /\b(?:en este repo|in this repo)\b/i.test(text) &&
        builtinAvailable.has("grep")
      ) {
        matched.add("grep")
        semanticIds.add("grep")
        lexicalHint = true
        labels.push("hint/repo_que_hace")
      }
      if (/\bcreate\s+a\s+new\s+test\s+file\b/i.test(text) && builtinAvailable.has("write")) {
        matched.add("write")
        semanticIds.add("write")
        lexicalHint = true
        labels.push("hint/new_test_file")
      }
    }

    if (autoPick) {
      log.info("router_embed_auto_policy", {
        ratio: trLlm?.auto_score_ratio ?? 0.88,
        token_budget: trLlm?.auto_token_budget ?? 1_200,
        max_cap: trLlm?.max_tools_cap ?? 100,
      })
    }

    let hadRouterSignal =
      intentLabels.length > 0 ||
      ruleLabels.length > 0 ||
      hybridAugmented ||
      askMeLead ||
      lexicalHint ||
      strongWriteSeed

    if (!hadRouterSignal && !routerOnly && tr?.no_match_fallback === true) {
      const fb = tr?.no_match_fallback_tools ?? ["glob", "grep", "read", "task"]
      for (const id of fb) {
        if (builtinAvailable.has(id)) {
          matched.add(id)
          semanticIds.add(id)
        }
      }
      hadRouterSignal = true
      labels.push("fallback/no_match")
    }

    let stickyMerged = false
    const sticky = input.stickyToolIds ?? []
    if (sticky.length && tr?.sticky_previous_turn_tools !== false && !conversationExclusive) {
      const hadBeforeSticky =
        intentLabels.length > 0 || ruleLabels.length > 0 || hybridAugmented || askMeLead || lexicalHint
      const allowSticky = !(routerOnly && !hadBeforeSticky)
      if (allowSticky) {
        for (const id of sticky) {
          if (builtinAvailable.has(id)) {
            matched.add(id)
            semanticIds.add(id)
            stickyMerged = true
          }
        }
      }
    }

    hadRouterSignal = hadRouterSignal || stickyMerged

    const policyIds = applyRouterPolicy({
      ids: matched,
      text,
      fullText: text,
      clauses: clauses.length > 1 ? clauses : undefined,
      available: builtinAvailable,
      max,
      intentEmbedWeb: intentEmbedWeb || undefined,
    })
    const ordered = policyIds.filter((id) => builtinAvailable.has(id))

    // Full descriptions: regex hits ∪ semantic path (intent/embed/lexical/sticky/fallback). With keyword_rules off, all `matched` counts.
    const ruleMatched = new Set<string>()
    if (keywordRules) {
      for (const r of RULES) {
        if (r.re.test(text)) {
          for (const id of r.add) ruleMatched.add(id)
        }
      }
      for (const id of semanticIds) ruleMatched.add(id)
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

    const fromIdsSorted = Object.keys(out).sort()
    const isConversationTier = intentPrimary === CONVERSATION_INTENT_LABEL || conversationExclusive

    if (Object.keys(out).length === 0 && !isConversationTier) {
      const fbCfg = tr?.fallback
      const fbOn = fbCfg?.enabled !== false
      const maxPer = input.fallback?.maxPerTurn ?? fbCfg?.max_expansions_per_turn ?? 1
      const used = input.fallback?.expansionsUsedThisTurn ?? 0
      const expandTo = input.fallback?.expandTo ?? fbCfg?.expand_to ?? "full"
      const recoverWithoutSignal = fbCfg?.recover_empty_without_signal === true
      const canExpand =
        fbOn && used < maxPer && available.size > 0 && (hadRouterSignal || recoverWithoutSignal)

      if (canExpand) {
        const idsToExpand = [...available].sort((a, b) => a.localeCompare(b))

        if (idsToExpand.length === 0) {
          log.info("router.fallback", {
            trigger: "empty_selection",
            event: "skipped",
            reason: "expand_target_empty",
            expand_to: expandTo,
            from_ids: fromIdsSorted,
            session_id: input.fallback?.sessionID,
            message_id: input.fallback?.messageID,
            turn: input.fallback?.turn,
          })
        }

        const expanded: Record<string, AITool> = {}
        for (const id of idsToExpand) {
          const t = additive ? (input.tools[id] ?? input.registryTools?.[id]) : input.tools[id]
          if (!t) continue
          expanded[id] = t
        }

        if (Object.keys(expanded).length > 0) {
          const toIds = Object.keys(expanded).sort()
          const budgetAfter = used + 1
          log.info("router.fallback", {
            trigger: "empty_selection",
            from_ids: fromIdsSorted,
            to_ids: toIds,
            session_id: input.fallback?.sessionID,
            message_id: input.fallback?.messageID,
            turn: input.fallback?.turn,
            expand_to: expandTo,
            budget_before: used,
            budget_after: budgetAfter,
            max_per_turn: maxPer,
            outcome: "expanded",
          })
          const injectFb = tr?.inject_prompt !== false
          const hintFb = injectFb
            ? promptHint({
                ids: toIds,
                labels,
                additive,
                matched: new Set(toIds),
                allowed,
                availableKeys,
              })
            : undefined
          const toolTokensFb = (() => {
            let total = 0
            for (const id of toIds) {
              const t = expanded[id]
              if (t?.description) total += estimateTokens(t.description)
            }
            return total
          })()
          const promptHintTokensFb = hintFb ? estimateTokens(hintFb) : 0
          log.info("tool_router", {
            tier: "full",
            selected: toIds,
            builtin: toIds.filter((id) => !input.mcpIds.has(id)),
            mcp: toIds.filter((id) => input.mcpIds.has(id)),
            reason: "fallback_empty_expand",
            labels,
            userPreview: text.slice(0, 120),
            hasAssistant,
            tokens: {
              toolCount: toIds.length,
              toolTokens: toolTokensFb,
              promptHintTokens: promptHintTokensFb,
              total: toolTokensFb + promptHintTokensFb,
            },
            duration_ms: ms(),
          })
          return {
            tools: expanded,
            promptHint: hintFb,
            contextTier: "full",
            usedFallbackExpansion: true,
          }
        }
      }

      if (!isConversationTier && Object.keys(out).length === 0 && available.size > 0 && fbOn && used >= maxPer) {
        log.info("router.fallback", {
          trigger: "empty_selection",
          event: "skipped",
          reason: "budget_exhausted",
          from_ids: fromIdsSorted,
          session_id: input.fallback?.sessionID,
          message_id: input.fallback?.messageID,
          turn: input.fallback?.turn,
          budget_before: used,
          max_per_turn: maxPer,
        })
      }
    }

    if (Object.keys(out).length === 0) {
      const hint = tr?.inject_prompt !== false ? promptHint({ ids: [], labels, additive, matched, allowed, availableKeys }) : undefined
      log.info("tool_router", {
        tier: intentPrimary === CONVERSATION_INTENT_LABEL ? "conversation" : "minimal",
        selected: [],
        reason: intentPrimary === CONVERSATION_INTENT_LABEL ? "xenova_conversation_no_tool_match" : "xenova_no_match",
        labels,
        userPreview: text.slice(0, 120),
        hasAssistant,
        tokens: { toolCount: 0, toolTokens: 0, promptHintTokens: hint ? estimateTokens(hint) : 0 },
        duration_ms: ms(),
      })
      return {
        tools: {},
        promptHint: hint,
        contextTier: intentPrimary === CONVERSATION_INTENT_LABEL ? "conversation" : "minimal",
      }
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
      tier: "full",
      selected: ids.sort(),
      builtin: ordered.slice().sort(),
      mcp: [...input.mcpIds].filter((id) => out[id]).sort(),
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

    return { tools: out, promptHint: hint, contextTier: "full" }
  }
}
