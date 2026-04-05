import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { MessageV2 } from "../message-v2"
import { Log } from "@/util/log"
import { generateText } from "ai"
import type { SessionID } from "../schema"

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

// Parse structured XML output from the Observer LLM.
// Extracts <observations>, <current-task>, <suggested-response> sections.
// Falls back to treating the full text as observations when tags are absent.
export function parseObserverOutput(raw: string): ObserverResult {
  const obsMatch = raw.match(/<observations>([\s\S]*?)<\/observations>/i)
  const observations = obsMatch ? obsMatch[1]!.trim() : raw.trim()
  const taskMatch = raw.match(/<current-task>([\s\S]*?)<\/current-task>/i)
  const currentTask = taskMatch ? taskMatch[1]!.trim() : undefined
  const contMatch = raw.match(/<suggested-response>([\s\S]*?)<\/suggested-response>/i)
  const suggestedContinuation = contMatch ? contMatch[1]!.trim() : undefined
  return { observations, currentTask, suggestedContinuation }
}

export interface ObserverResult {
  observations: string
  currentTask?: string
  suggestedContinuation?: string
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

const PROMPT = `You are an observation agent. Extract facts from the conversation below as a structured observation log.

Rules:
- 🔴 User assertions (facts the user stated): "I work at Acme", "the app uses PostgreSQL"
- 🟡 User requests/questions (what they asked for, NOT facts): "Can you help me..."
- Include timestamps when messages have them
- Resolve relative dates to absolute (e.g. "next week" → actual date)
- Mark superseded info explicitly: "~old fact~ → new fact"
- Skip: routine tool calls, file reads, assistant acknowledgements
- Keep bullets concise — one fact per bullet
- USER ASSERTIONS ARE AUTHORITATIVE — the user is the source of truth about their own context
- When state changes, mark old info superseded: "~old fact~ → new fact"

Output your response using these XML sections:

<observations>
Date: [date]
* 🔴 HH:MM [user assertion]
* 🟡 HH:MM [user request]
</observations>

<current-task>
State what the agent is currently working on (1-2 sentences).
</current-task>

<suggested-response>
Hint for the agent's next message to continue naturally (1 sentence).
</suggested-response>`

export namespace Observer {
  // Condense multiple observation chunks into one coherent log via LLM.
  // Falls back to naive join if model not configured or LLM fails.
  export async function condense(chunks: string[], prev?: string): Promise<string> {
    const joined = chunks.join("\n\n---\n\n")
    if (chunks.length <= 1) return joined

    const cfg = await Config.get()
    if (cfg.experimental?.observer === false) return joined
    const modelStr = cfg.experimental?.observer_model ?? "google/gemini-2.5-flash"

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
    msgs: MessageV2.WithParts[]
    prev?: string
    priorCurrentTask?: string
  }): Promise<ObserverResult | undefined> {
    const cfg = await Config.get()
    // Respect explicit opt-out — observer: false disables even the default model
    if (cfg.experimental?.observer === false) return undefined
    // Default to gemini-2.5-flash — cheap, fast, 1M context. Ideal for background observation.
    const modelStr = cfg.experimental?.observer_model ?? "google/gemini-2.5-flash"

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

    const context = input.msgs
      .filter((m) => m.info.role === "user" || m.info.role === "assistant")
      .map((m) => {
        const role = m.info.role === "user" ? "User" : "Assistant"
        const text = m.parts
          .filter((p): p is MessageV2.TextPart => p.type === "text")
          .map((p) => p.text)
          .join("\n")
        if (!text.trim()) return null
        return `[${role}]: ${text}`
      })
      .filter(Boolean)
      .join("\n\n")

    if (!context.trim()) return undefined

    let system = PROMPT
    if (input.prev) system += `\n\n## Previous Observations (for context, do not duplicate)\n${input.prev}`
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

    return parseObserverOutput(result.text)
  }
}
