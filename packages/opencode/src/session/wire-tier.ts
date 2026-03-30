import { Flag } from "@/flag/flag"
import type { Config } from "@/config/config"
import type { MessageV2 } from "./message-v2"

export function threadHasAssistant(msgs: MessageV2.WithParts[]) {
  return msgs.some((m) => m.info.role === "assistant")
}

function routerEnabled(cfg: Config.Info) {
  return !!(Flag.OPENCODE_TOOL_ROUTER || cfg.experimental?.tool_router?.enabled)
}

/**
 * True when ToolRouter.apply will filter tools on the first user turn (no assistant yet):
 * router on and `apply_after_first_assistant === false`. Default is false (router skips T1).
 * Kept in sync with `session/tool-router.ts`.
 */
export function routerFiltersFirstTurn(cfg: Config.Info, msgs: MessageV2.WithParts[]) {
  if (!routerEnabled(cfg)) return false
  if (cfg.experimental?.tool_router?.apply_after_first_assistant !== false) return false
  if (threadHasAssistant(msgs)) return false
  return true
}

/** When `initial_tool_tier` is minimal and the thread has no assistant yet, omit merged instruction file bodies (see system-prompt-cache). */
export function includeInstructionBodies(cfg: Config.Info, msgs: MessageV2.WithParts[]) {
  const t = Flag.OPENCODE_INITIAL_TOOL_TIER ?? cfg.experimental?.initial_tool_tier ?? "full"
  if (t !== "minimal") return true
  return threadHasAssistant(msgs)
}

/**
 * Whether to merge AGENTS.md / instruction URLs into the system prompt.
 * Coordinates with tool-router: if the router filters on turn 1, keep full instructions so the model has project context alongside a narrowed tool set.
 */
export function mergedInstructionBodies(cfg: Config.Info, msgs: MessageV2.WithParts[], skipRouter: boolean) {
  if (skipRouter) return true
  if (routerFiltersFirstTurn(cfg, msgs)) return true
  return includeInstructionBodies(cfg, msgs)
}
