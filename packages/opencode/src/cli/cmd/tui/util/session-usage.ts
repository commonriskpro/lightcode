import type { AssistantMessage } from "@opencode-ai/sdk/v2"

/**
 * Last assistant message with a completed generation (`tokens.output > 0`), same predicate as
 * [anomalyco/opencode](https://github.com/anomalyco/opencode) TUI (`prompt/index.tsx`, `sidebar/context.tsx`).
 * Sidebar/prompt use this formula inline; this helper remains for tests and tooling.
 */
export function lastAssistantWithUsage(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  return messages.findLast(
    (item): item is AssistantMessage =>
      item.role === "assistant" && item.tokens != null && item.tokens.output > 0,
  )
}

/**
 * Prompt-side tokens only (input + cache read/write, with `total` fallback). For heuristics / debugging;
 * **not** what the TUI shows for the context counter — see {@link turnTokenTotal} (matches anomalyco/opencode).
 */
export function promptTokensForContext(t: AssistantMessage["tokens"]) {
  const c = t.cache
  const sum = t.input + (c?.read ?? 0) + (c?.write ?? 0)
  if (t.total == null) return sum
  const fromTotal = Math.max(0, t.total - t.output - t.reasoning)
  return Math.max(sum, fromTotal)
}

/**
 * Total tokens for one assistant turn — same five-field sum as anomalyco/opencode TUI context bar.
 */
export function turnTokenTotal(t: AssistantMessage["tokens"]) {
  const c = t.cache
  return t.input + t.output + t.reasoning + (c?.read ?? 0) + (c?.write ?? 0)
}

/**
 * Total tokens for the last completed assistant turn (for context display and % of model context limit).
 * Matches upstream OpenCode TUI; differs from {@link promptTokensForContext} which is prompt-footprint only.
 */
export function lastTurnTokenTotal(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  const last = lastAssistantWithUsage(messages)
  if (!last?.tokens) return 0
  return turnTokenTotal(last.tokens)
}

/** @deprecated Use {@link lastTurnTokenTotal} — old name reflected prompt-only counting. */
export function lastPromptContextTokens(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  return lastTurnTokenTotal(messages)
}

/** Sum of token usage across every assistant message (cumulative billing volume, not context size). */
export function sessionTotalRequestTokens(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  let n = 0
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tokens) continue
    const t = m.tokens
    n += t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  }
  return n
}

/** Share of model context window (uses same turn total as upstream TUI). */
export function contextWindowPercent(last: AssistantMessage, contextLimit: number | undefined) {
  if (!contextLimit) return null
  return Math.round((turnTokenTotal(last.tokens) / contextLimit) * 100)
}
