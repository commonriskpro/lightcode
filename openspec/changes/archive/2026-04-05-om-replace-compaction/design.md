# Design: om-replace-compaction

## Architecture Decision

Replace the emergency compaction system with OM as the sole context management mechanism. The OM already runs proactively; what's missing is (a) wiring observations into the cached system prompt slot, (b) teaching the Observer about tool results, and (c) actually filtering the message array to the unobserved tail before each LLM call.

---

## Phase 1 — Gaps D+C: System slot reorder (llm.ts + transform.ts)

### Current (broken) slot assignment

```ts
// llm.ts:132–134 — CURRENT
if (input.recall) system.splice(1, 0, input.recall)
if (input.observations) system.splice(input.recall ? 2 : 1, 0, input.observations)
system.push(SystemPrompt.volatile(input.model))
```

Problems:

- When `recall` is undefined, `observations` falls into `system[1]` (BP3 slot) — volatile, busts cache on every Observer activation
- When `recall` is present, `observations` goes to `system[2]` — **never cached** (BP3 only covers system[0] and system[1])

### New slot assignment

```ts
// llm.ts:132–136 — NEW
// system[1] = observations (BP3, cacheable, stable between Observer cycles)
// system[2] = recall (no BP, but session-frozen — only ~2k tokens, acceptable)
// system[last] = volatile (no BP, as today)
const obs = input.observations ?? "<!-- ctx -->" // sentinel when no observations
system.splice(1, 0, obs)
if (input.recall) system.splice(2, 0, input.recall)
system.push(SystemPrompt.volatile(input.model))
```

`applyCaching` in `transform.ts` already places BP3 on `system[1]`. No change needed there — the reorder is enough.

**Sentinel `"<!-- ctx -->"`**: 2 tokens, stable, guarantees BP3 always points at predictable content. Anthropic does not reject short system messages.

**Recall at system[2]**: recall is frozen at step 1, never changes in-session. Re-sending ~2k tokens uncached per turn costs ~$0.000006/turn at Anthropic rates — negligible. The stability win from having observations at BP3 far outweighs this.

---

## Phase 2 — Gap E: Observer sees tool results (observer.ts + config.ts)

### Current

```ts
// observer.ts:252–256 — CURRENT (text-only)
const text = m.parts
  .filter((p): p is MessageV2.TextPart => p.type === "text")
  .map((p) => p.text)
  .join("\n")
```

Tool calls and tool results are invisible to the Observer. A `codesearch` returning 20k tokens never appears in observations.

### New

```ts
// observer.ts — NEW, replace the text-only mapping
const cap = (cfg?.experimental?.observer_max_tool_result_tokens ?? 500) * 4 // chars

const text = m.parts
  .flatMap((p): string[] => {
    if (p.type === "text") return [p.text]
    if (p.type === "tool" && p.state.status === "completed") {
      const raw = typeof p.state.output === "string" ? p.state.output : JSON.stringify(p.state.output)
      const truncated = raw.length > cap ? raw.slice(0, cap) + "\n... [truncated]" : raw
      return [`[Tool: ${p.tool}]\n${truncated}`]
    }
    return []
  })
  .join("\n")
```

**Config key** — add to `config.ts` experimental block:

```ts
observer_max_tool_result_tokens: z.number()
  .int()
  .positive()
  .optional()
  .describe("Max tokens per tool result sent to the Observer LLM (default: 500)")
```

