# Context Growth & Cache Analysis: LightCode vs Mastra

**Date:** 2026-04-05  
**Trigger:** User reported context hitting ~260k tokens very quickly during search operations  
**Status:** ✅ RESOLVED — all root causes addressed. See implementation summary at the bottom of this document.

---

## TL;DR

LightCode and Mastra have **opposite philosophies** for solving the same problem. That philosophical difference produces concrete consequences in cost and compaction speed. There are also three specific issues in LightCode that compound to produce the observed fast token growth.

---

## Part 1: How Mastra Solves the Problem

Mastra **does not use explicit `cache_control` markers**. Never. Its strategy is **structural**:

```
[system: agent instructions]
[system: observations block — grows slowly, stable prefix]
[message[0]: <system-reminder> — always static]
[message[1..N-K]: only unobserved messages (tail)]
[message[N]: current user message]
```

The key insight: observations go into the **system prompt**, are **additive** (appended, never replaced mid-chain), and the block only grows when the Observer runs (~every 6k tokens in background). This makes the prefix naturally stable for Anthropic and OpenAI automatic caching — no explicit breakpoints needed.

The **message history** is also truncated by design — only the `lastMessages: 10` most recent, plus unobserved messages. Everything else is already compressed in the system prompt observations.

**Result:** context grows SLOWLY because most of the history is compressed into the system prompt (which is cached), and the message tail is small (last 10).

### Mastra token budgets (from `packages/memory/src/processors/observational-memory/constants.ts`)

| Budget                               | Default        | What it controls                                    |
| ------------------------------------ | -------------- | --------------------------------------------------- |
| `observation.messageTokens`          | **30,000**     | Observer fires at this unobserved message threshold |
| `reflection.observationTokens`       | **40,000**     | Reflector fires at this observation token threshold |
| `observation.bufferTokens`           | `0.2` (~6,000) | Pre-buffer interval in background                   |
| `observation.bufferActivation`       | `0.8`          | Retain 20% of threshold after activation            |
| `observation.previousObserverTokens` | **2,000**      | Prior observations sent to Observer LLM             |
| `lastMessages` (core default)        | **10**         | Max recent messages in message array                |

### How Mastra handles tool results

Tool results are **not stored raw in the message array**. The Observer compresses them:

```typescript
// observer-agent.ts
if (inv.state === "result") {
  const resultStr = formatToolResultForObserver(resultForObserver, { maxTokens: maxToolResultTokens })
  return `[Tool Result: ${inv.toolName}]\n${maybeTruncate(resultStr, maxLen)}`
}
```

After observation, the raw tool call/result pairs are removed from the active context entirely. The message tail never accumulates unbounded tool output.

---

## Part 2: How LightCode Solves the Problem — Current State (post-implementation)

LightCode uses **explicit cache breakpoints** via `cache_control: { type: "ephemeral" }` combined with OM-based tail filtering. Current structure (Gap D+C implemented):

