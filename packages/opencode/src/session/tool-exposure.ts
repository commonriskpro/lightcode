import type { Tool as AITool } from "ai"
import type { MessageV2 } from "./message-v2"
import type { ToolRouter } from "./tool-router"
import { costForToolId } from "./router-eval-tool-cost"

/** @see Config experimental.tool_router.exposure_mode */
export type ExposureMode =
  | "per_turn_subset"
  | "memory_only_unlocked"
  | "stable_catalog_subset"
  | "subset_plus_memory_reminder"
  | "session_accumulative_callable"

export const EXPOSURE_MODES: readonly ExposureMode[] = [
  "per_turn_subset",
  "memory_only_unlocked",
  "stable_catalog_subset",
  "subset_plus_memory_reminder",
  "session_accumulative_callable",
] as const

export function normalizeExposureMode(raw: string | undefined): ExposureMode {
  if (raw && (EXPOSURE_MODES as readonly string[]).includes(raw)) return raw as ExposureMode
  return "per_turn_subset"
}

export type ExposureMemory = {
  unlocked: string[]
  sessionCallable: string[]
}

export function memoryFromMessages(msgs: MessageV2.WithParts[]): ExposureMemory {
  const last = msgs.findLast((m) => m.info.role === "assistant")
  if (!last || last.info.role !== "assistant") return { unlocked: [], sessionCallable: [] }
  const a = last.info
  return {
    unlocked: [...(a.toolExposureUnlockedIds ?? [])].sort(),
    sessionCallable: [...(a.toolExposureSessionCallableIds ?? [])].sort(),
  }
}

/** Tool ids from completed tool parts in the thread (usage / detection signal). */
export function toolIdsFromCompletedTools(msgs: MessageV2.WithParts[]): string[] {
  const s = new Set<string>()
  for (const m of msgs) {
    for (const p of m.parts) {
      if (p.type !== "tool") continue
      if (p.state.status !== "completed") continue
      s.add(p.tool)
    }
  }
  return [...s].sort()
}

function uniqSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort()
}

export function reminderLine(unlocked: string[]) {
  if (!unlocked.length) return ""
  return `Previously unlocked tools in this session (not all may be callable on this turn): ${unlocked.join(", ")}.`
}

export function estimateAttachedToolPayload(input: Record<string, AITool>): { bytes: number; tokens: number } {
  let bytes = 0
  for (const id of Object.keys(input)) {
    bytes += costForToolId(id).total_est_bytes
  }
  return { bytes, tokens: Math.ceil(bytes / 4) }
}

export type ApplyExposureInput = {
  mode: ExposureMode
  routed: ToolRouter.Result
  /** Full registry (same object ToolRouter uses as registryTools). */
  registryTools: Record<string, AITool>
  allowedToolIds: Set<string>
  messages: MessageV2.WithParts[]
  prior: ExposureMemory
}

export type ApplyExposureResult = {
  tools: Record<string, AITool>
  promptSuffix: string | undefined
  reminderInjected: boolean
  updated: ExposureMemory
  approxAttachedBytes: number
  approxAttachedTokens: number
  stableCatalogNote?: string
  /** True when exposure path widened attach set vs raw router output (e.g. accumulative). */
  widenedVsRouter: boolean
}

/**
 * Post-router hook: adjust which tool definitions are attached and optional reminder text.
 * `per_turn_subset` returns `routed` unchanged and does not persist exposure memory fields.
 */
export function applyExposure(input: ApplyExposureInput): ApplyExposureResult {
  const mode = input.mode
  const routedKeys = Object.keys(input.routed.tools).sort()
  const fromTools = toolIdsFromCompletedTools(input.messages)
  const detected = uniqSorted([...routedKeys, ...fromTools])
  const priorU = input.prior.unlocked
  const priorC = input.prior.sessionCallable
  const unlocked = uniqSorted([...priorU, ...detected])
  const allowed = input.allowedToolIds

  const emptyEst = estimateAttachedToolPayload({})

  /** Conversation tier: never attach tool definitions; keep session callable memory for later turns. */
  if (input.routed.contextTier === "conversation") {
    const unlockedNext = mode === "per_turn_subset" ? priorU : unlocked
    const remind =
      mode !== "per_turn_subset" && mode !== "stable_catalog_subset" && unlockedNext.length
        ? reminderLine(unlockedNext)
        : ""
    return {
      tools: {},
      promptSuffix: remind || undefined,
      reminderInjected: Boolean(remind),
      updated: { unlocked: unlockedNext, sessionCallable: priorC },
      approxAttachedBytes: emptyEst.bytes,
      approxAttachedTokens: emptyEst.tokens,
      widenedVsRouter: false,
    }
  }

  if (mode === "per_turn_subset") {
    const est = estimateAttachedToolPayload(input.routed.tools)
    return {
      tools: input.routed.tools,
      promptSuffix: undefined,
      reminderInjected: false,
      updated: { unlocked: priorU, sessionCallable: priorC },
      approxAttachedBytes: est.bytes,
      approxAttachedTokens: est.tokens,
      widenedVsRouter: false,
    }
  }

  if (mode === "stable_catalog_subset") {
    const est = estimateAttachedToolPayload(input.routed.tools)
    return {
      tools: input.routed.tools,
      promptSuffix: undefined,
      reminderInjected: false,
      updated: { unlocked, sessionCallable: uniqSorted(routedKeys.filter((id) => allowed.has(id))) },
      approxAttachedBytes: est.bytes,
      approxAttachedTokens: est.tokens,
      stableCatalogNote:
        "Stable full-catalog + per-turn allowed subset is not exposed as separate wire fields in this AI SDK stack; tools are a single merged map per request. Behavior matches per_turn_subset; see docs/spec-offline-tool-router.md.",
      widenedVsRouter: false,
    }
  }

  if (mode === "memory_only_unlocked" || mode === "subset_plus_memory_reminder") {
    const est = estimateAttachedToolPayload(input.routed.tools)
    const line = unlocked.length ? reminderLine(unlocked) : ""
    return {
      tools: input.routed.tools,
      promptSuffix: line || undefined,
      reminderInjected: Boolean(line),
      updated: {
        unlocked,
        sessionCallable: uniqSorted(routedKeys.filter((id) => allowed.has(id))),
      },
      approxAttachedBytes: est.bytes,
      approxAttachedTokens: est.tokens,
      widenedVsRouter: false,
    }
  }

  if (mode === "session_accumulative_callable") {
    const merged = uniqSorted([...priorC, ...routedKeys])
    const callable = merged.filter((id) => allowed.has(id) && input.registryTools[id])
    const out: Record<string, AITool> = {}
    for (const id of callable) {
      const t = input.registryTools[id]
      if (t) out[id] = t
    }
    const widened = Object.keys(out).length > Object.keys(input.routed.tools).length
    const line = unlocked.length ? reminderLine(unlocked) : ""
    const est = estimateAttachedToolPayload(out)
    return {
      tools: out,
      promptSuffix: line || undefined,
      reminderInjected: Boolean(line),
      updated: { unlocked, sessionCallable: uniqSorted(Object.keys(out)) },
      approxAttachedBytes: est.bytes,
      approxAttachedTokens: est.tokens,
      widenedVsRouter: widened,
    }
  }

  const est = estimateAttachedToolPayload(input.routed.tools)
  return {
    tools: input.routed.tools,
    promptSuffix: undefined,
    reminderInjected: false,
    updated: { unlocked: priorU, sessionCallable: priorC },
    approxAttachedBytes: est.bytes,
    approxAttachedTokens: est.tokens,
    widenedVsRouter: false,
  }
}
