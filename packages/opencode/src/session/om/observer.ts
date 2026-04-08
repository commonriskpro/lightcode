import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { MessageV2 } from "../message-v2"
import { Log } from "@/util/log"
import { Token } from "@/util/token"
import { generateText } from "ai"
import type { SessionID } from "../schema"
import { wrapInObservationGroup, stripObservationGroups } from "./groups"

const log = Log.create({ service: "session.observer" })

// Detect degenerate LLM output — Gemini Flash repeat-penalty bug where the model
// enters a loop producing near-identical chunks. Samples 10 positions across the text
// and checks if consecutive pairs share > 90% character overlap. Returns false for
// any text under 2000 chars (too short to be a meaningful repetition signal).
export function detectDegenerateRepetition(text: string): boolean {
  if (text.length < 2000) return false
  const chunkSize = 200
  const positions = Array.from({ length: 10 }, (_, i) => Math.floor((i / 9) * (text.length - chunkSize)))
  const chunks = positions.map((p) => text.slice(p, p + chunkSize))
  let similar = 0
  for (let i = 0; i < chunks.length - 1; i++) {
    const a = new Set(chunks[i]!.split(""))
    const b = new Set(chunks[i + 1]!.split(""))
    const intersection = [...a].filter((c) => b.has(c)).length
    const union = new Set([...a, ...b]).size
    if (union > 0 && intersection / union > 0.9) similar++
  }
  return similar >= 8
}

// Guard against single-line degeneration (e.g. an LLM that writes one enormous line).
// Mastra uses 10_000 chars as the cap — we match that.
const MAX_OBS_LINE = 10_000

export function sanitizeObservationLines(obs: string): string {
  if (!obs) return obs
  const lines = obs.split("\n")
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.length > MAX_OBS_LINE) {
      lines[i] = lines[i]!.slice(0, MAX_OBS_LINE) + " … [truncated]"
      changed = true
    }
  }
  return changed ? lines.join("\n") : obs
}

// Parse structured XML output from the Observer LLM.
// Extracts <observations>, <current-task>, <suggested-response> sections.
// Falls back to treating the full text as observations when tags are absent.
export function parseObserverOutput(raw: string): ObserverResult {
  const obsMatch = raw.match(/<observations>([\s\S]*?)<\/observations>/i)
  const observations = sanitizeObservationLines(obsMatch ? obsMatch[1]!.trim() : raw.trim())
  const taskMatch = raw.match(/<current-task>([\s\S]*?)<\/current-task>/i)
  const currentTask = taskMatch ? taskMatch[1]!.trim() : undefined
  const contMatch = raw.match(/<suggested-response>([\s\S]*?)<\/suggested-response>/i)
  const suggestedContinuation = contMatch ? contMatch[1]!.trim() : undefined
  const titleMatch = raw.match(/<thread-title>([\s\S]*?)<\/thread-title>/i)
  const threadTitle = titleMatch ? titleMatch[1]!.trim() : undefined
  return { observations, currentTask, suggestedContinuation, threadTitle }
}

export interface ObserverResult {
  observations: string
  currentTask?: string
  suggestedContinuation?: string
  threadTitle?: string
}

const CONDENSE_PROMPT = `You are a memory consolidation agent. You receive multiple observation chunks and must produce a single, coherent observation log.

Rules:
- Preserve ALL important facts — nothing should be lost
- Merge duplicate or related facts into single bullets
- Keep 🔴 (user assertions) and 🟡 (user requests) markers
- Prefer recent observations over older ones when they contradict
- Condense older facts more aggressively, retain more detail for recent ones
- Preserve timestamps when present
- Output format must match the input format exactly

Output the consolidated log directly, no preamble.`

