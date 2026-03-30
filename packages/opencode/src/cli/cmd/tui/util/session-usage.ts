import type { AssistantMessage } from "@opencode-ai/sdk/v2"

export function lastAssistantWithUsage(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  return messages.findLast(
    (item): item is AssistantMessage =>
      item.role === "assistant" && (item.tokens?.output ?? 0) > 0,
  )
}

/**
 * Prompt-side tokens for one turn. Prefer `input + cache.read + cache.write` (matches `Session.getUsage`).
 * If that sum is tiny but `total` is present, fall back to `total - output - reasoning` (some providers
 * under-report `inputTokens` or omit cache fields).
 */
export function promptTokensForContext(t: AssistantMessage["tokens"]) {
  const c = t.cache
  const sum = t.input + (c?.read ?? 0) + (c?.write ?? 0)
  if (t.total == null) return sum
  const fromTotal = Math.max(0, t.total - t.output - t.reasoning)
  return Math.max(sum, fromTotal)
}

/**
 * Approximate **prompt** size for the last completed assistant turn (system + history + tools).
 * Uses `input + cache.read + cache.write`: `tokens.input` alone is only the **non-cached** slice, so providers
 * with prompt caching can show ~38 while the real footprint is tens of thousands.
 */
export function lastPromptContextTokens(
  messages: readonly { role: string; tokens?: AssistantMessage["tokens"] }[],
) {
  const last = lastAssistantWithUsage(messages)
  if (!last?.tokens) return 0
  return promptTokensForContext(last.tokens)
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

/** Share of model context window used by the last completed request (full prompt including cached). */
export function contextWindowPercent(last: AssistantMessage, contextLimit: number | undefined) {
  if (!contextLimit) return null
  return Math.round((promptTokensForContext(last.tokens) / contextLimit) * 100)
}
