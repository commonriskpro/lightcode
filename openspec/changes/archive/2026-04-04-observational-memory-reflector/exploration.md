# Exploration: observational-memory-reflector

## Current State

### Phase 2 (shipped) — what's live

**ObservationTable** (`session/session.sql.ts:105-125`):

- `observations text` — the running log written by Observer
- `reflections text` — currently always `null` (column exists, never written)
- `observation_tokens integer` — char/4 estimate of `observations` length
- `last_observed_at`, `generation_count` — bookkeeping

**OM.get / OM.upsert** (`session/om/record.ts:11-18`):

- `get(sid)` → synchronous SQLite SELECT (no stale-read risk — SQLite is serialized)
- `upsert` writes a full row; used in prompt.ts after Observer.run
- `activate(sid)` (`record.ts:36-74`) — merges buffered chunks into the main record via `Observer.condense`, clears buffers, updates `observation_tokens`

**Observer** (`session/om/observer.ts`):

- `Observer.run()` → LLM call → returns observation text or `undefined`
- `Observer.condense()` → LLM call to merge multiple buffer chunks into one coherent log
- Both read `cfg.experimental.observer_model` (default `google/gemini-2.5-flash`)
- No `reflections` concept exists yet

**Trigger hook in prompt.ts** (`prompt.ts:1516-1565`):

- After each turn, `OMBuf.check(sessionID, tok)` is called
- `"buffer"` / `"activate"` → `Effect.forkIn(scope)` (non-blocking background fiber)
- `"force"` → `Effect.ignore` (no fork — blocks until done before continuing loop)
- Both branches call `Observer.run()` + `OM.upsert()`
- When upserting, `reflections: null` is hardcoded (line 1533, 1557)
- `observation_tokens: obs.length >> 2` is a char/4 rough estimate

**System injection** (`system.ts:79-83`):

```ts
export async function observations(sid: SessionID): Promise<string | undefined> {
  const rec = OM.get(sid)
  if (!rec?.observations) return undefined
  return wrapObservations(rec.observations)
}
```

- No `reflections` awareness — always returns `observations`
- `wrapObservations` caps at 2000 tokens (`capRecallBody`)
- Called **every turn** in `prompt.ts:1741`

**system[2] injection** (`llm.ts:134`):

```ts
if (input.observations) system.splice(input.recall ? 2 : 1, 0, input.observations)
```

- Observations sit at system[2] (after recall at [1], before volatile at [3])
- Cache breakpoints on system[0] (agent, BP2 1h) and system[1] (recall, BP3 5min)
- system[2] has **no explicit cache breakpoint** — it's volatile on every turn

**Token threshold facts**:

- `OMBuf.check` thresholds: 6k (buffer), 30k (activate), 36k (force)
- `observation_tokens` on the DB record = `obs.length >> 2` (a rough approximation, not exact)
- These are accumulated LLM I/O tokens, not observation string tokens
- The Reflector threshold (40k) would be compared against `ObservationRecord.observation_tokens`

---

## Key Questions — Findings

### Q1: `reflections` field — Option A vs Option B

**Finding**: Option B is clearly the better fit and aligns with the codebase.

Evidence:

- `system.ts:79-83` — `observations()` does a single `OM.get(sid)` then reads `.observations`. Adding a preference for `.reflections` is a one-line change.
- `observations` accumulates across turns; the Observer writes new chunks and merges old ones into it. Wiping `observations` entirely (Option A) would break `Observer.run()`'s `prev` parameter, which feeds the previous observations log as context for new extraction.
- Option B: keep `observations` as the running log for Observer input; `reflections` = condensed snapshot for system injection. When `reflections` is not null, system[2] uses it instead of `observations`.
- The cap in `wrapObservations` (2000 tokens) currently clips large observation logs. With reflections, the Reflector produces a document already designed to fit the token budget, making the cap less of a blunt instrument.

**Recommendation**: Option B — `reflections` preferred over `observations` for system[2]; `observations` continues as the raw log that Observer writes to.

---

### Q2: Where should the Reflector trigger, and blocking vs non-blocking?

**Finding**: The Reflector should fire **after `activate()`** in the `"activate"` / `"force"` branches, as a **non-blocking `Effect.forkIn(scope)`**.

Evidence:

- `prompt.ts:1518-1540` — the Observer `"activate"` branch already runs as `Effect.forkIn(scope)`. The Reflector can be chained inside the same `Effect.promise` block after `OM.upsert()`.
- The check is: after `upsert`, read the fresh `OM.get(sid).observation_tokens`. If `> 40_000`, fire `Reflector.run()` and write `reflections` back.
- The `"force"` branch (`prompt.ts:1543-1565`) does NOT use `Effect.forkIn` — it runs inline. Adding the Reflector check there (also inline) is safe since the force branch already blocks.
- **Race window**: if the fork hasn't finished before `SystemPrompt.observations()` is called next turn, system[2] will still use the old `observations` (not reflections). This is acceptable — reflections appear on the next turn after the fork completes. No stale-write risk since SQLite is serialized and the fork writes to the `reflections` column, not `observations`.
- **Alternative (blocking inline)**: would add latency to the turn that crosses 40k. The observation log at 40k is already long; LLM condensation takes 1–3s. Non-blocking is the right default.