export const PROMPT = `You are an observation agent. Extract facts from the conversation below as a structured observation log.

## Assertion vs Question

- 🔴 User assertions (FACTS the user stated): "I work at Acme", "the app uses PostgreSQL", "I switched to Svelte"
  - These are AUTHORITATIVE — the user is the source of truth about their own context
- 🟡 User requests/questions (what they asked for, NOT facts): "Can you help me...", "What's the best way to..."
  - Only record these if they reveal intent or preference

## STATE CHANGES

When a user indicates a change from X to Y, frame it explicitly:
- "User will use Svelte (replacing React)"
- "User now works at NewCo (previously OldCo)"
- Mark the old value superseded: "~old fact~ → new fact"

## Temporal Anchoring

- Resolve relative dates to absolute (e.g. "yesterday" → 2026-04-03, "next week" → 2026-04-11)
- IMPORTANT: If an observation contains MULTIPLE events at different times, split them into SEPARATE observation lines, each with its own date
  - Example: "I visited Paris last week and I'm going to London tomorrow" → two separate lines with two dates
  - BAD: User will visit parents this weekend and go to the dentist tomorrow.
  - GOOD:
    User will visit parents this weekend. (meaning June 17-18, 20XX)
    User will go to dentist tomorrow. (meaning June 16, 20XX)
- Include timestamps (HH:MM) when messages carry them

## PRECISE ACTION VERBS

Replace vague verbs with specific ones:
- "getting" something regularly → "subscribes to" / "receives regularly"
- "got" something → "purchased" / "received" / "was given" (choose based on context)
- "has" → "owns" / "maintains" / "is responsible for" (choose based on context)
- "uses" → "develops with" / "relies on" / "chose" (prefer the most specific)
- "doing" → "building" / "debugging" / "migrating" / "deploying" (match the actual activity)

## PRESERVE DISTINGUISHING DETAILS

- Lists, names, @handles, URLs, numerical values, quantities, and identifiers MUST be preserved verbatim — never generalize
  - BAD: "User tried several hotels" → GOOD: "User compared Hotel Marais (€180/night, 4-star) and Hotel Latin (€150/night, 3-star)"
  - BAD: "User uses some libraries" → GOOD: "User uses Effect, Drizzle, and Vercel AI SDK"
- Preserve unusual phrasing or specific terminology the user employs — it may carry domain meaning

## AVOIDING REPETITIVE OBSERVATIONS

Do NOT repeat the same observation across multiple turns if there is no new information.
When the agent performs repeated similar actions (file reads, tool calls, searches), group them into a single parent observation with sub-bullets for each new result.

Example — BAD (repetitive):
* 🟡 HH:MM Agent read src/auth.ts
* 🟡 HH:MM Agent read src/users.ts
* 🟡 HH:MM Agent read src/routes.ts

Example — GOOD (grouped with sub-bullets):
* 🟡 HH:MM Agent explored auth flow source files
  * -> read src/auth.ts — found token validation logic
  * -> read src/users.ts — found user lookup by email
  * -> read src/routes.ts — found middleware chain

Only add a new observation for a repeated action if the NEW result changes the picture.

## ASSISTANT-GENERATED CONTENT

When the assistant provides lists, recommendations, or detailed responses the user explicitly requested, preserve the DISTINGUISHING DETAILS that make each item unique and queryable later:

- Recommendation lists → preserve key attribute per item: "Hotel A (near station, €180/night), Hotel B (budget-friendly, €90/night)"
- Names, @handles, identifiers → always preserve specific values: "@photographer_one (portraits), @photographer_two (landscapes)"
- Technical/numerical results → preserve specific values: "optimization achieved 43.7% faster load times, memory reduced from 2.8GB to 940MB"
- Quantities and counts → always include how many: "Item A (4 units, size large), Item B (2 units, size small)"
- Role/participation → capture specific role: "User was a presenter at the event" not "User attended the event"

## ACTIONABLE INSIGHTS

Capture what needs follow-up or is still pending:
- User's stated goals or next steps
- If the user says NOT to do something, mark it explicitly
- Tasks waiting on the user → mark as "waiting for user"
- What worked well in explanations (so the assistant can repeat it)
- What needs clarification

## COMPLETION TRACKING

When the assistant has clearly completed a task requested by the user in this conversation, prefix the observation with ✅ (before any role marker):
- ✅ 🔴 HH:MM Built JWT authentication middleware (express, jsonwebtoken)
- ✅ HH:MM Fixed TypeScript error in UserService (incorrect return type)

Only emit ✅ when completion is unambiguous — the assistant produced the result, wrote the code, or explicitly confirmed the task is done. NEVER emit ✅ speculatively for work still in progress.

## CONVERSATION CONTEXT

Capture as 🔴 user assertions when they appear:
- Code snippets or file contents the user provides as current system state → note language, key identifiers, constraints
- Multi-step sequences (migration steps, install sequences) → record each step as a separate bullet
- Explicit constraints ("must use PostgreSQL", "never do Y") → preserve verbatim, never paraphrase

## USER MESSAGE FIDELITY

Distinguish between messages to capture near-verbatim vs. summarize:
- **Near-verbatim** (MUST preserve exact values): names, numbers, identifiers, URLs, file paths, API keys, constraints — if a value could matter later, keep it exact
- **Summarize or omit**: conversational filler, repeated acknowledgements ("yeah, thanks", "makes sense"), messages that restate prior context without adding new facts

## General Rules

- Skip: routine tool calls, file reads, assistant acknowledgements, filler
- Keep bullets concise — one fact per bullet
- When in doubt about whether something is a fact, KEEP IT

## Output Format

<observations>
Date: [resolved date]
* 🔴 HH:MM [user assertion — specific, with preserved details]
* 🟡 HH:MM [user request — only if it reveals intent]
</observations>

<current-task>
State what the agent is currently working on (1-2 sentences).
</current-task>

<suggested-response>
Hint for the agent's next message to continue naturally (1 sentence).
</suggested-response>

<thread-title>
2-5 words capturing the session's current focus (e.g. "Fix JWT Auth Bug", "Migrate to Drizzle")
</thread-title>`

