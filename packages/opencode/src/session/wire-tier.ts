import { Flag } from "@/flag/flag"
import type { Config } from "@/config/config"
import type { MessageV2 } from "./message-v2"

export function threadHasAssistant(msgs: MessageV2.WithParts[]) {
  return msgs.some((m) => m.info.role === "assistant")
}

export function minimalTierAllTurns(cfg: Config.Info) {
  return Flag.OPENCODE_MINIMAL_TIER_ALL_TURNS || cfg.experimental?.minimal_tier_all_turns === true
}

function routerEnabled(cfg: Config.Info) {
  return !!(Flag.OPENCODE_TOOL_ROUTER || cfg.experimental?.tool_router?.enabled)
}

/**
 * True when ToolRouter.apply will filter tools on the first user turn (no assistant yet):
 * router on and `apply_after_first_assistant` is not `true`. Config default is `false` (narrow from T1); when `true`, the first turn keeps full tools until after the first assistant message.
 * Kept in sync with `session/tool-router.ts`.
 */
export function routerFiltersFirstTurn(cfg: Config.Info, msgs: MessageV2.WithParts[]) {
  if (!routerEnabled(cfg)) return false
  if (cfg.experimental?.tool_router?.apply_after_first_assistant === true) return false
  if (threadHasAssistant(msgs)) return false
  return true
}

/**
 * Instruction mode for the system prompt cache:
 * - `"full"`: inline all instruction file contents
 * - `"deferred"`: short note telling the model to read on demand (first turn minimal tier)
 * - `"index"`: list available instruction source paths without inlining contents (subsequent turns)
 */
export function instructionMode(
  cfg: Config.Info,
  msgs: MessageV2.WithParts[],
  skipRouter: boolean,
): "full" | "deferred" | "index" {
  if (skipRouter) return "full"
  // If global imports are disabled, always use deferred mode FIRST (before any other logic)
  if (Flag.OPENCODE_DISABLE_GLOBAL_IMPORTS) return "deferred"
  const t = Flag.OPENCODE_INITIAL_TOOL_TIER ?? cfg.experimental?.initial_tool_tier ?? "minimal"
  if (minimalTierAllTurns(cfg) && t === "minimal") return "deferred"
  if (routerFiltersFirstTurn(cfg, msgs)) return "full"
  if (t !== "minimal") return "index"
  if (!threadHasAssistant(msgs)) return "deferred"
  return "index"
}

/** @deprecated Use instructionMode instead. */
export function includeInstructionBodies(cfg: Config.Info, msgs: MessageV2.WithParts[]) {
  const t = Flag.OPENCODE_INITIAL_TOOL_TIER ?? cfg.experimental?.initial_tool_tier ?? "minimal"
  if (t !== "minimal") return true
  if (minimalTierAllTurns(cfg)) return false
  return threadHasAssistant(msgs)
}

/** @deprecated Use instructionMode instead. */
export function mergedInstructionBodies(cfg: Config.Info, msgs: MessageV2.WithParts[], skipRouter: boolean) {
  if (skipRouter) return true
  if (routerFiltersFirstTurn(cfg, msgs) && !minimalTierAllTurns(cfg)) return true
  return includeInstructionBodies(cfg, msgs)
}