**Recommendation**: Non-blocking `Effect.forkIn(scope)` for both `"activate"` and `"force"` branches. The `"force"` branch can remain inline (blocking) for the Observer call, then fork the Reflector separately since reflections only need to be ready on the _next_ turn.

---

### Q3: Injection in `system.ts` — what needs to change

**Current** (`system.ts:79-83`):

```ts
export async function observations(sid: SessionID): Promise<string | undefined> {
  const rec = OM.get(sid)
  if (!rec?.observations) return undefined
  return wrapObservations(rec.observations)
}
```

**After Phase 3**: prefer `reflections` when present:

```ts
export async function observations(sid: SessionID): Promise<string | undefined> {
  const rec = OM.get(sid)
  if (!rec) return undefined
  const body = rec.reflections ?? rec.observations
  if (!body) return undefined
  return wrapObservations(body)
}
```

The `wrapObservations` wrapper and the 2000-token cap remain. The Reflector's output will be smaller than raw observations, so the cap becomes a safety net rather than a constant truncation.

**Tag clarification**: since reflections are a condensed form of observations, reusing `<local-observations>` tags is fine — the model doesn't need to distinguish the two.

---

### Q4: Token threshold detection — stale read risk

**Finding**: No stale-read risk.

Evidence:

- `OM.get()` (`record.ts:11-13`) uses `Database.use((db) => db.select()...get())` — synchronous SQLite via Drizzle
- SQLite WAL mode serializes writes; a `Database.use` after a prior `Database.use` (the upsert) sees the latest committed row
- `observation_tokens` is computed as `obs.length >> 2` at upsert time (`prompt.ts:1536, 1560`), so it reflects the current `observations` length
- The Reflector reads `observation_tokens` from the just-upserted record — the value is fresh

**Note**: `obs.length >> 2` is chars/4, not actual LLM tokens. At 40k "tokens" by this estimate, the observations string is ~160k characters. This is a generous estimate. The Reflector prompt should mention this is approximate.

---

### Q5: Mastra Reflector — what to borrow vs simplify

**Mastra's key principles** (`reflector-agent.ts:33-128`):

| Principle                                                               | Borrow?              | Reasoning                                                                                                                              |
| ----------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Your reflections are THE ENTIRETY of the assistant's memory"           | **Yes** — but softer | In lightcode, `recall` (Engram cross-session) still exists. Reflections replace `observations` only, not all memory. Adjust framing.   |
| Condense older more aggressively, retain recent detail                  | **Yes**              | Universal compression principle. Keep in Reflector prompt.                                                                             |
| Preserve `🔴` / `🟡` markers                                            | **Yes**              | These are already used by Observer. Reflector must preserve them.                                                                      |
| Preserve completion markers (`✅`)                                      | **Yes**              | Same principle applies even though Observer uses different markers.                                                                    |
| USER ASSERTIONS take precedence over questions                          | **Yes**              | Critical for correctness.                                                                                                              |
| Thread attribution (`<thread id="...">`)                                | **No**               | lightcode is single-session scope; no thread IDs. Drop entirely.                                                                       |
| Multi-level compression (0–4)                                           | **No, simplify**     | Mastra retries with escalating compression levels. For Phase 3, a single-pass compression is sufficient. Can add retry later.          |
| `<observations>` / `<current-task>` / `<suggested-response>` XML output | **Partial**          | Only need `<observations>` block. `<current-task>` and `<suggested-response>` are Mastra-specific orchestration hints not needed here. |
| Degenerate repetition detection                                         | **No for Phase 3**   | Nice-to-have, not P3 scope.                                                                                                            |

**Simplified Reflector prompt** for Phase 3:

```
You are a memory reflection agent. You receive a full observation log and must produce a condensed, coherent reflection that preserves all important information.

Rules:
- Preserve 🔴 (user assertions) and 🟡 (user requests) markers
- USER ASSERTIONS take precedence — the user is the authority on their own facts
- Condense older observations more aggressively, retain more detail for recent ones
- Merge duplicate or related facts into single bullets
- Mark superseded info: "~old fact~ → new fact"
- Preserve timestamps when present
- Output must match the input format (## Observations with bullet list)

Output the condensed reflection directly, no preamble.
```

---

### Q6: Config — `reflector_model` vs reuse `observer_model`

**Finding**: Reuse `observer_model`. Add a separate `reflector_model` key only if there's a strong reason (different model characteristics needed).

Evidence (`config.ts:1049-1060`):

- `observer_model` defaults to `google/gemini-2.5-flash` — fast, cheap, large context
- The Reflector has the same requirements: low cost, large context (to receive the full observations log), good at condensation
- Gemini-2.5-flash is an excellent fit for reflection too
- Adding a separate `reflector_model` key would be done the same way (optional string, `provider/model` format) but creates config surface area without clear benefit
- **Recommendation**: reuse `observer_model` for the Reflector. If users want a different model for reflection, they can configure it; for now, fallback to `observer_model ?? "google/gemini-2.5-flash"` is the right default.