export function truncateObsToBudget(obs: string, budget: number): string {
  if (budget === 0) return ""
  const total = Token.estimate(obs)
  if (total <= budget) return obs

  const lines = obs.split("\n")
  const n = lines.length

  const tok = lines.map((l) => Token.estimate(l))

  const suffix = new Array<number>(n + 1)
  suffix[n] = 0
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + tok[i]!

  // Pre-scan important lines from head (before trying to fit tail)
  // so we can reserve their budget before picking the tail size
  const important: number[] = []
  let importantCost = 0
  for (let i = 0; i < n; i++) {
    if (lines[i]!.includes("🔴") || lines[i]!.includes("✅")) {
      important.push(i)
      importantCost += tok[i]!
    }
  }

  // Find largest tail that fits in budget minus reserved important cost
  // (cap reserved cost at budget to avoid negative tail budget)
  const reserved = Math.min(importantCost, budget)
  const tailBudget = budget - reserved

  let tail = n
  for (let i = n - 1; i >= 0; i--) {
    if (suffix[i]! <= tailBudget) tail = i
    else break
  }

  // Recalculate remaining after tail is committed
  const tailCost = suffix[tail]!
  let remaining = budget - tailCost

  // Greedily add important lines from head (before tail) within remaining budget
  const kept: string[] = []
  for (const i of important) {
    if (i >= tail) break // tail already covers this line
    if (remaining <= 0) break
    if (tok[i]! <= remaining) {
      kept.push(lines[i]!)
      remaining -= tok[i]!
    }
  }

  const skipped = tail - kept.length
  const parts: string[] = []
  if (kept.length) parts.push(kept.join("\n"))
  if (skipped > 0) parts.push(`[${skipped} observations truncated here]`)
  parts.push(lines.slice(tail).join("\n"))

  return parts.join("\n")
}

export function sanitizeToolResult(val: unknown, seen = new WeakSet()): unknown {
  if (typeof val !== "object" || val === null) return val
  if (seen.has(val as object)) return "[circular]"
  seen.add(val as object)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    // Check circular before serializing to avoid JSON.stringify throwing on cycles
    if (typeof v === "object" && v !== null && seen.has(v as object)) {
      out[k] = "[circular]"
      continue
    }
    if (/encrypted|secret|token/i.test(k)) {
      const serialized = typeof v === "string" ? v : (JSON.stringify(v) ?? "")
      if (serialized.length > 256) {
        out[k] = `[stripped: ${serialized.length} chars]`
        continue
      }
    }
    out[k] = sanitizeToolResult(v, seen)
  }
  return out
}

