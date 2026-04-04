# Design: Observational Memory Observer (Phase 2)

## Technical Approach

Background Observer agent fires at 30k unobserved tokens via `Effect.forkIn(scope)` in `runLoop`, compresses message history into fact-level observations stored in `session_observation`, and injects them at `system[2]` (5min cache). Pre-buffers at 6k intervals; force-syncs at 36k. Follows `runCompactionLLM` pattern for LLM calls. AutoDream reads observations for Engram consolidation.

## Architecture Decisions

| Decision                        | Choice                                                                      | Alternatives                            | Rationale                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect vs plain async for `om/` | Plain async namespace (like AutoDream)                                      | Effect.Service (like SessionCompaction) | Observer fires FROM Effect context via `Effect.forkIn(scope)` wrapping `Effect.promise(() => Observer.run(...))`. No need for layers/typed errors — the fork is fire-and-forget with `Effect.ignore`. Matches AutoDream's pattern; keeps `om/` simple and testable with plain functions.                                          |
| Observation injection slot      | `system[2]` via `input.observations` on `LLM.StreamInput`                   | Merge into recall at `system[1]`        | Keeps Phase 1 recall and Phase 2 observations decoupled. `applyCaching` (transform.ts:237-255) only places BP on `system[0]` (BP2 1h) and `system[1]` (BP3 5min). New `system[2]` gets no explicit breakpoint but sits between `system[1]` (cached) and volatile `system[3]` (uncached). Safe — verified in transform.ts:240-245. |
| Token trigger source            | `lastFinished.tokens.input + lastFinished.tokens.output` (exact API counts) | `Token.estimate()` (char/4)             | Actual counts from processor.ts:283-285 are already available in `runLoop` via `lastFinished.tokens`. More accurate than char/4 estimation.                                                                                                                                                                                       |
| Config location                 | `experimental.observer` (bool) + `experimental.observer_model` (string)     | `agent.observer` as full Agent          | Matches existing `experimental.autodream` / `experimental.autodream_model` pattern (config.ts:1044-1048). Observer is experimental; full Agent config is overkill for a background summarizer.                                                                                                                                    |
| Observer model default          | `google/gemini-2.5-flash`                                                   | Same model as session                   | Low cost, 1M context, fast. Observer fires frequently (every 6k tokens); using the session model would be expensive.                                                                                                                                                                                                              |
| Per-session state tracking      | Module-level `Map<SessionID, State>` in `om/buffer.ts`                      | InstanceState (ScopedCache)             | Observer state is per-session, not per-directory. InstanceState is keyed by directory. A simple `Map` with cleanup on session end (via existing scope lifetime) is correct.                                                                                                                                                       |

## Data Flow

```
runLoop (prompt.ts)
  │
  ├─ step >= 1: accumulate lastFinished.tokens into session map
  │
  ├─ tokens >= 6k?  ──YES──►  Effect.forkIn(scope):
  │                              Observer.buffer(sid, msgs since last_observed_at)
  │                              └─► INSERT session_observation_buffer row
  │
  ├─ tokens >= 30k? ──YES──►  Effect.forkIn(scope):
  │                              Observer.activate(sid)
  │                              ├─► Read all buffer rows for sid
  │                              ├─► LLM call: compress into observations
  │                              ├─► UPSERT session_observation (append)
  │                              ├─► DELETE consumed buffer rows
  │                              └─► UPDATE last_observed_at
  │
  ├─ tokens >= 36k? ──YES──►  BLOCKING Observer.activate(sid)
  │                              (same as above, but awaited)
  │
  └─► handle.process({ ..., observations })
        │
        └─► llm.ts: system.splice(2, 0, input.observations)
              │
              └─► system = [agent(BP2), recall(BP3), observations, volatile]
                                                        │
AutoDream.idle(sid)                                     │
  └─► summaries(sid) reads:                             │
        1. ObservationTable.observations (dense, preferred)
        2. summary===true messages (sparse, fallback)
        3. last 10 messages (ultra-fallback)
```

## Component Details

### C1: DB Schema (`session/session.sql.ts`)

```typescript
export const ObservationTable = sqliteTable(
  "session_observation",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    observations: text(), // active observation markdown
    reflections: text(), // reserved for Phase 3 Reflector
    last_observed_at: integer(), // timestamp boundary
    generation_count: integer()
      .notNull()
      .$default(() => 0),
    observation_tokens: integer()
      .notNull()
      .$default(() => 0),
    ...Timestamps,
  },
  (table) => [index("observation_session_idx").on(table.session_id)],
)

export const ObservationBufferTable = sqliteTable(
  "session_observation_buffer",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    observations: text().notNull(),
    message_tokens: integer().notNull(),
    observation_tokens: integer().notNull(),
    starts_at: integer().notNull(),
    ends_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [index("obs_buffer_session_idx").on(table.session_id)],
)
```

