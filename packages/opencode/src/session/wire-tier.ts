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
 * - `"deferred"`: short note telling the model to read on demand
 * - `"index"`: list available instruction source paths without inlining contents (subsequent turns)
 */
export function instructionMode(
  cfg: Config.Info,
  msgs: MessageV2.WithParts[],
  skipRouter: boolean,
): "full" | "deferred" | "index" {
  if (skipRouter) return "full"
  if (Flag.OPENCODE_DISABLE_GLOBAL_IMPORTS) return "deferred"
  if (routerFiltersFirstTurn(cfg, msgs)) return "full"
  return "index"
}

/** @deprecated Use instructionMode instead. */
export function includeInstructionBodies(_cfg: Config.Info, _msgs: MessageV2.WithParts[]) {
  return true
}

/** @deprecated Use instructionMode instead. */
export function mergedInstructionBodies(cfg: Config.Info, msgs: MessageV2.WithParts[], skipRouter: boolean) {
  if (skipRouter) return true
  if (routerFiltersFirstTurn(cfg, msgs)) return true
  return true
}