---

### Q7: Test patterns — what the Reflector tests should follow

**Finding**: Follow the exact structure of `test/session/observer.test.ts`.

Structure used (`observer.test.ts:1-437`):

1. **Pure unit tests** (no DB, no Instance) — test state machines and pure functions directly (e.g., `OMBuf` tests at lines 17-133)
2. **Integration tests with `Instance.provide`** — for anything touching SQLite (e.g., `SystemPrompt.observations`, `OM.record` tests at lines 170-363)
3. **Inline logic replication** — for system array layout validation (lines 371-436), the test inlines a replica of the splice logic to verify ordering without invoking the full LLM stack
4. **`bun:test`** framework with `describe` / `test` / `expect`
5. **Unique session IDs per test** — `Session.create({})` + `Session.remove(s.id)` in try/finally

**Tests to write for Reflector**:

- Unit: `Reflector.shouldFire(observation_tokens)` — pure threshold check
- Unit: `Reflector.buildPrompt(observations)` — verify system prompt content
- Integration: `Reflector.run()` with mock observer data — verify `reflections` written to DB
- Integration: `SystemPrompt.observations()` with `reflections` set — verify reflections preferred over observations
- Integration: `SystemPrompt.observations()` with both null — verify `undefined` returned

---

## Affected Areas

- `packages/opencode/src/session/om/observer.ts` — add `Reflector` namespace (or new `reflector.ts` file)
- `packages/opencode/src/session/om/record.ts` — add `OM.reflect(sid, reflections)` update helper
- `packages/opencode/src/session/om/index.ts` — re-export `Reflector`
- `packages/opencode/src/session/system.ts` — `observations()`: prefer `reflections` when present
- `packages/opencode/src/session/prompt.ts` — trigger Reflector after Observer in activate/force branches
- `packages/opencode/src/config/config.ts` — optionally add `reflector_model` key (likely skip — reuse `observer_model`)
- `packages/opencode/test/session/observer.test.ts` — add Reflector tests alongside existing OM tests

---

## Approaches

### Approach 1 — Reflector as new namespace in `observer.ts` (inline)

- Add `Reflector` namespace inside `session/om/observer.ts`
- Pros: single file, mirrors existing pattern (Observer is already a namespace)
- Cons: file gets longer; mixes two distinct concerns
- Effort: Low

### Approach 2 — Separate `session/om/reflector.ts` file

- New file alongside `observer.ts`, `buffer.ts`, `record.ts`
- Export `Reflector` namespace
- Add re-export to `index.ts`
- Pros: clear separation of concerns, easier to test in isolation, follows existing pattern of one-namespace-per-file
- Cons: slightly more files
- Effort: Low

---

## Recommendation

**Approach 2** — dedicated `session/om/reflector.ts`. Mirrors the existing one-namespace-per-file convention. The Reflector prompt is substantial enough to warrant its own home.

**Full implementation plan**:

1. `session/om/reflector.ts` — `Reflector.run(sid)`: reads `OM.get(sid).observations`, calls LLM with condensing prompt, writes `reflections` back via `OM.reflect(sid, text)`
2. `session/om/record.ts` — add `OM.reflect(sid, reflections)`: targeted UPDATE of `reflections` column only (avoids overwriting `observations`)
3. `session/system.ts` — `observations()`: `const body = rec.reflections ?? rec.observations`
4. `session/prompt.ts` — in the `"activate"` / `"force"` branches, after `OM.upsert()`, check `OM.get(sid).observation_tokens > 40_000` and fire `Reflector.run(sid)` (forked for activate, inline for force since it's already blocking)
5. `session/om/index.ts` — re-export `Reflector`

**Token threshold**: `observation_tokens > 40_000` where `observation_tokens = obs.length >> 2`. This fires when the observations string exceeds ~160k characters — well past the point where system[2] would bloat.

---

## Risks

- **LLM reflections can lose information**: The Reflector must be instructed to be conservative. If it drops facts, the model loses context permanently for this session. The prompt should emphasize "do not omit any fact".
- **Token estimate vs actual**: `obs.length >> 2` is coarse. At exactly 40k by this metric, real token count may differ by ±20%. This is acceptable as a trigger threshold.
- **Reflector fork races with next turn's system injection**: If the Reflector fork takes >1 turn to complete, system[2] will use stale `observations` for one more turn. Acceptable — reflections are an optimization, not a correctness requirement.
- **Double LLM call overhead**: activate already calls `Observer.run()`. Adding Reflector.run() is a second background LLM call. Since both are forked, latency impact is minimal.

---

## Ready for Proposal

**Yes.** All questions answered with file:line evidence. The implementation is straightforward:

- 1 new file (`reflector.ts`)
- 1 new helper in `record.ts`
- 2 targeted edits (1 line in `system.ts`, ~10 lines in `prompt.ts`)
- Reuses existing patterns (Observer, `generateText`, `Config.get()`, `Effect.forkIn`)
- No schema migration needed (`reflections` column already exists and is nullable)