Migration: `bun run db generate --name add_observation_tables` from `packages/opencode`.

### C2: `session/om/record.ts` — CRUD

Plain async namespace. All functions take single-word params.

```typescript
export namespace Record {
  // Returns observation row for session, or undefined
  async function get(sid: SessionID): Promise<Row | undefined>

  // Upsert observation row (one per session)
  async function upsert(rec: { sid: SessionID; observations: string; tokens: number; boundary: number }): Promise<void>

  // Get all buffer rows for session, ordered by starts_at
  async function buffers(sid: SessionID): Promise<BufferRow[]>

  // Insert one buffer chunk
  async function addBuffer(buf: {
    sid: SessionID
    observations: string
    msg_tokens: number
    obs_tokens: number
    starts: number
    ends: number
  }): Promise<void>

  // Delete consumed buffer rows by IDs
  async function clearBuffers(ids: string[]): Promise<void>
}
```

Uses `Instance.database` (Drizzle) directly — same pattern as `Session.messages()` in dream/index.ts:68.

### C3: `session/om/observer.ts` — LLM Call

Follows `runCompactionLLM` shape (compaction.ts:216-265) but simpler — no processor, direct `streamText` call.

```typescript
export namespace Observer {
  // System prompt instructs the model to:
  // - Extract factual observations from messages
  // - Mark user assertions 🔴, questions/preferences 🟡
  // - Resolve relative dates against current timestamp
  // - Detect state changes (user changed their mind, corrected earlier info)
  // - Output: markdown observation log

  async function run(input: {
    sid: SessionID
    msgs: MessageV2.WithParts[] // unobserved messages
    prior?: string // existing observations for context
    model: string // "provider/model" format
  }): Promise<{ observations: string; tokens: number }>
}
```

Model resolution: parse `experimental.observer_model` via `Provider.parseModel()` → `Provider.getLanguage()`. Same path as AutoDream (dream/index.ts:119-121).

### C4: `session/om/buffer.ts` — State Machine

```
Module-level state: Map<SessionID, { tokens: number, pending: boolean }>

States:
  idle        →  tokens < 6k, no action
  buffering   →  tokens >= 6k, fork Observer.buffer() (non-blocking)
  buffered    →  buffer row written, reset token counter
  activation  →  tokens >= 30k, fork Observer.activate() (non-blocking)
  force_sync  →  tokens >= 36k, AWAIT Observer.activate() (blocking)
```

```typescript
export namespace Buffer {
  // Called from runLoop after each assistant response
  // Returns Effect to fork (or undefined for no-op)
  function check(input: {
    sid: SessionID
    tokens: { input: number; output: number } // from lastFinished.tokens
    msgs: MessageV2.WithParts[]
    cfg: Config.Info
  }): Effect.Effect<void> | undefined

  // Pre-compute buffer chunk (background fiber)
  async function buffer(sid: SessionID, msgs: MessageV2.WithParts[]): Promise<void>

  // Activate: merge buffers → LLM → upsert observation (background fiber)
  async function activate(sid: SessionID): Promise<void>

  // Cleanup session state (called when session ends / scope closes)
  function clear(sid: SessionID): void
}
```

**Hook in runLoop** (prompt.ts, after line 1703, before `handle.process`):

```typescript
// Observer check — after recall loaded, before LLM call
const obs = Buffer.check({ sid: sessionID, tokens: lastFinished?.tokens, msgs, cfg })
if (obs) yield * obs.pipe(Effect.ignore, Effect.forkIn(scope))

// Load observations for injection
const observations = yield * Effect.promise(() => Record.get(sessionID))
const obsText = observations?.observations ? SystemPrompt.wrapObservations(observations.observations) : undefined
```

### C5: Injection in `llm.ts` + `system.ts`

**`LLM.StreamInput`** — add field (llm.ts:39):

```typescript
observations?: string  // local observation context for system[2]
```

**`llm.ts` stream function** — after line 131:

```typescript
if (input.recall) system.splice(1, 0, input.recall)
if (input.observations) system.splice(input.recall ? 2 : 1, 0, input.observations)
// volatile always last
system.push(SystemPrompt.volatile(input.model))
```

Final layout:

- `system[0]` = agent prompt (BP2, 1h)
- `system[1]` = recall (BP3, 5min) — Phase 1
- `system[2]` = observations (no explicit BP, rides on BP3 prefix) — Phase 2
- `system[3]` = volatile (uncached)

**`system.ts`** — add helper:

