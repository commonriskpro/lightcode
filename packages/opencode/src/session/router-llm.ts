import z from "zod"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Auth } from "@/auth"
import { Log } from "@/util/log"

const log = Log.create({ service: "router-llm" })

const SYSTEM = `You are a tiny routing helper for a coding agent. Given the user message and tools already matched by keyword rules, suggest EXTRA tool ids the user may still need (synonyms, implicit steps, paraphrases keyword rules missed).

Rules:
- Only output tool ids that appear in ALLOWED_TOOL_IDS. Never invent ids.
- Prefer a small set (0–6 extras). Empty extra_tools if keyword rules already cover the intent.
- Coding tasks need tools like read, grep, glob, edit, write, bash, task, skill, webfetch, websearch as appropriate.
- Do not mark social/greeting here; that is handled elsewhere.`

const routerSchema = z.object({
  extra_tools: z
    .array(z.string())
    .describe("Additional tool ids from ALLOWED only; empty if rules suffice"),
  intent_note: z.string().max(120).optional().describe("Short label for logs"),
})

export async function augmentMatchedTools(input: {
  cfg: Config.Info
  sessionModel: Provider.Model | undefined
  userText: string
  /** Ids already selected by keyword rules + fallback */
  matched: Set<string>
  /** Builtin tool ids the router may attach (excludes MCP for the prompt list) */
  allowedBuiltin: Set<string>
  timeoutMs: number
}): Promise<{ added: string[]; note?: string } | undefined> {
  const ids = [...input.allowedBuiltin].sort()
  if (ids.length === 0) return undefined

  const resolved = await resolveRouterModel(input.cfg, input.sessionModel)
  if (!resolved) {
    log.info("router_llm_skip", { reason: "no_model" })
    return undefined
  }

  const language = await Provider.getLanguage(resolved)
  const user = [
    `USER_MESSAGE:\n${input.userText.slice(0, 8000)}`,
    "",
    `KEYWORD_RULE_TOOLS_ALREADY: ${[...input.matched].sort().join(", ") || "none"}`,
    "",
    `ALLOWED_TOOL_IDS (pick extras only from this comma-separated list):\n${ids.join(", ")}`,
  ].join("\n")

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ]

  const base = {
    model: language,
    temperature: 0,
    maxOutputTokens: 400,
    schema: routerSchema,
    messages,
    abortSignal: AbortSignal.timeout(Math.max(2000, input.timeoutMs)),
  } satisfies Parameters<typeof generateObject>[0]

  const authInfo = await Auth.get(resolved.providerID)
  const telemetry = {
    isEnabled: input.cfg.experimental?.openTelemetry,
    metadata: { userId: input.cfg.username ?? "unknown" },
  }

  try {
    const obj =
      resolved.providerID === "openai" && authInfo?.type === "oauth"
        ? await (async () => {
            const result = streamObject({
              ...base,
              experimental_telemetry: telemetry,
              providerOptions: ProviderTransform.providerOptions(resolved, { store: false }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })()
        : await generateObject({ ...base, experimental_telemetry: telemetry }).then((r) => r.object)

    const allowed = new Set(ids)
    const added = obj.extra_tools.filter((id) => allowed.has(id) && !input.matched.has(id))
    if (added.length === 0) {
      log.info("router_llm", { added: [], note: obj.intent_note })
      return undefined
    }
    log.info("router_llm", { added, note: obj.intent_note })
    return { added, note: obj.intent_note }
  } catch (e) {
    log.warn("router_llm_failed", { message: String(e) })
    return undefined
  }
}

async function resolveRouterModel(
  cfg: Config.Info,
  session: Provider.Model | undefined,
): Promise<Provider.Model | undefined> {
  const tr = cfg.experimental?.tool_router
  if (tr?.router_model) {
    const p = Provider.parseModel(tr.router_model)
    return Provider.getModel(p.providerID, p.modelID)
  }
  if (cfg.small_model) {
    const p = Provider.parseModel(cfg.small_model)
    return Provider.getModel(p.providerID, p.modelID)
  }
  if (session) return Provider.getSmallModel(session.providerID)
  return undefined
}
