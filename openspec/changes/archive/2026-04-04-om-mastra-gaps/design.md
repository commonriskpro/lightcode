# Design: om-mastra-gaps

## 1. Overview

Four changes to the OM subsystem, each self-contained:

| Phase | What                        | Key decision                                                                                                      |
| ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1A    | Async buffering             | Module-level `inFlight` map in `buffer.ts`, fire-and-forget `Observer.run()` at `"buffer"`, await at `"activate"` |
| 1B    | Compression start level     | Exported pure `startLevel()` in `reflector.ts` — skip level 0                                                     |
| 2     | Observer prompt richness    | Replace `PROMPT` constant in `observer.ts` with enriched version ported from Mastra                               |
| 3     | Observer context truncation | Pure `truncateObsToBudget()` in `observer.ts` + config key `observer_prev_tokens`                                 |

No schema migrations. No new tables. No breaking API changes. `record.ts` is untouched — `OM.addBuffer()` and `OM.activate()` already exist and are correct.

---

## 2. Phase 1A — Async Buffering

### Architecture Decision

| Option                           | Tradeoff                                                            | Decision   |
| -------------------------------- | ------------------------------------------------------------------- | ---------- |
| `inFlight` map in `buffer.ts`    | Co-located with `OMBuf` state machine, single ownership             | **Chosen** |
| `inFlight` map in `record.ts`    | Mixes persistence with coordination concern                         | Rejected   |
| `inFlight` map in `prompt.ts`    | Pollutes orchestrator with OM internals                             | Rejected   |
| Effect `Ref` / `SynchronizedRef` | Adds Effect layer dependency to a module that's currently pure sync | Rejected   |

### 2.1 `buffer.ts` Additions

```ts
// Module-level — co-located with OMBuf state
const inFlight = new Map<SessionID, Promise<void>>()

export namespace OMBuf {
  // ... existing members unchanged ...

  export function setInFlight(sid: SessionID, p: Promise<void>): void {
    inFlight.set(sid, p)
  }

  export function getInFlight(sid: SessionID): Promise<void> | undefined {
    return inFlight.get(sid)
  }

  export function clearInFlight(sid: SessionID): void {
    inFlight.delete(sid)
  }

  export async function awaitInFlight(sid: SessionID): Promise<void> {
    const p = inFlight.get(sid)
    if (!p) return
    await p
    inFlight.delete(sid)
  }
}
```

`awaitInFlight` is await + delete in one call. Used at `"activate"` and session cleanup. The `Promise<void>` wraps the entire background pipeline (Observer.run → OM.addBuffer → clearInFlight), so callers only need `await` — no error handling, failures are swallowed inside the promise.

### 2.2 `prompt.ts` Orchestration Changes (lines ~1519–1606)

The current code treats `"buffer"` and `"activate"` identically — both run Observer synchronously via `Effect.forkIn(scope)`. The new design splits them:

**`"buffer"` branch** — fire-and-forget background pre-compute:

```ts
if (sig === "buffer") {
  if (!OMBuf.getInFlight(sessionID)) {
    const rec = OM.get(sessionID)
    const boundary = rec?.last_observed_at ?? 0
    const unobserved = msgs.filter((m) => (m.info.time?.created ?? 0) > boundary)
    const p = (async () => {
      OMBuf.setObserving(true)
      try {
        const result = await Observer.run({
          sid: sessionID,
          msgs: unobserved,
          prev: rec?.observations ?? undefined,
          priorCurrentTask: rec?.current_task ?? undefined,
        })
        if (result) {
          OM.addBuffer({
            id: Identifier.ascending("obs_buf"),
            session_id: sessionID,
            observations: result.observations,
            message_tokens: tok,
            observation_tokens: result.observations.length >> 2,
            starts_at: boundary,
            ends_at: Date.now(),
            time_created: Date.now(),
            time_updated: Date.now(),
          })
        }
      } catch (err) {
        log.error("background observer failed", { err })
      } finally {
        OMBuf.setObserving(false)
        OMBuf.clearInFlight(sessionID)
      }
    })()
    OMBuf.setInFlight(sessionID, p)
  }
}
```

Key: the `if (!OMBuf.getInFlight(sessionID))` guard satisfies REQ-1.3 (duplicate prevention). The promise self-clears in `finally`.

**`"activate"` branch** — await background + condense:

```ts
if (sig === "activate") {
  yield *
    Effect.promise(async () => {
      await OMBuf.awaitInFlight(sessionID)
      OMBuf.setObserving(true)
      try {
        await OM.activate(sessionID)
        const fresh = OM.get(sessionID)
        if (fresh && (fresh.observation_tokens ?? 0) > Reflector.threshold) {
          OMBuf.setReflecting(true)
          try {
            await Reflector.run(sessionID)
          } finally {
            OMBuf.setReflecting(false)
          }
        }
      } finally {
        OMBuf.setObserving(false)
      }
    }).pipe(Effect.ignore, Effect.forkIn(scope))
}
```

`OM.activate()` already handles: read buffers → condense via `Observer.condense()` → upsert main record → delete buffer rows.

**`"force"` branch** — unchanged (synchronous `Observer.run` → `OM.upsert`).

**Session cleanup** — add to the existing `Effect.addFinalizer` at line ~129:

```ts
yield *
  Effect.addFinalizer(
    Effect.fnUntraced(function* () {
      yield* Effect.promise(() => OMBuf.awaitInFlight(sessionID))
      // ... existing runner cleanup ...
    }),
  )
```

This satisfies REQ-1.6: no in-flight observation is lost on session dispose.

### 2.3 Sequence Diagram

```
Turn N (tok crosses INTERVAL boundary → sig="buffer")
  │
  ├─ OMBuf.getInFlight(sid)?  ──── exists → skip (no duplicate)
  │                                  │
  │                           doesn't exist
  │                                  │
  ├─ Spawn async promise ───────────►┐
  │  OMBuf.setInFlight(sid, p)       │  Observer.run() [background LLM]
  │                                  │
  ├─ Loop continues immediately      │  ... LLM working ...
  │  (user sees no delay)            │
  │                                  │  OM.addBuffer(result)
  │                                  │  OMBuf.clearInFlight(sid)
  │                                  ▼
  │
Turn N+M (tok crosses TRIGGER → sig="activate")
  │
  ├─ OMBuf.awaitInFlight(sid) ──── waits if still running (usually done)
  │
  ├─ OM.activate(sid)
  │    ├─ Read ObservationBufferTable rows
  │    ├─ Observer.condense(chunks, prev)
  │    ├─ Upsert ObservationTable
  │    └─ Delete ObservationBufferTable rows
  │
  ├─ Check Reflector.threshold → maybe Reflector.run()
  │
  └─ Done (observations consolidated)
```

---

## 3. Phase 1B — Compression Start Level

### Design

```ts
// reflector.ts — exported for testability (REQ-2.4)
export function startLevel(id: string): CompressionLevel {
  if (id.includes("gemini-2.5-flash")) return 2
  return 1
}
```

Integration into `Reflector.run()`:

```ts
// Current (line 123):
let level: CompressionLevel = 0

// New:
let level = startLevel(model.api.id ?? "") as CompressionLevel
```

Where `model` is already resolved at line ~110 via `Provider.getModel()`. The model object's `api.id` field contains the provider-qualified model ID string (e.g. `"gemini-2.5-flash-preview-04-17"`).

The while loop `while (level <= 4)` remains unchanged. The cast `as CompressionLevel` is safe because `startLevel` returns `1 | 2`, both valid `CompressionLevel` values, and incrementing within the loop uses the existing `(level + 1) as CompressionLevel` pattern.

Level 0 (`COMPRESSION_GUIDANCE[0] = ""`) remains in the record for completeness but is no longer reachable in production — acceptable per exploration analysis.

---

## 4. Phase 2 — Observer Prompt Richness

### Full New `PROMPT` Constant

```ts
const PROMPT = `You are an observation agent. Extract facts from the conversation below as a structured observation log.

## Assertion vs Question

- 🔴 User assertions (FACTS the user stated): "I work at Acme", "the app uses PostgreSQL", "I switched to Svelte"
  - These are AUTHORITATIVE — the user is the source of truth about their own context
- 🟡 User requests/questions (what they asked for, NOT facts): "Can you help me...", "What's the best way to..."
  - Only record these if they reveal intent or preference

## State Changes

When a user indicates a change from X to Y, frame it explicitly:
- "User will use Svelte (replacing React)"
- "User now works at NewCo (previously OldCo)"
- Mark the old value superseded: "~old fact~ → new fact"

## Temporal Anchoring

- Resolve relative dates to absolute (e.g. "yesterday" → 2026-04-03, "next week" → 2026-04-11)
- When a single message contains MULTIPLE events at different times, split into SEPARATE observation lines, each with its own date
  - Example: "I visited Paris last week and I'm going to London tomorrow" → two separate lines with two dates