| Slot                | Content                                      | Cache          |
| ------------------- | -------------------------------------------- | -------------- |
| `system[0]`         | Agent prompt + env + skills + instructions   | BP2 — 1hr TTL  |
| `system[1]`         | OM observations OR sentinel `"<!-- ctx -->"` | BP3 — 5min TTL |
| `system[2]`         | Engram recall (session-frozen, optional)     | **Not cached** |
| `system[last]`      | Volatile (model ID + today's date)           | **Not cached** |
| `conversation[N-2]` | Penultimate message                          | BP4 — 5min TTL |

### How the system array is built (current)

**`llm.ts:131–138`:**

```ts
// system[1] = observations (BP3 — cacheable, stable between Observer cycles)
// system[2] = recall (session-frozen, NOT cached — uncached by design)
// system[last] = volatile (NOT cached)
system.splice(1, 0, input.observations ?? "<!-- ctx -->")
if (input.recall) system.splice(2, 0, input.recall)
system.push(SystemPrompt.volatile(input.model))
```

### How the message tail is filtered (current)

**`prompt.ts:1776–1789`:**

```ts
const omBoundary = obsRec?.last_observed_at ?? 0
const lastMessages = omCfg.experimental?.last_messages ?? 40
const tail = omBoundary > 0 ? msgs.filter((m) => (m.info.time?.created ?? 0) > omBoundary) : msgs.slice(-lastMessages)
// + continuation hint prepended when omBoundary > 0
```

---

## Issues (historical — all resolved)

### Issue 1 — RESOLVED: `observations` entered the BP3 slot when `recall` was undefined

**Was:** `splice(input.recall ? 2 : 1, 0, observations)` — when recall was falsy, observations fell to `system[1]` and cache-busted on every Observer activation.

**Fix (Gap D+C):** Observations are now **always** at `system[1]` unconditionally. Sentinel `"<!-- ctx -->"` fills the slot when observations don't exist yet. BP3 never fluctuates.

---

### Issue 2 — RESOLVED: `observations` at `system[2]` were never cached

**Was:** When Engram had recall, observations went to `system[2]` — beyond the last breakpoint, re-sent every turn.

**Fix (Gap D+C):** Observations moved to `system[1]` (BP3). Recall moved to `system[2]` (session-frozen, small ~2k tokens — acceptable cost).

---

### Issue 3 — RESOLVED: Full message history re-sent every turn

**Was:** Every LLM call re-sent the full post-compaction message history. Tool results accumulated unbounded until compaction fired at ~192k tokens.

**Fix (Gap F + Gap 3):** LLM call now uses `tail` — only messages after `last_observed_at`. Once OM fires (~30k tokens), the array is the unobserved tail only. When OM hasn't fired yet (`boundary=0`), `lastMessages` safety cap (default 40) limits the array. Tool results observed by the Observer no longer appear in the message array.

---

### Issue 4 — RESOLVED: Emergency compaction architecture

**Was:** `compaction.ts`, `overflow.ts`, `cut-point.ts` — emergency LLM-based compaction at ~192k tokens.

**Fix:** All three files **deleted**. OM-based context management prevents the context from reaching overflow in normal use. Provider overflow errors surface as visible session errors (rare edge case).

---

### Issue 5 — BY DESIGN: `recall` frozen at step 1

`recall` is fetched once at step 1. New Engram memories from the current session are not visible until next session start. This is intentional — changing `system[1]` content every turn would bust BP3 constantly. The tradeoff is acceptable.

---

## Architectural Comparison (updated)

| Dimension                   | Mastra                                            | LightCode (current)                                                      |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| **Cache strategy**          | Structurally stable prefix (no explicit markers)  | Explicit `cache_control: ephemeral` breakpoints                          |
| **Observations in prompt**  | System prompt, implicitly cached as stable prefix | `system[1]` (BP3) — cacheable ✅                                         |
| **Message history**         | Only `lastMessages: N` + unobserved tail          | Unobserved tail (Gap F) + `lastMessages` safety cap ✅                   |
| **Tool results in history** | Observed by OM, removed from message array        | Observed by OM (Gap E), removed via tail boundary ✅                     |
| **When recall is present**  | N/A — no Engram                                   | BP3=observations ✅, recall at system[2] (uncached)                      |
| **When recall is absent**   | N/A                                               | BP3=observations with sentinel ✅ (never busts)                          |
| **Volatile content**        | End of message array (outside system)             | `system[last]` — beyond BPs ✅                                           |
| **Compaction trigger**      | OM handles it — messages stay small               | OM handles it — compaction system deleted ✅                             |
| **Tool result budget**      | Observer truncates per `maxToolResultTokens`      | Observer truncates at `observer_max_tool_result_tokens` (default 500) ✅ |

---

## Cache Slot Stability Matrix (current)

| BP  | Slot                 | Content                                      | Stability                      | Miss trigger                   |
| --- | -------------------- | -------------------------------------------- | ------------------------------ | ------------------------------ |
| BP2 | `system[0]`          | Agent prompt + env + skills + instructions   | Session-stable                 | Agent switch                   |
| BP3 | `system[1]`          | OM observations OR `"<!-- ctx -->"` sentinel | Stable between Observer cycles | ~Every 30k tokens (Observer)   |
| —   | `system[2]`          | Engram recall (optional, session-frozen)     | Never changes within session   | Not cached — always re-sent    |
| —   | `system[last]`       | Volatile: model ID + today's date            | Changes once per day           | Once per day                   |
| BP4 | `conversation[N-2]`  | Penultimate message                          | Shifts right each turn         | Message content change         |
| BP1 | Last tool definition | Tool definitions dict                        | Stable if sorted (it is)       | Tool added/removed mid-session |

---

## System Array Diagrams (current)

### Scenario A: New session, no OM observations yet

```
system[0]: PROMPT_LIGHTCODE + env + skills + instructions   ← BP2 (1hr)
system[1]: "<!-- ctx -->" (sentinel)                        ← BP3 (5min) ✅ STABLE
system[2]: <engram-recall>...</engram-recall> (if present)  ← no cache
system[last]: volatile (model ID + date)                    ← no cache

tail = msgs.slice(-40)   // lastMessages safety cap
```

### Scenario B: Active session, OM has observed, Engram active

```
system[0]: PROMPT_LIGHTCODE + env + skills + instructions   ← BP2 (1hr) → HIT
system[1]: <local-observations>...</local-observations>     ← BP3 (5min) → HIT ✅
system[2]: <engram-recall>...</engram-recall> (≤2k tokens)  ← no cache → re-sent (~2k tokens, acceptable)
system[last]: volatile (model ID + date)                    ← no cache

tail = msgs.filter(created > last_observed_at)  // typically 2–8 messages
continuation_hint prepended to tail
```

### Scenario C: Active session, OM has observed, no Engram recall

```
system[0]: PROMPT_LIGHTCODE + env + skills + instructions   ← BP2 (1hr) → HIT
system[1]: <local-observations>...</local-observations>     ← BP3 (5min) → HIT ✅
system[last]: volatile (model ID + date)                    ← no cache

tail = msgs.filter(created > last_observed_at)
```

---

## Root Cause Resolution Summary

The 260k growth was caused by three compounding issues — all resolved:

| Issue   | Root cause                                                 | Fix                                               |
| ------- | ---------------------------------------------------------- | ------------------------------------------------- |
| Issue 1 | BP3 busted on every Observer activation (slot race)        | Gap D+C: observations always at system[1]         |
| Issue 2 | Observations uncached at system[2]                         | Gap D+C: observations moved to BP3 slot           |
| Issue 3 | Full message history re-sent until emergency compaction    | Gap F: tail boundary + Gap 3: lastMessages cap    |
| Issue 4 | Emergency compaction architecture incompatible with OM     | Deleted: compaction.ts, overflow.ts, cut-point.ts |
| Issue 5 | Tool results invisible to Observer (raw tools accumulated) | Gap E: Observer sees tool parts                   |

---

## Files Referenced (current)

| File                                                               | Role                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `packages/opencode/src/session/llm.ts:131–138`                     | System array construction — Gap D+C slot order                |
| `packages/opencode/src/provider/transform.ts:237–255`              | `applyCaching` — BP2/BP3/BP4 placement                        |
| `packages/opencode/src/session/prompt.ts:1776–1815`                | Gap F tail filter, Gap 1 continuation hint, recall fetch      |
| `packages/opencode/src/session/system.ts`                          | `wrapObservations`, `OBSERVATION_CONTINUATION_HINT`, `recall` |
| `packages/opencode/src/session/om/observer.ts:249–262`             | Gap E: tool parts in Observer context                         |
| `packages/opencode/src/tool/codesearch.ts:44–48`                   | tokensNum: default 5k, max 50k                                |
| `packages/memory/src/processors/observational-memory/constants.ts` | Mastra OM defaults                                            |
| `packages/memory/src/index.ts`                                     | Mastra `getContext()` — system prompt assembly                |

---

## Implementation Reference

For full details of each fix see:

- `docs/om-replace-compaction.md` — architectural decision to delete compaction
- `docs/om-gap-implementations.md` — Gap D+C, E, F, 1, 2, 3 implementation details