```typescript
export function wrapObservations(body: string): string {
  return `<session-observations>\n${capRecallBody(body)}\n</session-observations>`
}
```

**`applyCaching` impact**: SAFE. transform.ts:240-245 filters `role === "system"` messages and only marks `system[0]` (BP2) and `system[1]` (BP3). A 3rd or 4th system message gets no breakpoint — which is exactly right (observations change often, shouldn't be cached aggressively). The 2-part rejoin logic in llm.ts:125-128 fires BEFORE recall/observations splice, so it doesn't collapse them.

### C6: AutoDream Extension (`dream/index.ts`)

Modify `summaries(sid)` to read observations first:

```typescript
export async function summaries(sid: string): Promise<string> {
  // Priority 1: local observations (dense, high-quality)
  const rec = await Record.get(sid as SessionID)
  if (rec?.observations) {
    const est = Token.estimate(rec.observations)
    if (est <= 4000) return rec.observations
    return rec.observations.slice(0, 4000 * 4) // cap at ~4k tokens
  }

  // Priority 2: compaction summaries (existing logic)
  // ... existing code unchanged ...
}
```

## Sequence Diagram — Full Turn with Observer

```
User msg arrives
    │
    ▼
runLoop step N
    │
    ├─ load msgs, find lastFinished (has .tokens)
    │
    ├─ Buffer.check(sid, tokens, msgs, cfg)
    │   ├─ accumulate: state.tokens += input + output
    │   ├─ >= 36k? → return blocking activate Effect
    │   ├─ >= 30k? → return fork activate Effect
    │   ├─ >= 6k?  → return fork buffer Effect
    │   └─ < 6k?   → return undefined (no-op)
    │
    ├─ if obs: yield* obs.pipe(Effect.ignore, Effect.forkIn(scope))
    │   └─ background fiber runs Observer LLM (does NOT block main loop)
    │      EXCEPT at 36k where we await (force-sync)
    │
    ├─ Record.get(sid) → load current observations text
    │
    ├─ build system[]: env, skills, instructions, deferred
    │
    └─ handle.process({ system, recall, observations, ... })
         │
         └─ llm.ts: splice observations at system[2]
              │
              └─ streamText({ system: [agent, recall, obs, volatile], ... })
```

## File Changes

| File                                  | Action | Description                                                                  |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `src/session/session.sql.ts`          | Modify | Add `ObservationTable`, `ObservationBufferTable`                             |
| `src/session/om/record.ts`            | Create | CRUD for observation + buffer tables                                         |
| `src/session/om/observer.ts`          | Create | LLM call with observation extraction prompt                                  |
| `src/session/om/buffer.ts`            | Create | State machine, token accumulation, check/activate                            |
| `src/session/om/index.ts`             | Create | Re-export namespace                                                          |
| `src/session/prompt.ts`               | Modify | Hook `Buffer.check` + load observations before `handle.process` (~line 1703) |
| `src/session/llm.ts`                  | Modify | Add `observations?` to `StreamInput`, splice at system[2]                    |
| `src/session/system.ts`               | Modify | Add `wrapObservations()` helper                                              |
| `src/config/config.ts`                | Modify | Add `experimental.observer`, `experimental.observer_model`                   |
| `src/dream/index.ts`                  | Modify | Read `ObservationTable` first in `summaries()`                               |
| `migration/*_add_observation_tables/` | Create | Via `bun run db generate`                                                    |

## Testing Strategy

| Layer       | What                         | Approach                                                                                        |
| ----------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Unit        | `om/record.ts` CRUD          | Real DB via `Instance.provide` + `Session.create/remove` (pattern from summaries.test.ts:76-93) |
| Unit        | `om/buffer.ts` state machine | Test token accumulation thresholds, state transitions                                           |
| Integration | Observer trigger in runLoop  | Mock provider response with known token counts, verify observation row created                  |
| Integration | system[] injection           | Verify 4-segment layout doesn't break cache breakpoints                                         |

Test location: `packages/opencode/test/session/observer.test.ts`

## Migration / Rollout

1. Run `bun run db generate --name add_observation_tables` from `packages/opencode`
2. Tables auto-created on next app start (Drizzle push)
3. Feature gated behind `experimental.observer: true` (default: false)
4. Existing sessions: first `Buffer.check` auto-starts with `last_observed_at = 0` (observes all messages)

## Open Questions

- [x] `applyCaching` handles 4 segments: **verified** — only marks system[0] and system[1]
- [x] 2-part rejoin in llm.ts: **verified** — runs before splice, safe
- [ ] Observer prompt quality: needs iteration after initial implementation
- [ ] Should buffer chunks be capped in size? (currently unbounded per 6k interval)
