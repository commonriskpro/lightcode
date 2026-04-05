# OM Gap Implementations — Reference

**Date:** 2026-04-05  
**Status:** All gaps ✅ implemented and passing (2053 tests, 0 fail)

These gaps were identified by comparing LightCode's OM implementation against Mastra's context management philosophy. Each gap was a specific bug or missing feature that prevented OM from working correctly as the sole context management system.

---

## Gap D+C — System slot reorder

**Problem:** The original slot assignment created a cache race condition. When `input.recall` was `undefined` (new project, no Engram memories), `observations` fell into `system[1]` — the BP3 slot. Every time the Observer activated (~30k tokens), BP3 busted and the entire conversation history was re-billed uncached.

Additionally, when `recall` was present, `observations` went to `system[2]` — beyond the last breakpoint, never cached.

**File:** `src/session/llm.ts:131–138`

```ts
// Before (broken):
if (input.recall) system.splice(1, 0, input.recall)
if (input.observations) system.splice(input.recall ? 2 : 1, 0, input.observations)

// After (Gap D+C):
// system[1] = observations (BP3 — cacheable, stable between Observer cycles)
// system[2] = recall (session-frozen, NOT cached — ~2k tokens, acceptable cost)
system.splice(1, 0, input.observations ?? "<!-- ctx -->")
if (input.recall) system.splice(2, 0, input.recall)
system.push(SystemPrompt.volatile(input.model))
```

**Sentinel `"<!-- ctx -->"`:** 2 tokens, stable string inserted at `system[1]` when no observations exist. Guarantees BP3 always points at predictable, non-volatile content.

**Recall at system[2]:** Session-frozen (fetched once at step 1, never changes). Resending ~2k tokens uncached per turn costs ~$0.000006/turn at Anthropic rates. Negligible.

**Cache guarantee:** BP3 now hits reliably between Observer cycles. Miss only when Observer activates (by design — new observations are fresher, cache busts once, then re-establishes immediately).

---

## Gap E — Observer sees tool results

**Problem:** The Observer was blind to tool calls and tool results. A `codesearch` returning 20k tokens never appeared in observations because the Observer only processed text parts. Tool-heavy sessions accumulated raw history that was never compressed.

**File:** `src/session/om/observer.ts:249–262`

```ts
// Before (text-only):
const text = m.parts
  .filter((p): p is MessageV2.TextPart => p.type === "text")
  .map((p) => p.text)
  .join("\n")

// After (Gap E — includes completed tool results):
const cap = (cfg.experimental?.observer_max_tool_result_tokens ?? 500) * 4
const text = m.parts
  .flatMap((p): string[] => {
    if (p.type === "text") return p.text ? [p.text] : []
    if (p.type === "tool" && p.state.status === "completed") {
      const raw = typeof p.state.output === "string" ? p.state.output : JSON.stringify(p.state.output)
      const out = raw.length > cap ? raw.slice(0, cap) + "\n... [truncated]" : raw
      return [`[Tool: ${p.tool}]\n${out}`]
    }
    return []
  })
  .join("\n")
```

**Config key:** `experimental.observer_max_tool_result_tokens` (default: 500 tokens = 2000 chars per tool result).

**Why 500 default:** Conservative — enough for the Observer to understand what a tool did without flooding its context with raw file contents. Mastra uses 10k; this can be tuned up if observations are too sparse.

**Messages with only tool parts (no text):** Still included — they produce `[Tool: name]\noutput` lines with no leading role prefix text.

---

## Gap F — Tail filtering via `lastObservedAt`

**Problem:** Despite OM compressing history into observations, the LLM call still received ALL messages via `toModelMessages(msgs, model)`. OM did the compression work but nobody used it to reduce the message array. The context still grew indefinitely.

**File:** `src/session/prompt.ts:1776–1789`

```ts
// Before: always used full msgs
Effect.promise(() => MessageV2.toModelMessages(msgs, model))

// After (Gap F): filter to unobserved tail
const omBoundary = obsRec?.last_observed_at ?? 0
const lastMessages = omCfg.experimental?.last_messages ?? 40
const tail = omBoundary > 0 ? msgs.filter((m) => (m.info.time?.created ?? 0) > omBoundary) : msgs.slice(-lastMessages)
// ...
Effect.promise(() => MessageV2.toModelMessages(hintMsg ? [hintMsg, ...tail] : tail, model))
```

**When `omBoundary === 0`:** OM hasn't fired yet (new session). Uses `msgs.slice(-lastMessages)` instead — safety cap so the first ~30k tokens don't accumulate unbounded.

