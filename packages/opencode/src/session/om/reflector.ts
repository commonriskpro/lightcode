import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { Log } from "@/util/log"
import { generateText } from "ai"
import type { SessionID } from "../schema"
import { OM } from "./record"

const log = Log.create({ service: "session.reflector" })
const THRESHOLD = 40_000

const PROMPT = `You are a memory consolidation agent. Condense the observation log below into a tighter version.

Rules:
- PRESERVE all 🔴 user assertions (hard facts) — these are never expendable
- CONDENSE 🟡 user requests that are clearly resolved or superseded
- Condense OLDER observations more aggressively than recent ones
- Merge related bullets into single summary bullets where possible
- Preserve timestamps for important events
- User assertions TAKE PRECEDENCE over questions about the same topic
- Output in the same format as input (bullet list with 🔴/🟡 markers)
- DO NOT lose any fact. When in doubt, keep it.`

export namespace Reflector {
  export const threshold = THRESHOLD

  export async function run(sid: SessionID): Promise<void> {
    const rec = OM.get(sid)
    if (!rec?.observations) return
    if ((rec.observation_tokens ?? 0) <= THRESHOLD) return

    const cfg = await Config.get()
    if (cfg.experimental?.observer === false) return
    const modelStr = cfg.experimental?.observer_model ?? "google/gemini-2.5-flash"

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

    const result = await generateText({
      model: language,
      system: PROMPT,
      prompt: rec.observations,
    }).catch((err) => {
      log.error("reflector llm failed", { err })
      return undefined
    })

    if (!result?.text) return
    OM.reflect(sid, result.text)
  }
}
