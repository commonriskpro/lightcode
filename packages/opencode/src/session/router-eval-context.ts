import type { Tool as AITool } from "ai"
import type { Config } from "@/config/config"
import type { MessageV2 } from "./message-v2"
import { ToolRouter } from "./tool-router"

function dummyTool(id: string): AITool {
  return { description: `Tool ${id}` } as AITool
}

export function buildEvalTools(ids: string[]): Record<string, AITool> {
  const out: Record<string, AITool> = {}
  for (const id of ids) out[id] = dummyTool(id)
  return out
}

/** Last user message is `prompt`; optional prior assistant for thread shape. */
export function buildEvalMessages(prompt: string, opts?: { priorAssistant?: boolean }): MessageV2.WithParts[] {
  const u1 = {
    info: {
      id: "u0" as any,
      sessionID: "eval" as any,
      role: "user" as const,
      time: { created: 1 },
      agent: "build",
      model: { providerID: "opencode" as any, modelID: "m0" as any },
    },
    parts: [
      {
        type: "text" as const,
        text: ".",
        id: "p0" as any,
        sessionID: "eval" as any,
        messageID: "u0" as any,
      },
    ],
  } as MessageV2.WithParts

  const a1 = {
    info: {
      id: "a0" as any,
      sessionID: "eval" as any,
      role: "assistant" as const,
      parentID: u1.info.id,
      time: { created: 2 },
      mode: "primary",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "m0" as any,
      providerID: "opencode" as any,
    },
    parts: [],
  } as MessageV2.WithParts

  const u2 = {
    info: {
      id: "u1" as any,
      sessionID: "eval" as any,
      role: "user" as const,
      time: { created: 3 },
      agent: "build",
      model: { providerID: "opencode" as any, modelID: "m0" as any },
    },
    parts: [
      {
        type: "text" as const,
        text: prompt,
        id: "p1" as any,
        sessionID: "eval" as any,
        messageID: "u1" as any,
      },
    ],
  } as MessageV2.WithParts

  if (opts?.priorAssistant) return [u1, a1, u2]
  return [u2]
}

/** Default offline router settings aligned with local benchmark (Xenova on). */
export function defaultEvalRouterConfig(): Config.Info {
  return {
    experimental: {
      tool_router: {
        enabled: true,
        mode: "hybrid",
        apply_after_first_assistant: false,
        max_tools: 12,
        inject_prompt: true,
        keyword_rules: false,
        local_embed: true,
        /** Reviewed JSONL includes `expect_conversation` rows; conversation tier requires intent classification. */
        local_intent_embed: true,
        local_embed_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
        local_embed_top_k: 4,
        local_embed_min_score: 0.3,
        local_intent_min_score: 0.34,
        intent_merge_margin: 0.04,
        intent_max_intents: 3,
        intent_conversation_gap: 0.06,
        sticky_previous_turn_tools: true,
        router_only: false,
        no_match_fallback: false,
      },
    },
  } as Config.Info
}

export function mergeEvalConfig(
  base: Config.Info,
  patch: Partial<NonNullable<Config.Info["experimental"]>["tool_router"]>,
): Config.Info {
  const tr = base.experimental?.tool_router ?? {}
  return {
    ...base,
    experimental: {
      ...base.experimental,
      tool_router: {
        ...tr,
        ...patch,
      },
    },
  } as Config.Info
}

export type EvalModePreset =
  | "default"
  | "keyword_rules_on"
  | "keyword_rules_off"
  | "router_only"
  | "no_match_on"
  | "sticky_off"
  | "passthrough"
  | "intent_on"

export function evalModePatch(mode: EvalModePreset): Partial<NonNullable<Config.Info["experimental"]>["tool_router"]> {
  if (mode === "default") return {}
  if (mode === "keyword_rules_on") return { keyword_rules: true }
  if (mode === "keyword_rules_off") return { keyword_rules: false }
  if (mode === "router_only") return { router_only: true, base_tools: ["read", "task", "skill"], no_match_fallback: false }
  if (mode === "no_match_on") return { no_match_fallback: true }
  if (mode === "sticky_off") return { sticky_previous_turn_tools: false }
  if (mode === "passthrough") return { enabled: false }
  if (mode === "intent_on") return { local_intent_embed: true }
  return {}
}

export async function runRouterEvalCase(input: {
  prompt: string
  agent: { name: string; mode: string }
  available_tools: string[]
  cfg: Config.Info
  stickyToolIds?: string[]
}) {
  const tools = buildEvalTools(input.available_tools)
  const allowedToolIds = new Set(input.available_tools)
  const messages = buildEvalMessages(input.prompt)
  const prev = process.env.OPENCODE_TOOL_ROUTER
  process.env.OPENCODE_TOOL_ROUTER = "1"
  const out = await ToolRouter.apply({
    tools,
    registryTools: tools,
    allowedToolIds,
    messages,
    agent: input.agent,
    cfg: input.cfg,
    mcpIds: new Set(),
    skip: false,
    stickyToolIds: input.stickyToolIds,
  })
  if (prev === undefined) delete process.env.OPENCODE_TOOL_ROUTER
  else process.env.OPENCODE_TOOL_ROUTER = prev
  const selected = Object.keys(out.tools).sort()
  return {
    selected,
    context_tier: out.contextTier,
    prompt_hint: out.promptHint,
  }
}
