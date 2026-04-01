import type { AssistantMessage } from "@opencode-ai/sdk/v2/client"

/**
 * Matches `packages/opencode/src/cli/cmd/tui/util/session-usage.ts` (OpenCode TUI).
 * Keep in sync when token accounting changes upstream.
 */
export function lastAssistantWithUsage(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  return messages.findLast(
    (item): item is AssistantMessage =>
      item.role === "assistant" && (item.tokens?.output ?? 0) > 0,
  )
}

export function turnTokenTotal(t: AssistantMessage["tokens"]) {
  const c = t.cache
  return t.input + t.output + t.reasoning + (c?.read ?? 0) + (c?.write ?? 0)
}

export function lastTurnTokenTotal(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  const last = lastAssistantWithUsage(messages)
  if (!last?.tokens) return 0
  return turnTokenTotal(last.tokens)
}

export function contextWindowPercent(last: AssistantMessage, contextLimit: number | undefined) {
  if (!contextLimit) return null
  return Math.round((turnTokenTotal(last.tokens) / contextLimit) * 100)
}
