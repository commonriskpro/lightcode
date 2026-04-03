import type { Tool as AITool } from "ai"
import type { MessageV2 } from "./message-v2"
import { threadHasAssistant } from "./wire-tier"

const SLIM_LEN = 200

/** First-turn allowlist when `initial_tool_tier` is minimal (spec: read/grep/glob/skill ± bash). */
export const MINIMAL_IDS = ["read", "grep", "glob", "skill"] as const

export function minimalTierPromptHint(input: {
  includeBash: boolean
  includeWebfetch?: boolean
  includeWebsearch?: boolean
  /** When true, copy matches `experimental.minimal_tier_all_turns` (always-on minimal tier + router). */
  allTurns?: boolean
}) {
  const ids: string[] = [...MINIMAL_IDS]
  if (input.includeBash) ids.push("bash")
  if (input.includeWebfetch) ids.push("webfetch")
  if (input.includeWebsearch) ids.push("websearch")
  if (input.allTurns) {
    return [
      "## Minimal tool tier (every turn)",
      `Base tools always start as: ${ids.join(", ")}.`,
      "The offline router merges additional tools from the full registry from your message each turn. Use read/skill to load project instructions when needed.",
    ].join("\n")
  }
  return [
    "## Initial tool tier (first turn in this thread)",
    `Only these tools are attached until after the first assistant message: ${ids.join(", ")}.`,
    "Use read/skill (and glob/grep) to inspect the workspace; later turns unlock the full tool surface, then the offline router narrows by your message.",
  ].join("\n")
}

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
  includeWebfetch?: boolean
  includeWebsearch?: boolean
  /** When true, keep the minimal allowlist even after an assistant message (router + additive expand tools). */
  minimalAllTurns?: boolean
}): Record<string, AITool> {
  if (input.tier !== "minimal") return input.tools

  if (!input.minimalAllTurns && threadHasAssistant(input.messages)) return input.tools

  const allow = new Set<string>(MINIMAL_IDS)
  if (input.includeBash) allow.add("bash")
  if (input.includeWebfetch) allow.add("webfetch")
  if (input.includeWebsearch) allow.add("websearch")

  const out: Record<string, AITool> = {}
  for (const id of allow) {
    const t = input.tools[id]
    if (t) out[id] = slim(t)
  }

  if (Object.keys(out).length === 0 && Object.keys(input.tools).length > 0) return input.tools

  return out
}