**Default 500 tokens** (conservatively lower than Mastra's 10k) — tunable upward. Enough to capture what a tool did without flooding the Observer with raw file content.

Messages with only tool parts and no text are included if they have completed results — they generate `[Tool: name]\noutput` lines with no leading text.

---

## Phase 3 — Gap F: lastObservedAt tail filter (prompt.ts)

### Current

```ts
// prompt.ts:1476 — CURRENT
let msgs = yield * MessageV2.filterCompactedEffect(sessionID)
// ... msgs used verbatim in toModelMessages at line 1811
```

All post-compaction messages are sent every turn.

### New

Insert after line 1476, before the model call:

```ts
// Gap F: apply lastObservedAt boundary — send only unobserved tail to LLM
const obsRec = OM.get(sessionID)
const boundary = obsRec?.last_observed_at ?? 0
const tail = boundary > 0 ? msgs.filter((m) => (m.info.time?.created ?? 0) > boundary) : msgs
```

Then at line 1811, replace `msgs` with `tail` in the `toModelMessages` call:

```ts
Effect.promise(() => MessageV2.toModelMessages(tail, model)),
```

**`msgs` is kept unfiltered** for all other uses in the loop:

- `insertReminders` — needs full history for reminder logic
- `resolveTools` — needs full history
- `tasks.pop()` scan — needs full message list
- `lastUser`/`lastAssistant` scanning — needs full list
- Observer `unobserved` computation — already computed from `msgs` before this change

`tail` is ONLY used for the LLM call at line 1811. This is the smallest possible blast radius.

---

## Phase 4 — Delete compaction machinery

### Files to delete entirely

```
src/session/compaction.ts          — 558 lines
src/session/cut-point.ts           —  60 lines
src/session/overflow.ts            —  22 lines
src/agent/prompt/compaction.txt    —  ~30 lines
test/session/compaction.test.ts    — 1212 lines
test/session/cut-point.test.ts     —  193 lines
test/session/revert-compact.test.ts —  621 lines
```

Total deleted: ~2700 lines.

### Call sites to remove from prompt.ts

| Line                                                              | What                                                                 | Replacement         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| `import { SessionCompaction }`                                    | Delete import                                                        | —                   |
| `const compaction = yield* SessionCompaction.Service`             | Delete yield                                                         | —                   |
| `tasks.filter(part.type === "compaction")`                        | Remove "compaction" from filter                                      | Keep "subtask" only |
| `if (task?.type === "compaction") { ... }`                        | Delete entire block (~10 lines)                                      | —                   |
| `if (yield* compaction.isOverflow(...)) { ... }`                  | Delete entire block (~4 lines)                                       | —                   |
| `if (result === "compact") { yield* compaction.create(...) }` × 2 | Replace with `log.warn("context overflow — OM should prevent this")` | no-op               |
| `yield* compaction.prune(...)`                                    | Delete line                                                          | —                   |
| `Layer.provide(SessionCompaction.defaultLayer)`                   | Delete from layer stack                                              | —                   |

### processor.ts changes

- Remove `needsCompaction: boolean` from `ProcessorContext`
- Remove `ctx.needsCompaction = true` at lines 357 and 468
- Remove `Stream.takeUntil(() => ctx.needsCompaction)` at line 506
- Remove `if (ctx.needsCompaction) return "compact"` at line 534
- `ContextOverflowError` catch at line 467: instead of setting `needsCompaction = true`, set `ctx.assistantMessage.error` directly (same as other errors) — the session errors visibly

### server/routes/session.ts

Remove the `POST /session/:id/compact` route handler (~50 lines). Remove `import { SessionCompaction }`.

### agent/agent.ts

Remove `import PROMPT_COMPACTION from "./prompt/compaction.txt"` and the compaction agent definition block (~5 lines).

### config/config.ts

Remove the `compaction` key from the config schema (~20 lines). Remove CLI flag handling for `--no-auto-compact` and `--no-prune` (lines 1488, 1491).

---

## What stays

| What                                                           | Why                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `filterCompacted` / `filterCompactedEffect` in `message-v2.ts` | DB backwards compat — existing sessions with compacted history must still load                 |
| `CompactionPart` type in `message-v2.ts` schema                | DB rows with `type: "compaction"` must still deserialize                                       |
| `CompactionPart` handling in `toModelMessages` (line 671)      | Converts compaction parts to "What did we do so far?" text — needed for legacy session display |
| `summary` field on `MessageV2.Assistant`                       | Used by `filterCompacted` to detect legacy compaction boundaries                               |

---

## Risk: Provider overflow before first OM cycle

For the first ~30k tokens of a new session, OM has not fired yet (`boundary = 0`). During this window:

- Gap F returns full `msgs` — same behavior as today
- If the user sends a massive prompt that overflows the context in turn 1, `ContextOverflowError` is caught by processor and becomes a visible session error

This is acceptable. Mastra has the same edge case and accepts it. The session error message should guide the user to start fresh.

## Risk: `result === "compact"` from processor

After removing compaction, the processor's `needsCompaction` path is removed. The `Result` type in `processor.ts` should become `"continue" | "stop"` (remove `"compact"`). All callers in `prompt.ts` that handle `result === "compact"` become dead code and are deleted.

---

## Test Plan

New tests to add (replacing deleted compaction tests):

| Test file                         | Coverage                                                |
| --------------------------------- | ------------------------------------------------------- |
| `test/session/observer.test.ts`   | Gap E — tool parts in Observer context string           |
| `test/session/observer.test.ts`   | Gap E — tool results truncated at cap                   |
| `test/session/observer.test.ts`   | Gap D+C — sentinel inserted when observations=undefined |
| `test/session/observer.test.ts`   | Gap D+C — observations at system[1] always              |
| `test/session/prompt.test.ts`     | Gap F — tail filter applied when boundary > 0           |
| `test/session/prompt.test.ts`     | Gap F — full msgs used when boundary = 0                |
| `test/session/message-v2.test.ts` | filterCompacted still works for legacy sessions         |
