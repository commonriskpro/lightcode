# Exploration: om-mastra-gaps

**Change**: om-mastra-gaps  
**Date**: 2026-04-04  
**Scope**: `packages/opencode/src/session/om/`

---

## Current State

The LightCode Observational Memory (OM) system is a working implementation with four files:

| File              | Role                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `om/buffer.ts`    | `OMBuf` namespace — token accumulator + interval-based signal emitter    |
| `om/observer.ts`  | `Observer` namespace — LLM call to extract facts from messages           |
| `om/reflector.ts` | `Reflector` namespace — LLM call to compress observations when too large |
| `om/record.ts`    | `OM` namespace — SQLite persistence via Drizzle (upsert/reflect/buffers) |

The orchestration loop lives in `packages/opencode/src/session/prompt.ts` (~lines 1519–1605).

---

## Gap Analysis (Code-Verified)

### Gap 1 (HIGH): Async Buffering — Background Pre-Compute

#### LightCode current state

`OMBuf.check()` in `buffer.ts` returns one of `"buffer" | "activate" | "force" | "idle"`. Both `"buffer"` and `"activate"` branch in `prompt.ts` execute the Observer LLM call **synchronously** within the agent loop — the user waits while `Observer.run()` completes before the next model call proceeds:

```ts
// prompt.ts ~line 1525
if (sig === "buffer" || sig === "activate") {
  yield *
    Effect.promise(async () => {
      // ... Observer.run() happens HERE — blocking the loop turn
    }).pipe(Effect.ignore, Effect.forkIn(scope)) // forked but awaited at prompt assembly
}
```

`Effect.forkIn(scope)` means the fiber is scoped to the current `Effect.gen` scope — it does run concurrently with some work but the **next turn cannot start until the OM fiber finishes** because the scope is shared with the entire turn.

The `"force"` path at line 1566 uses `.pipe(Effect.ignore)` (no fork) — it is fully blocking.

`OM.addBuffer()` and `OM.activate()` exist in `record.ts` with a comment explicitly noting they are **"not called from the main observation path"** — they are dead code scaffolding for the async upgrade.

#### Mastra approach

`BufferingCoordinator` (class with static maps) starts an async background observation as soon as `bufferTokens` threshold (default 6k, ~0.2× the 30k trigger) is crossed. The observation is fired into a static `asyncBufferingOps` promise map. When activation crosses (0.8× threshold), the coordinator **awaits** the already-in-flight promise — no LLM call needed at that point. The result is zero latency at activation time.

Key constants:

- `bufferTokens` = 6 000 (20% of trigger) — starts background LLM
- `bufferActivation` = 0.8 (80% of trigger) — activates buffered result
- `blockAfter` = 1.2× trigger — hard block if async missed

#### Affected files

- `packages/opencode/src/session/om/buffer.ts` — needs pre-compute tracking state
- `packages/opencode/src/session/om/record.ts` — `addBuffer`/`activate` need to be wired up
- `packages/opencode/src/session/prompt.ts` (lines ~1519–1605) — orchestration must fork pre-compute at `"buffer"`, await+activate at `"activate"`

---

### Gap 2 (MEDIUM): Observer Prompt Richness

#### LightCode current state

`observer.ts` `PROMPT` constant is **27 lines**. It covers:

- 🔴 user assertions / 🟡 user requests distinction
- Timestamps + relative-to-absolute date resolution
- Superseded info marking
- XML output format (`<observations>`, `<current-task>`, `<suggested-response>`)

