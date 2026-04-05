# Design: Observational Memory Quality — 6 Gaps

## Technical Approach

All 6 gaps close by modifying existing files in `src/session/om/` and `src/session/system.ts`. No new modules. Changes layer bottom-up: (1) DB schema + types, (2) degenerate detection utility, (3) Observer structured output, (4) Reflector retry loop, (5) context instructions injection, (6) adaptive thresholds.

## Architecture Decisions

### Decision: Observer returns `ObserverResult` struct, not plain string

**Choice**: Change `Observer.run()` return type from `Promise<string | undefined>` to `Promise<ObserverResult | undefined>` where `ObserverResult = { observations: string; currentTask?: string; suggestedContinuation?: string }`  
**Impact**: TWO call sites in `prompt.ts` must be updated — lines 1518–1554 (buffer/activate path) and 1556–1593 (force path). Both have identical structure. Both do `const obs = await Observer.run(...)` then `if (obs) OM.upsert(...)`. After the change, they destructure `obs.observations` for the upsert and additionally write `obs.currentTask` + `obs.suggestedContinuation`.  
**Rationale**: Returning a struct is the only way to thread `currentTask` and `suggestedContinuation` out without a second LLM call or global state.

### Decision: XML with fallback to plain text

**Choice**: Adopt `<observations>`, `<current-task>`, `<suggested-response>` XML format in Observer prompt; parse with regex; fall back to full-text when `<observations>` tag absent  
**Rationale**: XML tags tolerate LLM whitespace variation. Fallback preserves 100% backwards compatibility — existing sessions with stored observations are unaffected.

### Decision: `currentTask` and `suggestedContinuation` as nullable columns on `ObservationTable`

**Choice**: Add `current_task text` and `suggested_continuation text` nullable columns to `ObservationTable` in `session.sql.ts`  
**Migration**: `bun run db generate --name om-quality-columns` (command: `bun db generate --name om-quality-columns` per `package.json:23`). Existing rows get `NULL` — no data loss, old code still reads the table fine.  
**Rationale**: Already one row per session. Nullable = zero migration risk. In-memory would be lost on restart.

### Decision: `validateCompression` uses `text.length >> 2` for token counting, not provider usage

**Choice**: Token count estimated via `text.length >> 2` (same heuristic as rest of codebase)  
**Rationale**: `generateText` result has `result.usage?.completionTokens` but that field is provider-dependent and often undefined. The whole codebase uses `length >> 2` consistently. Mixing would create inconsistent thresholds.

### Decision: `OMBuf.check()` receives `obsTokens` as optional param for adaptive threshold

**Choice**: Add optional `obsTokens?: number` parameter to `OMBuf.check(sid, tok, obsTokens?)`. When `ThresholdRange` is configured AND `obsTokens` is provided, use `calculateDynamicThreshold`. When absent, fall back to fixed constants.  
**Impact**: Call site in `prompt.ts:1517` changes from `OMBuf.check(sessionID, tok)` to `OMBuf.check(sessionID, tok, OM.get(sessionID)?.observation_tokens)`. `OM.get()` is synchronous (SQLite), so no async concern.  
**Rationale**: `buffer.ts` is a pure state module with no DB imports. Passing `obsTokens` from the call site keeps the module boundary clean.

### Decision: `suggestedContinuation` injected in `wrapObservations()`, not in `llm.ts`

**Choice**: `SystemPrompt.wrapObservations(body, suggestedContinuation?)` appends the `<system-reminder>` block when `suggestedContinuation` is present. `SystemPrompt.observations(sid)` reads `rec.suggested_continuation` and passes it down.  
**No collision**: Three existing uses of `<system-reminder>` in `prompt.ts` are: (a) plan mode in a message Part text, (b) user message wrapping in step > 1. The continuation hint goes into `system[2]` as a system message — different position in the prompt, different semantic context. No structural collision.  
**Token cap**: `wrapObservations` currently applies `capRecallBody(body)` to the observations content only. The `OBSERVATION_CONTEXT_INSTRUCTIONS` and `<system-reminder>` are appended AFTER the cap — they are not truncated.

## Data Flow

```
Observer cycle (buffer / activate / force signal in prompt.ts):
  OMBuf.check(sessionID, tok, OM.get(sessionID)?.observation_tokens)
    → signal ∈ {buffer, activate, force}
    → rec = OM.get(sessionID)
    → Observer.run({ sid, msgs: unobserved, prev: rec?.observations, priorCurrentTask: rec?.current_task })
         → buildObserverPrompt(prev, msgs, { priorCurrentTask })
         → generateText → raw output
         → detectDegenerateRepetition(raw) → return undefined if true (log warn)
         → parseObserverOutput(raw) → { observations, currentTask, suggestedContinuation }
    → if result: OM.upsert({ ...existing, observations, current_task, suggested_continuation, ... })
    → if observation_tokens > THRESHOLD: Reflector.run(sid)

Reflector cycle (called from same block, after upsert):
  rec = OM.get(sid)                  // fresh read after upsert
  best = undefined, level = 0
  loop level 0..4:
    raw = generateText(REFLECTOR_PROMPT + COMPRESSION_GUIDANCE[level], rec.observations)
    if detectDegenerateRepetition(raw): level++; continue
    tokens = raw.length >> 2
    if validateCompression(tokens, THRESHOLD): OM.reflect(sid, raw); return
    if best === undefined || tokens < best.tokens: best = { text: raw, tokens }
    level++
  OM.reflect(sid, best.text)    // best effort after exhausting retries

system[2] assembly (SystemPrompt.observations, every turn):
  rec = OM.get(sid)
  body = rec.reflections ?? rec.observations
  → wrapObservations(body, rec.suggested_continuation)
       → `<local-observations>\n${capRecallBody(body)}\n</local-observations>
          \n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}
          \n\n${hint ? `<system-reminder>\n${hint}\n</system-reminder>` : ''}`
```