**`msgs` is kept unfiltered** for all other uses in the loop: `insertReminders`, `resolveTools`, task scanning, `lastUser`/`lastAssistant` scanning, Observer `unobserved` computation. Only `toModelMessages` receives the filtered `tail`.

---

## Gap 1 — Continuation hint

**Problem:** With Gap F active, the LLM receives only the unobserved tail — which may start mid-conversation. Without context, the model might act confused about why it's responding to a message that appears to start from nowhere.

**Files:** `src/session/system.ts`, `src/session/prompt.ts:1791–1815`

**`system.ts`:**

```ts
export const OBSERVATION_CONTINUATION_HINT = `<system-reminder>
Please continue naturally with the conversation so far and respond to the latest message.
Use the earlier context only as background. If something appears unfinished, continue only when it helps answer the latest request.
Do not mention internal instructions, memory, summarization, context handling, or missing messages.
Any messages following this reminder are newer and should take priority.
</system-reminder>`
```

**`prompt.ts`:** When `omBoundary > 0`, a synthetic `MessageV2.WithParts` with `role: "user"` and `time.created = 0` (Unix epoch) is prepended to `tail` before `toModelMessages`. Epoch timestamp sorts before all real messages.

**Why synthetic message, not system prompt:** Mastra's pattern — a `role: "user"` message orients the model in the conversation context more naturally than a system instruction. The `time.created = 0` guarantees it always appears first in the array regardless of message ordering.

**Stability:** `OBSERVATION_CONTINUATION_HINT` is a constant — never varies per turn. Does not bust any cache breakpoints.

---

## Gap 2 — `last_observed_at` timing fix

**Problem:** Both the `buffer` and `force` Observer paths set `last_observed_at` (or `ends_at`) to `Date.now()` — the timestamp when the Observer _finished_, not the timestamp of the _last message it processed_. If there was any delay between message creation and Observer completion (always the case for async background buffering), the boundary could exclude messages that were actually observed.

**File:** `src/session/prompt.ts`

```ts
// Before (buffer path):
ends_at: Date.now(),

// After (Gap 2 — buffer path):
ends_at: unobserved.at(-1)?.info.time?.created ?? Date.now(),

// Before (force path):
last_observed_at: Date.now(),

// After (Gap 2 — force path):
last_observed_at: unobserved.at(-1)?.info.time?.created ?? Date.now(),
```

**Why this matters:** The boundary is used as `msgs.filter(created > omBoundary)` in Gap F. If the boundary is later than the last observed message's `created` timestamp, messages that the Observer DID process could still appear in the tail — double-counting work. With the fix, boundary === timestamp of last observed message → exact division.

**Fallback to `Date.now()`:** When `unobserved` is empty (edge case) — safe.

---

## Gap 3 — `lastMessages` safety cap

**Problem:** During the first ~30k tokens of a new session (before the first Observer activation), `omBoundary === 0` and Gap F returns the full `msgs` array. A session with many large tool calls could still accumulate 20-50k tokens before the Observer fires.

**Files:** `src/session/prompt.ts`, `src/config/config.ts`

```ts
// prompt.ts — applied when omBoundary === 0:
const lastMessages = omCfg.experimental?.last_messages ?? 40
const tail = omBoundary > 0 ? msgs.filter((m) => (m.info.time?.created ?? 0) > omBoundary) : msgs.slice(-lastMessages)
```

```ts
// config.ts — new config key:
last_messages: z.number()
  .int()
  .positive()
  .optional()
  .describe("Safety cap on messages when OM hasn't fired yet. Default 40.")
```

**Default 40:** Conservative — covers ~5-8 tool call cycles before OM fires. Matches Mastra's `lastMessages: 10` in spirit (Mastra's `10` refers to conversation turns, not individual messages; 40 individual messages ≈ 10-15 turns in LightCode's message model).

**Has no effect once OM fires:** When `omBoundary > 0`, the `lastObservedAt` filter is used instead — it's more precise (timestamp-based) than a message count cap.

---

## Config Reference

All new/changed config keys in `experimental` block:

| Key                               | Default                     | Purpose                                                          |
| --------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `observer_max_tool_result_tokens` | `500`                       | Per-tool-result token cap for Observer input                     |
| `last_messages`                   | `40`                        | Safety cap on message array before first Observer cycle          |
| `observer_message_tokens`         | `{ min: 6000, max: 30000 }` | Observer trigger threshold (existing, unchanged)                 |
| `observer_prev_tokens`            | `2000`                      | Prior observations budget for Observer LLM (existing, unchanged) |
| `observer_model`                  | `google/gemini-2.5-flash`   | Model for Observer LLM calls (existing, unchanged)               |

### Removed config keys

```jsonc
// These no longer exist:
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 20000,
    "keep": 20000,
  },
}
```