export namespace Observer {
  // Condense multiple observation chunks into one coherent log via LLM.
  // Falls back to naive join if model not configured or LLM fails.
  export async function condense(chunks: string[], prev?: string): Promise<string> {
    const joined = chunks.join("\n\n---\n\n")
    if (chunks.length <= 1) return joined

    const cfg = await Config.get()
    if (cfg.experimental?.observer === false) return joined
    const modelStr = cfg.experimental?.observer_model ?? "opencode/qwen3.6-plus-free"

    const parsed = Provider.parseModel(modelStr)
    const model = await Provider.getModel(parsed.providerID, parsed.modelID).catch(() => undefined)
    if (!model) return joined

    const language = await Provider.getLanguage(model).catch(() => undefined)
    if (!language) return joined

    const prompt = prev
      ? `## Previous observations (already consolidated)\n${prev}\n\n## New chunks to merge\n${joined}`
      : `## Chunks to consolidate\n${joined}`

    const result = await generateText({
      model: language,
      system: CONDENSE_PROMPT,
      prompt,
    }).catch((err) => {
      log.error("condense llm failed", { err })
      return undefined
    })

    return result?.text || joined
  }

  export async function run(input: {
    sid: SessionID
    msgs?: MessageV2.WithParts[]
    prev?: string
    prevBudget?: number | false
    priorCurrentTask?: string
  }): Promise<ObserverResult | undefined> {
    const cfg = await Config.get()
    // Respect explicit opt-out — observer: false disables even the default model
    if (cfg.experimental?.observer === false) return undefined
    // Default to qwen3.6-plus-free — free on OpenCode Zen, fast, ideal for background observation.
    const modelStr = cfg.experimental?.observer_model ?? "opencode/qwen3.6-plus-free"

    const parsed = Provider.parseModel(modelStr)

    const model = await Provider.getModel(parsed.providerID, parsed.modelID).catch((err) => {
      log.error("failed to resolve observer model", { err })
      return undefined
    })
    if (!model) return undefined

    const language = await Provider.getLanguage(model).catch((err) => {
      log.error("failed to get language model", { err })
      return undefined
    })
    if (!language) return undefined

    const cap = (cfg.experimental?.observer_max_tool_result_tokens ?? 2_000) * 4
    const context = (input.msgs ?? [])
      .filter((m) => m.info.role === "user" || m.info.role === "assistant")
      .map((m) => {
        const role = m.info.role === "user" ? "User" : "Assistant"
        const parts = m.parts.flatMap((p): string[] => {
          if (p.type === "text") return p.text ? [p.text] : []
          if (p.type === "tool" && p.state.status === "completed") {
            const sanitized =
              typeof p.state.output === "string" ? p.state.output : JSON.stringify(sanitizeToolResult(p.state.output))
            const raw = sanitized
            const out = raw.length > cap ? raw.slice(0, cap) + "\n... [truncated]" : raw
            return [`[Tool: ${p.tool}]\n${out}`]
          }
          return []
        })
        const text = parts.join("\n")
        if (!text.trim()) return null
        return `[${role}]: ${text}`
      })
      .filter(Boolean)
      .join("\n\n")

    if (!context.trim()) return undefined

    let system = PROMPT
    if (input.prev) {
      const budget = input.prevBudget ?? cfg.experimental?.observer_prev_tokens
      const stripped = stripObservationGroups(input.prev)
      const prev = budget === false ? stripped : truncateObsToBudget(stripped, budget ?? 2000)
      if (prev) system += `\n\n## Previous Observations (for context, do not duplicate)\n${prev}`
    }
    if (input.priorCurrentTask) system += `\n\n## Prior Context — Current Task\n${input.priorCurrentTask}`

    const result = await generateText({
      model: language,
      system,
      prompt: context,
    }).catch((err) => {
      log.error("observer llm failed", { err })
      return undefined
    })

    if (!result?.text) return undefined

    if (detectDegenerateRepetition(result.text)) {
      log.warn("observer: degenerate output discarded")
      return undefined
    }

    const out = parseObserverOutput(result.text)
    const first = input.msgs?.[0]?.info.id
    const last = input.msgs?.at(-1)?.info.id
    if (first && last && out.observations) {
      out.observations = wrapInObservationGroup(out.observations, `${first}:${last}`)
    }
    return out
  }
}
