import type { Tool as AITool } from "ai"
import type { MessageV2 } from "./message-v2"
import { threadHasAssistant } from "./wire-tier"

const SLIM_LEN = 200

/** First-turn allowlist when `initial_tool_tier` is minimal (spec: read/grep/glob/skill ± bash). */
const MINIMAL_IDS = ["read", "grep", "glob", "skill"] as const

function slim(t: AITool): AITool {
  const d = t.description
  if (typeof d !== "string" || d.length <= SLIM_LEN) return t
  return { ...t, description: `${d.slice(0, SLIM_LEN - 3)}...` }
}

export function applyInitialToolTier(input: {
  tools: Record<string, AITool>
  messages: MessageV2.WithParts[]
  tier: "full" | "minimal"
  includeBash: boolean
}): Record<string, AITool> {
  if (input.tier !== "minimal") return input.tools

  if (threadHasAssistant(input.messages)) return input.tools

  const allow = new Set<string>(MINIMAL_IDS)
  if (input.includeBash) allow.add("bash")

  const out: Record<string, AITool> = {}
  for (const id of allow) {
    const t = input.tools[id]
    if (t) out[id] = slim(t)
  }

  if (Object.keys(out).length === 0 && Object.keys(input.tools).length > 0) return input.tools

  return out
}
