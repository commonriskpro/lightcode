# Design: Observational Memory Reflector

## Technical Approach

Add a background `Reflector` that condenses large `observations` into a tighter `reflections` string. When `observation_tokens > 40_000`, a single-pass LLM call produces the condensate. The existing `reflections` column (nullable, already in schema) stores the result. System injection (`system[2]`) switches to `reflections ?? observations` — a one-line fallback. Observer's raw log (`observations`) is never touched by the Reflector, preserving Observer continuity.

## Architecture Decisions

| Decision           | Choice                                         | Alternatives                    | Rationale                                                                         |
| ------------------ | ---------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| File placement     | New `session/om/reflector.ts`                  | Inline in `observer.ts`         | One-namespace-per-file convention; Reflector prompt is substantial                |
| Injection strategy | `reflections ?? observations`                  | Replace `observations` in-place | Observer.run reads `prev` from `observations`; overwriting breaks the input chain |
| Trigger location   | After `OM.upsert()` in activate/force branches | Separate Effect fiber           | Reuses existing control flow; threshold check is a single `if`                    |
| Blocking mode      | Fork in both activate and force                | Inline in force branch          | Reflections only need to be ready _next_ turn; no reason to block force path      |
| Model config       | Reuse `observer_model`                         | Add `reflector_model` key       | Same requirements (cheap, fast, large context); no config surface bloat           |
| Compression        | Single-pass                                    | Mastra multi-level (0-4)        | Sufficient for Phase 3; can add retry with escalating levels later                |
| DB write           | Targeted `UPDATE reflections` only             | Full `upsert`                   | Avoids clobbering `observations`, `observation_tokens`, `generation_count`        |

## Data Flow

```
                          prompt.ts turn loop
                                │
              OMBuf.check(sid, tok) → "activate" / "force"
                                │
                     ┌──────────▼──────────┐
                     │  Observer.run(msgs)  │
                     │  OM.upsert(rec)      │
                     └──────────┬──────────┘
                                │
                   observation_tokens > 40k?
                       no │         │ yes
                          │    ┌────▼────────────────┐
                          │    │ Effect.forkIn(scope) │
                          │    │  Reflector.run(sid)  │
                          │    └────┬────────────────┘
                          │         │
                          │    ┌────▼──────────────┐
                          │    │ OM.get(sid)        │
                          │    │ → read observations│
                          │    │ LLM condense call  │
                          │    │ OM.reflect(sid,txt)│
                          │    └───────────────────┘
                          │
              ┌───────────▼──────────────┐
              │ Next turn: system.ts     │
              │ observations(sid)        │
              │ → rec.reflections ?? obs │
              │ → wrapObservations(body) │
              │ → system[2]             │
              └─────────────────────────┘
```

Cache layout unchanged:

- `system[0]` — agent prompt (BP2, 1h) **NEVER TOUCH**
- `system[1]` — Engram recall (BP3, 5min)
- `system[2]` — observations/reflections (volatile, no breakpoint)
- `system[3]` — volatile context

## File Changes

| File                      | Action | Description                                                              |
| ------------------------- | ------ | ------------------------------------------------------------------------ |
| `session/om/reflector.ts` | Create | `Reflector` namespace: `THRESHOLD`, `PROMPT`, `run(sid)`                 |
| `session/om/record.ts`    | Modify | Add `OM.reflect(sid, txt)` — targeted UPDATE of `reflections` column     |
| `session/om/index.ts`     | Modify | Add `export { Reflector } from "./reflector"`                            |
| `session/system.ts`       | Modify | `observations()`: `const body = rec.reflections ?? rec.observations`     |
| `session/prompt.ts`       | Modify | After upsert in activate/force, check threshold and fork `Reflector.run` |

## Interfaces / Contracts

### `session/om/reflector.ts`

```typescript
export namespace Reflector {
  export const THRESHOLD = 40_000

  // Reads observations, calls LLM, writes reflections. Never throws.
  export async function run(sid: SessionID): Promise<void>
}
```

Internal flow of `run`:

1. `const rec = OM.get(sid)` — if no rec or no observations → return
2. `if ((rec.observation_tokens ?? 0) <= THRESHOLD)` → return
3. Resolve model via `Config.get()` → `observer_model` → `Provider.parseModel` → `Provider.getModel` → `Provider.getLanguage`
4. `generateText({ model, system: PROMPT, prompt: rec.observations })` — `.catch(() => undefined)`
5. If result: `OM.reflect(sid, result.text)`

### `OM.reflect` in `record.ts`

```typescript
export function reflect(sid: SessionID, txt: string): void
// UPDATE session_observation SET reflections = txt, time_updated = now
//   WHERE session_id = sid
```

### `prompt.ts` trigger (both branches, after upsert)

```typescript
const fresh = OM.get(sessionID)
if (fresh && (fresh.observation_tokens ?? 0) > Reflector.THRESHOLD) Reflector.run(sessionID) // fire-and-forget inside the already-forked promise
```

In the activate branch: `Reflector.run` executes inside the existing `Effect.promise` that's already forked — no extra fork needed.
In the force branch: same pattern — `Reflector.run` is `await`ed inside the `Effect.promise` since the force path already blocks.

### `system.ts` change (line 79-83)

```typescript
export async function observations(sid: SessionID): Promise<string | undefined> {
  const rec = OM.get(sid)
  if (!rec) return undefined
  const body = rec.reflections ?? rec.observations
  if (!body) return undefined
  return wrapObservations(body)
}
```

## Why `observations` is preserved

Observer.run receives `prev: rec?.observations` as context for extracting new observations. If the Reflector overwrote `observations`, subsequent Observer calls would receive condensed input instead of the full running log, causing drift and lost context. The dual-field design (`observations` = raw log for Observer input, `reflections` = condensed output for system injection) keeps both concerns independent.

## Testing Strategy

| Layer       | What                                              | Approach                                                                                          |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Unit        | `Reflector.THRESHOLD` constant                    | Assert value is 40_000                                                                            |
| Unit        | Reflector prompt construction                     | Verify PROMPT contains key directives (markers, precedence)                                       |
| Integration | `OM.reflect(sid, txt)`                            | Create session, call reflect, verify `OM.get(sid).reflections === txt` and observations untouched |
| Integration | `SystemPrompt.observations()` with reflections    | Set both fields, verify reflections returned                                                      |
| Integration | `SystemPrompt.observations()` without reflections | Set observations only, verify observations returned                                               |
| Integration | `SystemPrompt.observations()` with neither        | Verify `undefined` returned                                                                       |
| Integration | Threshold gate                                    | Set `observation_tokens` below/above 40k, verify Reflector fires only when above                  |

All tests follow `observer.test.ts` patterns: `bun:test`, `Instance.provide`, unique `Session.create`/`Session.remove` per test.

## Migration / Rollout

No migration required. The `reflections` column already exists in `ObservationTable` (nullable text, always `null` today). No schema changes, no feature flags. Rollback = revert 4 file changes.

## Open Questions

- None. All questions resolved in exploration phase.