- Include timestamps (HH:MM) when messages carry them

## Precise Action Verbs

Replace vague verbs with specific ones:
- "getting" something regularly → "subscribes to" / "receives regularly"
- "got" something → "purchased" / "received" / "was given" (choose based on context)
- "has" → "owns" / "maintains" / "is responsible for" (choose based on context)
- "uses" → "develops with" / "relies on" / "chose" (prefer the most specific)
- "doing" → "building" / "debugging" / "migrating" / "deploying" (match the actual activity)

## Detail Preservation

- Lists, names, @handles, URLs, numerical values, quantities, and identifiers MUST be preserved verbatim — never generalize
  - BAD: "User tried several hotels" → GOOD: "User compared Hotel Marais (€180/night, 4-star) and Hotel Latin (€150/night, 3-star)"
  - BAD: "User uses some libraries" → GOOD: "User uses Effect, Drizzle, and Vercel AI SDK"
- Preserve unusual phrasing or specific terminology the user employs — it may carry domain meaning

## General Rules

- Skip: routine tool calls, file reads, assistant acknowledgements, filler
- Keep bullets concise — one fact per bullet
- When in doubt about whether something is a fact, KEEP IT

## Output Format

<observations>
Date: [resolved date]
* 🔴 HH:MM [user assertion — specific, with preserved details]
* 🟡 HH:MM [user request — only if it reveals intent]
</observations>

<current-task>
State what the agent is currently working on (1-2 sentences).
</current-task>

<suggested-response>
Hint for the agent's next message to continue naturally (1 sentence).
</suggested-response>`
```

This preserves the existing XML output format (REQ-3.5) and all existing markers (🔴, 🟡). New sections: State Changes, Temporal Anchoring with event splitting, Precise Action Verbs mapping, Detail Preservation.

The `CONDENSE_PROMPT` is unchanged — it already handles merging correctly.

---

## 5. Phase 3 — Observer Context Truncation

### 5.1 `truncateObsToBudget` Algorithm

```ts
export function truncateObsToBudget(obs: string, budget: number): string {
  if (budget === 0) return ""
  const total = obs.length >> 2
  if (total <= budget) return obs

  const lines = obs.split("\n")
  const n = lines.length

  // Per-line token estimates
  const tok = lines.map((l) => l.length >> 2)

  // Suffix-sum: suffix[i] = sum of tok[i..n-1]
  const suffix = new Array<number>(n + 1)
  suffix[n] = 0
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + tok[i]!

  // Find largest tail that fits in budget
  // Binary condition: suffix[i] <= budget → find smallest i where this holds
  let tail = n // start index of tail slice
  for (let i = n - 1; i >= 0; i--) {
    if (suffix[i]! <= budget) tail = i
    else break
  }

  // Remaining budget for important head lines
  const tailCost = suffix[tail]!
  let remaining = budget - tailCost

  // Collect important lines (🔴, ✅) from head (before tail)
  const head: string[] = []
  for (let i = 0; i < tail; i++) {
    if (remaining <= 0) break
    if (lines[i]!.includes("🔴") || lines[i]!.includes("✅")) {
      if (tok[i]! <= remaining) {
        head.push(lines[i]!)
        remaining -= tok[i]!
      }
    }
  }

  const skipped = tail - head.length
  const parts: string[] = []
  if (head.length) parts.push(head.join("\n"))
  if (skipped > 0) parts.push(`[${skipped} observations truncated here]`)
  parts.push(lines.slice(tail).join("\n"))

  return parts.join("\n")
}
```

Data structures: `tok[]` (per-line tokens), `suffix[]` (suffix-sum for O(1) tail cost lookup). Total complexity: O(n) where n = line count.

### 5.2 Integration into `Observer.run()`

```ts
// observer.ts — inside run(), replace lines 167-168:
let system = PROMPT
if (input.prev) {
  const cfg = await Config.get()
  const budget = cfg.experimental?.observer_prev_tokens
  const trimmed = budget === false ? input.prev : truncateObsToBudget(input.prev, budget ?? 2000)
  if (trimmed) system += `\n\n## Previous Observations (for context, do not duplicate)\n${trimmed}`
}
```

When `budget` is `false`, truncation is disabled (legacy behavior). When omitted, defaults to 2000.

### 5.3 Config Schema Addition

In `config.ts` (inside the `experimental` object, after `observer_message_tokens`):

```ts
observer_prev_tokens: z
  .union([z.number().int().positive(), z.literal(false)])
  .optional()
  .describe(
    "Token budget for previous observations passed to Observer. Default 2000. false = disabled.",
  ),