What it **lacks** (verified against Mastra's `observer-agent.ts` lines 1–200):

1. **Temporal anchoring split**: Mastra requires multi-event messages to be **split into separate observation lines**, each carrying their own date. LightCode has no such instruction.
2. **State-change framing**: Mastra explicitly instructs "User will use X (replacing Y)" for state transitions. LightCode only has `~old fact~ → new fact` notation, no explicit state-change framing instruction.
3. **Precise action verbs**: Mastra provides exhaustive mapping (`"getting" something regularly → "subscribed to"`, `"got" → "purchased/received/was given"`). LightCode has no verb-precision instruction.
4. **Preserving distinguishing details in lists**: Mastra dedicates a large section to preserving hotel names with attributes, @handles, numerical results, quantities. LightCode has no such guidance.
5. **`formatToolResultForObserver`**: Mastra truncates tool results before sending to the Observer LLM (configurable `maxToolResultTokens`). LightCode's `Observer.run()` only passes `text` parts — it already skips tool results entirely (line 155–162 filters `p.type === "text"`).

The `CONDENSE_PROMPT` (used for multi-chunk merging) is 11 lines — functional but minimal.

#### Mastra reference

Mastra `observer-agent.ts` is 1342 lines. The `OBSERVER_EXTRACTION_INSTRUCTIONS` export alone (lines 17–200) covers: assertion/question distinction, state-change framing, temporal anchoring with split events, preserving unusual phrasing, precise action verbs, and detail preservation for lists/names/numerical values.

#### Affected files

- `packages/opencode/src/session/om/observer.ts` — `PROMPT` constant

---

### Gap 3 (MEDIUM): Compression Start Level by Model

#### LightCode current state

`reflector.ts` starts the compression while-loop at `level: CompressionLevel = 0` unconditionally (line 123):

```ts
let level: CompressionLevel = 0
while (level <= 4) {
  const system = PROMPT + COMPRESSION_GUIDANCE[level]
  // ...
}
```

Level 0 has **no compression guidance** (`COMPRESSION_GUIDANCE[0] = ""`). This means:

- When using `gemini-2.5-flash` (the default observer model), the first attempt always carries zero compression instruction.
- Mastra identified that Gemini 2.5 Flash is a "faithful transcriber" — it tends to reproduce input rather than compress, requiring explicit pressure from level 1 or 2 to actually compress.
- Starting at level 0 wastes one LLM call that predictably fails to compress, escalating to level 1 unnecessarily.

#### Mastra approach (`observational-memory.ts` line 629–645)

```ts
async getCompressionStartLevel(requestContext?): Promise<CompressionLevel> {
  const modelId = resolved?.modelId ?? ''
  if (modelId.includes('gemini-2.5-flash')) return 2  // faithful transcriber
  return 1  // default for all other models
}
```

Level 0 (no guidance) is never used in production — it's an implicit first attempt that Mastra skips entirely.

#### Affected files

- `packages/opencode/src/session/om/reflector.ts` — `run()` must compute `startLevel` from the configured model before the while loop

---

### Gap 4 (LOW): `truncateObservationsToTokenBudget`

#### LightCode current state

In `Observer.run()` (observer.ts line 167–168), the full `prev` observations string is appended to the system prompt unconditionally:

```ts
if (input.prev) system += `\n\n## Previous Observations (for context, do not duplicate)\n${input.prev}`
```

No truncation. As observations grow (approaching the 40k reflector threshold), the Observer LLM is sent an increasingly large prior-observations block. This:

- Inflates token usage on every Observer call
- Risks exceeding context windows if observations are large
- Sends the model more noise than signal (older observations are less relevant)

#### Mastra approach

`prepareObserverContext()` (line 1175) applies `truncateObservationsToTokenBudget()` to the `previousObserverTokens` budget (default 2000 tokens) before passing to the Observer. The algorithm:

1. Splits observations by line
2. Builds suffix-sum array for O(1) tail-cost lookup
3. Prioritizes `🔴` (user assertions) and `✅` (completions) from the head
4. Keeps a raw tail (most recent observations)
5. Inserts `[N observations truncated here]` markers at gaps

The default budget is 2000 tokens — a small window compared to the up-to-40k observation store, dramatically reducing Observer input size.

#### Affected files

- `packages/opencode/src/session/om/observer.ts` — add `truncateObservationsToBudget()` helper + apply in `run()`
- `packages/opencode/src/session/prompt.ts` — potentially pass budget from config

---

### Gap 5 (LOW): Observation Groups + Recall Tool

#### LightCode current state

Observations are stored as a flat string in `ObservationTable.observations`. The `last_observed_at` timestamp exists but there is no grouping of observations by message range. `OM.get()` returns the entire observations blob. No recall/source-lookup tool exists.

#### Mastra approach (`observation-groups.ts`)

Wraps each observer output in:

```xml
<observation-group id="abc123" range="msgId1:msgId2">
...observations...
</observation-group>
```

This enables:

1. **Provenance tracking**: each observation group knows which message range it was derived from
2. **Recall tool**: agent can call `recall(groupId)` to retrieve the source messages
3. **Reflection group reconciliation**: after compression, group IDs and ranges are preserved via `reconcileObservationGroupsFromReflection()`, maintaining lineage through the reflection cycle
4. **Smarter truncation**: `truncateObservationsToTokenBudget` can truncate entire groups rather than lines

The implementation involves: `wrapInObservationGroup()`, `parseObservationGroups()`, `stripObservationGroups()`, `renderObservationGroupsForReflection()`, `reconcileObservationGroupsFromReflection()`.

#### Affected files (if implemented)

- `packages/opencode/src/session/om/record.ts` — schema change (no structured group storage currently)
- `packages/opencode/src/session/om/observer.ts` — wrap output in `<observation-group>`
- `packages/opencode/src/session/om/reflector.ts` — reconcile groups post-compression
- Database schema (`session.sql.ts`) — potential range column on observation

---

## Recommended Approach Per Gap

### Gap 1 — Async Buffering (HIGH)

**Recommended**: Implement true async pre-compute using the existing `OMBuf` + `OM.addBuffer/activate` scaffolding.

**Design sketch**:

1. Rename `"buffer"` signal → pre-compute trigger: `Effect.forkScoped` the Observer LLM call, store result in `ObservationBufferTable` via `OM.addBuffer()`
2. Store the in-flight `Promise` in a module-level `Map<SessionID, Promise<void>>` (mirrors Mastra's static `asyncBufferingOps`)
3. At `"activate"` signal: `await` the in-flight promise (already done), then call `OM.activate()` to condense buffers into main observations
4. `"force"` path: trigger synchronously (same as today) as a fallback

**Tradeoffs**:

- Pro: Zero user-perceived latency when threshold is crossed at activation
- Pro: The `addBuffer`/`activate` functions in `record.ts` already exist and are correct
- Con: Adds a module-level in-flight map that must be cleaned up on session end
- Con: If the buffer LLM call hasn't finished when activation is reached, we still wait — but this window is much smaller than waiting the full turn

**Effort**: Medium. The DB layer is ready. The main work is in `prompt.ts` orchestration.

---

### Gap 2 — Observer Prompt Richness (MEDIUM)

**Recommended**: Incremental prompt enrichment in two sub-steps:

1. **Sub-step A** (high value, low risk): Add temporal anchoring split instruction + state-change framing + precise action verbs — these directly improve observation quality with no code changes needed beyond the `PROMPT` constant.
2. **Sub-step B** (medium value): Add detail preservation for lists/names/numerical results — slightly longer prompt but measurably better recall for recommendation-heavy conversations.

**Tradeoffs**:

- Pro: Pure prompt change, zero code change, zero schema change, zero runtime risk
- Pro: Directly ports Mastra's `OBSERVER_EXTRACTION_INSTRUCTIONS` which is battle-tested
- Con: Longer system prompt = ~300–500 more tokens per Observer call (cost impact ~1%)
- Con: More instructions = higher chance of partial compliance from weaker models

**Effort**: Low. Copy and adapt Mastra's extraction instructions into LightCode's `PROMPT`.

---

### Gap 3 — Compression Start Level (MEDIUM)

**Recommended**: Add `getCompressionStart(modelId: string): CompressionLevel` helper function in `reflector.ts` and use it as the initial `level` in the while loop.

```ts
function startLevel(modelId: string): CompressionLevel {
  if (modelId.includes("gemini-2.5-flash")) return 2
  return 1
}
```

**Tradeoffs**:

- Pro: Saves 1–2 wasted LLM calls per reflection cycle when using the default model
- Pro: 5-line change, negligible risk
- Con: Hardcoded model string match — will need updating if model IDs change
- Con: Level 0 (no guidance) becomes unreachable in production — acceptable since it never worked well anyway

**Effort**: Low (< 10 lines).

---

### Gap 4 — `truncateObservationsToTokenBudget` (LOW)

**Recommended**: Implement a simplified version of Mastra's suffix-sum truncation algorithm as a pure helper in `observer.ts`, apply it before appending `prev` to the system prompt. Default budget: 2000 tokens (configurable via `experimental.observer_prev_tokens` config key).

**Simplified algorithm** (dropping the full Mastra complexity):

1. Split by `\n`, compute `tok = char >> 2` per line
2. Build suffix-sum array
3. Find the largest tail that fits in budget (O(n) scan)
4. Mark important lines (`🔴`, `✅`) from head — add them if budget permits
5. Insert `[N observations truncated here]` at gap

**Tradeoffs**:

- Pro: Caps Observer input size — direct cost/latency reduction as sessions grow
- Pro: Self-contained helper, no schema changes
- Con: Adds ~30 lines of algorithm code to `observer.ts`
- Con: Truncation might hide relevant older facts — mitigated by `🔴` preservation

**Effort**: Low-Medium (~30 lines + tests).

---

### Gap 5 — Observation Groups + Recall (LOW)

**Recommended**: **Defer** for now. The value is primarily in enabling a `recall` tool (agent can look up source messages for an observation). This requires:

- Schema changes to store group IDs + message ranges
- A new MCP/tool registration for `recall`
- Parser + serializer changes across observer + reflector

This is non-trivial and low immediate user impact. It can be addressed in a follow-up change.

**Tradeoffs**:

- Pro: Enables source provenance — explainability of where observations came from
- Pro: Enables smarter truncation at the group level
- Con: 4+ files touched, schema migration needed
- Con: Low urgency — flat string format works fine for core use cases

**Effort**: High. Not recommended for this change.

---

## Implementation Order Recommendation

| Priority | Gap                             | Effort     | Impact                            | Suggested Order                      |
| -------- | ------------------------------- | ---------- | --------------------------------- | ------------------------------------ |
| HIGH     | Gap 1: Async Buffering          | Medium     | Eliminates user-visible latency   | **1st**                              |
| MEDIUM   | Gap 3: Compression Start Level  | Low        | Saves LLM calls for default model | **2nd** (quick win, ship with Gap 1) |
| MEDIUM   | Gap 2: Observer Prompt Richness | Low        | Better observation quality        | **3rd**                              |
| LOW      | Gap 4: Token Budget Truncation  | Low-Medium | Cost/latency at scale             | **4th**                              |
| LOW      | Gap 5: Observation Groups       | High       | Deferred                          | **Future change**                    |

**Rationale**: Gap 1 (async buffering) has the highest user-facing impact and the DB scaffolding is already present. Gap 3 is a trivial companion fix that ships for free alongside Gap 1. Gap 2 (prompt enrichment) should come after the buffering architecture is stable. Gap 4 is a polishing step once the system is battle-tested.

---

## Affected Files Summary

| File                                            | Gaps                         |
| ----------------------------------------------- | ---------------------------- |
| `packages/opencode/src/session/om/buffer.ts`    | Gap 1                        |
| `packages/opencode/src/session/om/record.ts`    | Gap 1                        |
| `packages/opencode/src/session/om/observer.ts`  | Gap 2, Gap 4                 |
| `packages/opencode/src/session/om/reflector.ts` | Gap 3                        |
| `packages/opencode/src/session/prompt.ts`       | Gap 1 (orchestration wiring) |
| `packages/opencode/src/session/session.sql.ts`  | Gap 5 only (deferred)        |

---

## Risks

1. **Async buffering race condition**: If the session ends before the background Observer fiber completes, the buffered result may be lost. Mitigation: call `OM.activate()` synchronously on session close if an in-flight promise exists.

2. **Double-observation on fast sessions**: If `"buffer"` fires close to `"activate"` (within the same agent step), both could trigger an LLM call. The in-flight map (`asyncBufferingOps`) must guard against duplicate fires.

3. **Prompt length increase (Gap 2)**: Adding ~400 tokens to the Observer system prompt is safe at 1M context but adds cost. Measure token delta before shipping.

4. **Compression level skipping (Gap 3)**: Starting at level 1 (or 2) means the model may see guidance on the first attempt even when observations are barely over the threshold. Edge case: small observations that could be compressed trivially with no guidance now get `COMPRESSION_GUIDANCE[1]` applied. Negligible risk — the guidance is additive, not destructive.

5. **Truncation hiding critical facts (Gap 4)**: The 2000-token default budget is derived from Mastra's default but may need tuning. If the user has many `🔴` assertions, the preserve-head + keep-tail strategy may truncate useful middle observations. Add a config key to let users adjust.

---

## Ready for Proposal

**Yes** — Gaps 1–4 are well-understood, all affected files are identified, and the implementation approach is clear. Gap 5 is explicitly deferred.

The recommended first proposal covers Gaps 1 + 3 together (async buffering + compression start level), with Gaps 2 and 4 as a follow-up.
