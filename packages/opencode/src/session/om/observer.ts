import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { MessageV2 } from "../message-v2"
import { Log } from "@/util/log"
import { generateText } from "ai"
import type { SessionID } from "../schema"

const log = Log.create({ service: "session.observer" })

const PROMPT = `You are an observation agent. Extract facts from the conversation below as a structured observation log.

Rules:
- 🔴 User assertions (facts the user stated): "I work at Acme", "the app uses PostgreSQL"
- 🟡 User requests/questions (what they asked for, NOT facts): "Can you help me..."
- Include timestamps when messages have them
- Resolve relative dates to absolute (e.g. "next week" → actual date)
- Mark superseded info explicitly: "~old fact~ → new fact"
- Skip: routine tool calls, file reads, assistant acknowledgements
- Keep bullets concise — one fact per bullet

Output format:
## Observations

- 🔴 HH:MM [fact]
- 🟡 HH:MM [request]`

export namespace Observer {
  export async function run(input: {
    sid: SessionID
    msgs: MessageV2.WithParts[]
    prev?: string
  }): Promise<string | undefined> {
    const cfg = await Config.get()
    const modelStr = cfg.experimental?.observer_model
    if (!modelStr) return undefined

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

    const system = input.prev
      ? `${PROMPT}\n\n## Previous Observations (for context, do not duplicate)\n${input.prev}`
      : PROMPT

    const result = await generateText({
      model: language,
      system,
      prompt: context,
    }).catch((err) => {
      log.error("observer llm failed", { err })
      return undefined
    })

    if (!result) return undefined
    return result.text || undefined
  }
}