## File Changes

| File                             | Action | Description                                                                                                                                                                                               |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session/session.sql.ts`     | Modify | Add `current_task text` + `suggested_continuation text` nullable to `ObservationTable`                                                                                                                    |
| `src/session/om/observer.ts`     | Modify | `ObserverResult` interface; `parseObserverOutput()`; `detectDegenerateRepetition()`; updated `PROMPT` for XML output; `Observer.run()` returns `ObserverResult \| undefined`; accepts `priorCurrentTask?` |
| `src/session/om/reflector.ts`    | Modify | `COMPRESSION_GUIDANCE[0..4]`; `validateCompression()`; retry loop in `Reflector.run()`; degenerate check                                                                                                  |
| `src/session/om/buffer.ts`       | Modify | `ThresholdRange` type; `calculateDynamicThreshold()`; `OMBuf.check()` adds optional `obsTokens?` param                                                                                                    |
| `src/session/system.ts`          | Modify | `OBSERVATION_CONTEXT_INSTRUCTIONS` constant; `OBSERVATION_CONTINUATION_HINT` constant; `wrapObservations(body, hint?)` signature; `observations(sid)` reads `suggested_continuation`                      |
| `src/session/om/record.ts`       | Modify | `OM.upsert()` accepts `current_task` + `suggested_continuation` fields                                                                                                                                    |
| `src/session/prompt.ts`          | Modify | **Both** observer call sites (lines ~1525 and ~1563): destructure `ObserverResult`, write new fields; pass `obsTokens` to `OMBuf.check()`                                                                 |
| `src/config/config.ts`           | Modify | `observer_message_tokens?: number \| ThresholdRange` in experimental block                                                                                                                                |
| `test/session/observer.test.ts`  | Modify | XML parsing, fallback, degenerate detection, `currentTask` round-trip                                                                                                                                     |
| `test/session/system.test.ts`    | Modify | Context instructions present in output, continuation hint injection                                                                                                                                       |
| `test/session/reflector.test.ts` | Create | Compression retry loop, `validateCompression`, degenerate discard, best-result tracking                                                                                                                   |
| `test/session/buffer.test.ts`    | Create | `calculateDynamicThreshold` — range, fixed, floor cases                                                                                                                                                   |

## Interfaces / Contracts

```ts
// om/observer.ts — new exports
export interface ObserverResult {
  observations: string
  currentTask?: string
  suggestedContinuation?: string
}
export function detectDegenerateRepetition(text: string): boolean
export function parseObserverOutput(raw: string): ObserverResult
// Observer.run() now returns Promise<ObserverResult | undefined>  (was Promise<string | undefined>)

// om/buffer.ts — new exports + updated signature
export type ThresholdRange = { min: number; max: number }
export function calculateDynamicThreshold(threshold: number | ThresholdRange, obsTokens: number): number
// OMBuf.check(sid, tok, obsTokens?) — obsTokens optional, no breaking change

// om/reflector.ts — internal helpers only
function validateCompression(outputTokens: number, target: number): boolean // outputTokens = text.length >> 2
type CompressionLevel = 0 | 1 | 2 | 3 | 4
const COMPRESSION_GUIDANCE: Record<CompressionLevel, string>

// session.sql.ts — new nullable columns on ObservationTable
current_task: text().nullable()
suggested_continuation: text().nullable()

// system.ts — updated signatures
export const OBSERVATION_CONTEXT_INSTRUCTIONS: string
export const OBSERVATION_CONTINUATION_HINT: string
export function wrapObservations(body: string, hint?: string): string // hint = suggestedContinuation
// observations(sid) reads rec.suggested_continuation and passes to wrapObservations
```

## Testing Strategy

| Layer       | What to Test                                                                       | Approach                                        |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| Unit        | `parseObserverOutput` — with XML, without XML, partial XML                         | Fixture strings, no LLM                         |
| Unit        | `detectDegenerateRepetition` — short/normal/degenerate                             | Pure function                                   |
| Unit        | `validateCompression` — above/below threshold                                      | Pure function                                   |
| Unit        | `calculateDynamicThreshold` — range, fixed, floor                                  | Pure function                                   |
| Unit        | `wrapObservations(body, hint)` — instructions present, hint present/absent         | String assertion                                |
| Integration | `currentTask` round-trip via `OM.upsert` → `OM.get` → next Observer prompt         | Real DB (in-memory SQLite), mock `generateText` |
| Integration | Reflector retry: mock `generateText` returns oversized output × N, then compressed | Mock `generateText`, real `validateCompression` |

## Migration / Rollout

DB migration required. Command: `bun db generate --name om-quality-columns` from `packages/opencode`. Output goes to `migration/<timestamp>_om-quality-columns/migration.sql`. Columns nullable — zero impact on existing data or old code paths.

## Open Questions

None — all decisions verified against the actual source files.