```

---

## 6. Cross-cutting Concerns

### Error Handling

| Component                              | Failure mode                                 | Behavior                                                                                                     |
| -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Background Observer LLM (`"buffer"`)   | `Observer.run()` throws or returns undefined | Logged, `clearInFlight` in `finally`, buffer row not written, activate will work with whatever buffers exist |
| `OM.activate()` condense LLM           | `Observer.condense()` fails                  | Falls back to naive `chunks.join()` (existing behavior in `condense()`)                                      |
| `OMBuf.awaitInFlight()` at session end | Promise already resolved                     | No-op (delete on missing key is safe)                                                                        |
| `truncateObsToBudget`                  | Empty string input                           | Returns `""` (0 >> 2 = 0 ≤ any budget)                                                                       |

### Cleanup

- `OMBuf.reset(sid)` already deletes state entries — add `inFlight.delete(sid)` to it for completeness.
- Session-scoped `addFinalizer` calls `awaitInFlight` before runner teardown.

### Testing Hooks

| Function                                                    | Testable                     | How                                                    |
| ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| `startLevel(modelId)`                                       | Pure, exported               | Direct unit test with model ID strings                 |
| `truncateObsToBudget(obs, budget)`                          | Pure, exported               | Unit test with various observation strings and budgets |
| `OMBuf.setInFlight/getInFlight/clearInFlight/awaitInFlight` | Stateful but synchronous map | Test map lifecycle in isolation                        |
| `detectDegenerateRepetition`                                | Pure, already exported       | Existing                                               |
| `parseObserverOutput`                                       | Pure, already exported       | Existing                                               |

---

## 7. Architecture Decision Log

### ADR-1: inFlight Map Location

**Choice**: `buffer.ts` (co-located with `OMBuf` namespace)
**Alternatives**: `record.ts` (persistence layer), `prompt.ts` (orchestrator)
**Rationale**: The in-flight map is coordination state for the buffering state machine. It belongs with `OMBuf`, not with DB operations or orchestration. This keeps `record.ts` purely about persistence and `prompt.ts` purely about orchestration flow.

### ADR-2: Plain Promise vs Effect Fiber

**Choice**: `Promise<void>` stored in a `Map`
**Alternatives**: `Effect.Fiber` via `Effect.forkScoped`
**Rationale**: The background Observer call is an async JS function (`Observer.run()`), not an Effect. Wrapping it in `Effect.promise` then extracting the fiber adds complexity for no benefit. A raw promise is simpler, debuggable, and matches the existing fire-and-forget patterns in `prompt.ts`.

### ADR-3: Compression Level 0 Unreachable

**Choice**: `startLevel` returns minimum 1, making `COMPRESSION_GUIDANCE[0]` dead code
**Alternatives**: Remove level 0 from the record, renumber levels
**Rationale**: Keeping level 0 in the `COMPRESSION_GUIDANCE` record maintains backward compatibility and makes the intent clear (level 0 = "no guidance"). Renumbering would be a noisy diff for no functional benefit.

### ADR-4: Token Estimation via char>>2

**Choice**: Continue using `char >> 2` throughout (buffer, observer, reflector, truncation)
**Alternatives**: `tiktoken`, model-specific tokenizers
**Rationale**: Consistency with codebase convention. The estimate is used for thresholds and budgets, not billing — 25% accuracy is sufficient. Adding a tokenizer dependency would slow down the hot path.

## File Changes

| File                                            | Action | Description                                                            |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `packages/opencode/src/session/om/buffer.ts`    | Modify | Add `inFlight` map + 4 accessor methods to `OMBuf` namespace           |
| `packages/opencode/src/session/om/observer.ts`  | Modify | Replace `PROMPT` constant, add `truncateObsToBudget` export            |
| `packages/opencode/src/session/om/reflector.ts` | Modify | Add exported `startLevel()`, use it as loop initial value              |
| `packages/opencode/src/session/prompt.ts`       | Modify | Split buffer/activate branches, add `awaitInFlight` to session cleanup |
| `packages/opencode/src/config/config.ts`        | Modify | Add `observer_prev_tokens` to experimental schema                      |

## Migration / Rollout

No migration required. All changes are additive. The `ObservationBufferTable` schema already exists. Setting `experimental.observer: false` disables the entire OM system (existing kill switch).

## Open Questions

None — all technical decisions are resolved.
