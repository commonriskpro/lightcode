import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { Log } from "@/util/log"
import { Token } from "@/util/token"
import { generateText } from "ai"
import type { SessionID } from "../schema"
import { OM } from "./record"
import { detectDegenerateRepetition } from "./observer"
import { renderObservationGroupsForReflection, reconcileObservationGroupsFromReflection } from "./groups"

const log = Log.create({ service: "session.reflector" })

export type CompressionLevel = 0 | 1 | 2 | 3 | 4

export function startLevel(id: string): CompressionLevel {
  if (id.includes("gemini-2.5-flash")) return 2
  if (id.includes("qwen3.6-plus-free")) return 2
  return 1
}

// Validate that reflection actually compressed the observations.
function validateCompression(text: string, target: number): boolean {
  return Token.estimate(text) < target
}

// Escalating compression guidance. Level 0 = no guidance (first attempt).
// Each level is more aggressive — ported from Mastra's reflector-agent.ts.
const COMPRESSION_GUIDANCE: Record<CompressionLevel, string> = {
  0: "",
  1: `
## COMPRESSION REQUIRED

Your previous reflection was the same size or larger than the original observations.

Please re-process with slightly more compression:
- Towards the beginning, condense more observations into higher-level reflections
- Closer to the end, retain more fine details (recent context matters more)
- Memory is getting long — use a more condensed style throughout
- Combine related items more aggressively but do not lose important specific details
- Combine repeated similar tool calls into a single summary line describing the outcome
- Preserve ✅ completion markers and their concrete resolved outcomes

Aim for a 8/10 detail level.
`,
  2: `
## AGGRESSIVE COMPRESSION REQUIRED

Your previous reflection was still too large after compression guidance.

Please re-process with much more aggressive compression:
- Towards the beginning, heavily condense observations into high-level summaries
- Closer to the end, retain fine details (recent context matters more)
- Combine related items aggressively but do not lose important specific details
- If the same file or module is mentioned across many observations, merge into one entry covering the full arc
- Preserve ✅ completion markers and their concrete resolved outcomes
- Remove redundant information and merge overlapping observations

Aim for a 6/10 detail level.
`,
  3: `
## CRITICAL COMPRESSION REQUIRED

Your previous reflections have failed to compress sufficiently after multiple attempts.

Please re-process with maximum compression:
- Summarize the oldest observations (first 50-70%) into brief high-level paragraphs — only key facts, decisions, and outcomes
- For the most recent observations (last 30-50%), retain important details but use a condensed style
- Ruthlessly merge related observations — if 10 observations are about the same topic, combine into 1-2 lines
- Drop procedural details (tool calls, retries, intermediate steps) — keep only final outcomes
- Preserve ✅ completion markers and concrete resolved outcomes
- Preserve: names, dates, decisions, errors, user preferences, and architectural choices

Aim for a 4/10 detail level.
`,
  4: `
## EXTREME COMPRESSION REQUIRED

Multiple compression attempts have failed. You MUST dramatically reduce the number of observations:
- Collapse ALL tool call sequences into outcome-only observations
- Never preserve individual tool calls — only what was discovered or accomplished
- Consolidate many related observations into single, more generic observations
- For older content, each topic should be at most 1-2 observations capturing the key outcome
- Preserve ✅ completion markers and their outcomes but merge related completions into fewer lines
- Preserve: user preferences, key decisions, architectural choices, and unresolved issues

Aim for a 2/10 detail level. Fewer, more generic observations are better than many specific ones.
`,
}

export const REFLECTOR_PROMPT = `You are a memory consolidation agent. Condense the observation log below into a tighter version.

Rules:
- PRESERVE all 🔴 user assertions (hard facts) — these are never expendable. The user is the authority on their own context, preferences, and life — their assertions override inferences.
- CONDENSE 🟡 user requests that are clearly resolved or superseded
- Condense OLDER observations more aggressively than recent ones
- Merge related bullets into single summary bullets where possible
- Preserve timestamps for important events
- User assertions TAKE PRECEDENCE over questions about the same topic
- Output in the same format as input (bullet list with 🔴/🟡 markers)
- DO NOT lose any fact. When in doubt, keep it.
- Preserve ✅ completion markers — they signal resolved tasks and prevent repeated work
- The input may contain observation groups (sections of related observations). Treat each observation group as a unit — condense within groups before merging across groups. Preserve group boundaries when possible.`

const PROMPT = REFLECTOR_PROMPT

export namespace Reflector {
  export const threshold = 40_000

  export async function run(sid: SessionID): Promise<void> {
    const rec = await OM.get(sid)
    if (!rec?.observations) return

    const cfg = await Config.get()
    const t = cfg.experimental?.observer_reflection_tokens ?? 40_000
    if ((rec.observation_tokens ?? 0) <= t) return

    if (cfg.experimental?.observer === false) return
    const modelStr = cfg.experimental?.observer_model ?? "opencode/qwen3.6-plus-free"

    const parsed = Provider.parseModel(modelStr)
    const model = await Provider.getModel(parsed.providerID, parsed.modelID).catch((err) => {
      log.error("failed to resolve reflector model", { err })
      return undefined
    })
    if (!model) return

    const language = await Provider.getLanguage(model).catch((err) => {
      log.error("failed to get language model for reflector", { err })
      return undefined
    })
    if (!language) return

    let best: { text: string; tok: number } | undefined
    let level = startLevel(model?.api?.id ?? "") as CompressionLevel

    const rendered = renderObservationGroupsForReflection(rec.observations)

    while (level <= 4) {
      const system = PROMPT + COMPRESSION_GUIDANCE[level]
      const result = await generateText({
        model: language,
        system,
        prompt: rendered,
      }).catch((err) => {
        log.error("reflector llm failed", { err, level })
        return undefined
      })

      if (!result?.text) {
        level = (level + 1) as CompressionLevel
        continue
      }

      if (detectDegenerateRepetition(result.text)) {
        log.warn("reflector: degenerate output discarded", { level })
        level = (level + 1) as CompressionLevel
        continue
      }

      const tok = Token.estimate(result.text)
      if (!best || tok < best.tok) best = { text: result.text, tok }

      if (validateCompression(result.text, t)) {
        const reconciled = reconcileObservationGroupsFromReflection(result.text, rec.observations)
        await OM.reflect(sid, reconciled)
        if (level > 0) log.info("reflector: compressed at level", { level })
        return
      }

      level = (level + 1) as CompressionLevel
    }

    // Exhausted all levels — persist the best result we got
    if (best) {
      log.warn("reflector: exhausted compression levels, persisting best result", { tok: best.tok })
      await OM.reflect(sid, reconcileObservationGroupsFromReflection(best.text, rec.observations))
    }
  }
}
