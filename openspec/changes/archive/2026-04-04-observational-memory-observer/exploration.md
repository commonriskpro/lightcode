# Exploration: observational-memory-observer (Phase 2)

> Change slug: `observational-memory-observer`  
> Date: 2026-04-04  
> Author: sdd-explore agent

---

## Exploration: Phase 2 — Proactive Observer

### Current State

Phase 1 delivered the **recall** path (Engram → system prompt injection). Phase 2 extends that with a
**proactive local Observer** that runs during a session and writes to a `ObservationTable` in the local SQLite DB.
The goal is Mastra-inspired observational memory: a background LLM agent that compresses message history into
fact-level observations before the context window fills up.

---

### 1. DB Schema and Migration Pattern

#### File: `packages/opencode/src/session/session.sql.ts` (lines 14–103)

#### File: `packages/opencode/src/storage/schema.sql.ts` (lines 1–10)

**Existing tables:** `session`, `message`, `part`, `todo`, `permission`. All use:

- `text().primaryKey()` / `text().$type<T>()` for branded IDs
- `Timestamps` mixin (`time_created`, `time_updated` as integers via `Date.now()`)
- `text({ mode: "json" }).$type<T>()` for JSON blobs
- snake_case column names, no explicit string labels

**Migration pattern:**

- Schema files: `src/**/*.sql.ts` (glob in `drizzle.config.ts` line 4)
- Output dir: `./migration` (drizzle.config.ts line 5)
- Command: `bun run db generate --name <slug>`
- Output structure: `migration/<timestamp>_<slug>/migration.sql` + `snapshot.json` (confirmed: migration/ has 10 folders, each with those two files)
- **No `_journal.json`** — tests read per-folder layout directly (AGENTS.md for packages/opencode)

**Proposed `ObservationTable` schema:**

Two new tables needed (one per arch doc `docs/mastra-om-arch.md` sections 5 and 7):

```typescript
// packages/opencode/src/session/session.sql.ts (new tables to add)

export const ObservationTable = sqliteTable(
  "session_observation",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    observations: text(), // markdown observation log (active tier)
    reflections: text(), // condensed log (tier-3, optional)
    last_observed_at: integer(), // timestamp boundary — messages before this are observed
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
    observations: text().notNull(), // buffered observation chunk
    message_tokens: integer().notNull(),
    observation_tokens: integer().notNull(),
    starts_at: integer().notNull(), // first message timestamp covered
    ends_at: integer().notNull(), // last message timestamp covered
    ...Timestamps,
  },
  (table) => [index("obs_buffer_session_idx").on(table.session_id)],
)
```

**Key decisions:**

- `session_observation` has one row per session (upserted, not appended)
- `session_observation_buffer` accumulates chunks between buffer intervals
- `last_observed_at` is the critical boundary: messages with `time_created < last_observed_at` are "observed" and excluded from model context
- Both tables use `session_id` FK with `onDelete: "cascade"` matching all existing tables
- Migration command: `bun run db generate --name add_observation_tables` (run from `packages/opencode`)

---

### 2. Compaction — Current Reactive System

#### File: `packages/opencode/src/session/compaction.ts` (558 lines, fully read)

**Trigger:** reactive overflow. In `prompt.ts` line 1536–1540:

```typescript
if (lastFinished && lastFinished.summary !== true &&
    (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))) {
  yield* compaction.create({ ... })
}
```

`isOverflow` (overflow.ts line 8): `count >= usable` where `usable = contextLimit - reservedBuffer`.
Default `COMPACTION_BUFFER = 20_000` (overflow.ts line 6). This means compaction fires only when the context window is nearly full.

**runCompactionLLM (compaction.ts lines 216–265):**

- Creates a `MessageV2.Assistant` with `mode: "compaction"`, `summary: true`
- Calls `processor.process()` with the conversation history + compaction prompt
- Uses the user message's model OR a configured `compaction` agent model (`config.agent.compaction`)
- Output is text content in the summary assistant message — NOT stored in a separate table

**Two compaction modes:**

1. **Cut-point** (preferred): `CutPoint.find()` identifies a boundary; old messages get summarized, recent ones kept verbatim (`cut-point.ts` line 13)
2. **Full replacement** (fallback): all messages summarized when cut-point can't save enough

**Summary message shape:** `MessageV2.Assistant` with `summary: true`, stored in `MessageTable.data`. The text content lives in associated `PartTable` rows of type `"text"`.

**Can Observer coexist with compaction?**
YES — they are orthogonal:

- **Compaction** = reactive fallback when context overflows (keeps running)
- **Observer** = proactive, fires at 30k tokens, removes observed messages from context load
- If Observer works correctly, compaction fires much less often (fewer messages in context)
- Compaction's `PRUNE_MINIMUM`/`PRUNE_PROTECT` (lines 36–37) can also coexist: pruning tool outputs is independent of observation

**Observer does NOT replace compaction** — it's a complementary layer that reduces how often compaction is needed.

---

### 3. Token Counting

#### File: `packages/opencode/src/util/token.ts` (7 lines)

```typescript
export function estimate(input: string) {
  return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN)) // CHARS_PER_TOKEN = 4
}
```

**Simple char/4 estimation.** No tiktoken, no per-provider logic. This is what `CutPoint.estimate()` also uses (cut-point.ts line 51: `Math.ceil(chars / 4)`).

**Per-message token counts:** `MessageV2.Assistant` has a `tokens` object (processor.ts lines 284–285 show it being accumulated):

```
tokens: { input: number, output: number, reasoning: number, cache: { read: number, write: number }, total?: number }
```

These are **actual API-reported token counts** for assistant messages. User messages don't have token counts stored.

**Overflow check** (overflow.ts line 14) uses: `tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write`. This is exact (from API).

**Realistic threshold for Observer trigger:**

- Anthropic Claude 3.7: 200k context window; PRUNE_PROTECT = 40k, COMPACTION_BUFFER = 20k
- Overflow fires at: ~contextLimit - 20k (so ~180k for Claude)
- Observer should fire MUCH earlier: 30k tokens is Mastra's default — appropriate since it's proactive
- For lightcodev2: a 30k threshold is sensible; it leaves ~150k+ buffer before compaction on large context models
- `Token.estimate()` is sufficient for the Observer trigger check (same precision as cut-point)

---

### 4. Effect Background Work Pattern

#### File: `packages/opencode/src/session/prompt.ts` lines 1457–1762

#### File: `packages/opencode/src/effect/instance-state.ts` (82 lines)

**runLoop** (prompt.ts line 1457):

- It's an Effect function that loops: loads messages, finds last user/assistant, runs the LLM
- Key integration point for Observer trigger: **right before `handle.process()` call** (line 1704) — this is where we know `currentTokens` and can fire the background Observer

**Background work pattern in this codebase:**

```typescript
// Pattern used in prompt.ts lines 1511, 1759:
yield * someEffect.pipe(Effect.ignore, Effect.forkIn(scope))
```

`scope` is captured at the top of `runLoop`. `Effect.forkIn(scope)` fires a background fiber scoped to the session loop — it gets interrupted when the session ends.

**`Effect.forkScoped`** is used in many places for long-lived background streams (bash.ts, snapshot/index.ts, plugin/index.ts, bus/index.ts). The preferred pattern for a periodic background task is:

```typescript
// From AGENTS.md for packages/opencode:
// "For background loops or scheduled tasks, use Effect.repeat or Effect.schedule
//  with Effect.forkScoped in the layer definition."
```

**InstanceState** (instance-state.ts):

- `ScopedCache` keyed by `Instance.directory` — per-project state
- `make()` closure: do work directly, `ScopedCache` handles run-once semantics
- `Effect.addFinalizer` / `Effect.acquireRelease` for cleanup
- `Effect.forkScoped` for background stream consumers — fiber interrupted on disposal

**Observer hook location options:**

| Option | Location                                                             | Pros                                          | Cons                                         |
| ------ | -------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| A      | `runLoop` before `handle.process()`                                  | Direct access to message list and token count | Adds to main loop; must be non-blocking      |
| B      | New `InstanceState` service with `Effect.forkScoped` background loop | Clean separation, survives across turns       | Needs session-level token accumulation state |
| C      | In `SessionProcessor` after each LLM response                        | Has actual token counts                       | Deep in processor internals                  |

**Recommendation: Option A with `Effect.forkIn(scope)`** — fire Observer as background fork, same pattern as title generation (line 1511) and compaction pruning (line 1759). Non-blocking, uses existing scope lifetime.

---

### 5. Mastra Observer Trigger Logic

From `docs/mastra-om-arch.md` (full arch doc exists at this path):

| Parameter           | Mastra Default  | Recommended for lightcodev2 |
| ------------------- | --------------- | --------------------------- |
| `messageTokens`     | 30,000          | 30,000 (keep same)          |
| `bufferTokens`      | 20% of 30k = 6k | 6,000                       |
| `blockAfter`        | 1.2× = 36k      | 36,000                      |
| `observationTokens` | 40,000          | 40,000                      |

**Context window reality:**

- Claude Sonnet: 200k context — overflow fires at ~180k, Observer at 30k: **lots of headroom**
- Gemini Flash: 1M context — compaction almost never fires, Observer becomes even more critical
- GPT-4o: 128k context — overflow at ~108k, Observer at 30k: 3-4× more observations before compaction

**Token accumulation for trigger:** The Observer needs a running total of **unobserved message tokens**. After each assistant response, accumulate:

```typescript
const newTokens = Token.estimate(JSON.stringify(newMessages))
// or use actual tokens from lastAssistant.tokens.input + tokens.output
```

The actual `lastFinished.tokens` from processor.ts is the best source — it's exact from the API.

---

### 6. Observer LLM Call — Model and Prompt

#### File: `packages/opencode/src/config/config.ts` lines 924–925 and 1044–1048

**Existing specialized agents in config:**

```typescript
// config.ts line 924-925:
compaction: Agent.optional() // already has a dedicated agent for compaction
```

**Existing `experimental` config** (lines 1024–1049):

```typescript
experimental: z.object({
  autodream: z.boolean().optional(),
  autodream_model: z.string().optional(), // format: "provider/model"
  // ... others
})
```

**Pattern for Observer model config:** Add `observer` agent alongside `compaction`:

```typescript
// config.ts — agent section (line 913-927):
observer: Agent.optional() // new — for the background Observer LLM
```

OR add to `experimental`:

```typescript
observer: z.boolean().optional() // enable/disable
observer_model: z.string().optional() // "google/gemini-2.5-flash"
```

**Recommended model:** `google/gemini-2.5-flash`

- 128k context (enough to process unobserved messages)
- Low cost — important since Observer fires every 6k tokens
- Mastra's own default (mastra-om-arch.md line 530)
- Consistent with `autodream_model` pattern already in config

**Observer prompt engineering (from arch doc section 4.1 + dream/prompt.txt style):**

- Distinguish user assertions (🔴) from questions (🟡)
- Temporal anchoring (resolve relative dates)
- State change detection
- Output: structured observation log in markdown

---

### 7. Injection Point for ObservationTable Data

#### File: `packages/opencode/src/session/system.ts` (97 lines)

#### File: `packages/opencode/src/session/llm.ts` (lines 104–134)

**Phase 1 (Engram recall) injection in `llm.ts` line 131:**

```typescript
if (input.recall) system.splice(1, 0, input.recall)
// system layout after injection:
// [0] = agent prompt (BP2, 1h cache)
// [1] = recall from Engram  ← Phase 1 added this
// [2] = env + skills (BP3, 5min cache)
// [3] = volatile (date/model — NOT cached)
```

**Where to inject local observations (ObservationTable):**
Phase 2 observations are LOCAL (SQLite, not Engram). Options:

| Slot              | Current content  | Caching behavior     | Observation fit      |
| ----------------- | ---------------- | -------------------- | -------------------- |
| `system[0]`       | Agent prompt     | BP2 = 1h cache       | ❌ Do not touch      |
| `system[1]`       | Recall (Phase 1) | BP3 = 5min cache     | ✅ Could merge here  |
| New `system[1.5]` | (empty)          | Would get 5min cache | ✅ Clean separation  |
| `system[2]`       | env + skills     | BP3 = 5min cache     | ❌ Would destabilize |
| `system[3]`       | volatile         | NOT cached           | ❌ Wrong semantics   |

**Recommendation:** Add a new `system.splice(2, 0, observations)` slot AFTER recall, BEFORE env+skills. This keeps Phase 1 recall at `system[1]` and puts Phase 2 observations at `system[2]`. The applyCaching logic (llm.ts lines 125–128) only explicitly handles `system[0]` and `system[1]` for the 2-part structure optimization — adding at index 2 doesn't break caching for the other slots.

**Alternatively:** Merge into Phase 1's recall slot as a combined `<engram-recall>...<observations>...</observations>` block. Simpler but couples the two systems.

**AutoDream integration:** Yes — AutoDream's `summaries()` function (dream/index.ts line 67) already reads `summary===true` assistant messages. The Observer's output would be stored differently (in `ObservationTable`, not as messages), so AutoDream would need an extension to also read local observations for its Engram consolidation. The arch doc `mastra-om-arch.md` section 7 mentions this: observations → AutoDream → Engram is the natural pipeline.

**`recall()` extension** in `system.ts` (line 73): Currently only reads Engram via MCP. Could be extended to:

1. Read Engram observations (existing)
2. Also read `ObservationTable` for the current session
3. Return combined result

---

### 8. Existing Test Patterns

#### File: `packages/opencode/test/session/compaction.test.ts` (1212 lines)

#### File: `packages/opencode/test/dream/summaries.test.ts` (253 lines)

#### File: `packages/opencode/test/fixture/fixture.ts` (172 lines)

**DB setup pattern (from summaries.test.ts lines 76–93):**

```typescript
await Instance.provide({
  directory: root, // repo root works as test project dir
  fn: async () => {
    const s = await Session.create({})
    try {
      // write to DB via Session.updateMessage / Session.updatePart
    } finally {
      await Session.remove(s.id) // cleanup
    }
  },
})
```

Tests write directly to the real SQLite DB via `Instance.provide`. No separate test DB setup needed — the `Instance` pattern handles the per-project DB context.

**`tmpdir` fixture** (fixture.ts line 46): For tests that need an isolated temp directory with git, config, etc.

**Mock pattern** (compaction.test.ts): Uses `bun:test` `mock` to mock `Provider.getLanguage` etc. But AGENTS.md says "avoid mocks as much as possible — test actual implementation."

**Test file location:** `packages/opencode/test/session/` — new Observer tests should go here as `observer.test.ts`.

---

### Affected Areas

- `packages/opencode/src/session/session.sql.ts` — add `ObservationTable`, `ObservationBufferTable`
- `packages/opencode/src/session/` — new folder `om/` with `index.ts`, `observer.ts`, `buffer.ts`, `record.ts`
- `packages/opencode/src/session/prompt.ts` — hook Observer trigger in `runLoop` (line ~1680, before `handle.process`)
- `packages/opencode/src/session/llm.ts` — inject observations at `system[2]` (line ~131)
- `packages/opencode/src/session/system.ts` — extend `recall()` to also read local observations OR add separate `observations()` function
- `packages/opencode/src/config/config.ts` — add `experimental.observer` + `experimental.observer_model` (or `agent.observer`)
- `packages/opencode/migration/` — new migration folder via `bun run db generate --name add_observation_tables`
- `packages/opencode/test/session/observer.test.ts` — new test file

---

### Approaches

#### Approach 1: Minimal Observer (DB-only, no buffer)

- Single table `session_observation`
- Observer fires synchronously when threshold crossed
- No pre-buffering: blocking LLM call on threshold
- Pros: Simple, minimal new code
- Cons: Blocks the agent loop at threshold; worse UX than compaction
- Effort: Medium

#### Approach 2: Full Mastra OM (Observer + Buffer + Reflector)

- Both tables (`session_observation` + `session_observation_buffer`)
- Background buffering via `Effect.forkIn(scope)` before each LLM call
- Non-blocking activation
- Optional Reflector for when observations themselves grow >40k
- Pros: Mastra-fidelity, non-blocking UX, proactive
- Cons: More complex state machine, more tests needed
- Effort: High

#### Approach 3: Observer-only (buffer enabled, no Reflector)

- Both tables, background buffering, skip Reflector initially
- Buffer state machine: idle → running → complete → activation
- Reflector can be Phase 3
- Pros: Balance of correctness and scope; Reflector is rarely needed in early sessions
- Cons: Observations can grow unbounded without Reflector
- Effort: Medium-High

---

### Recommendation

**Approach 3** — Observer + Buffer, no Reflector yet.

**Rationale:**

1. The buffer pattern is what makes the Observer non-blocking (which is the key UX advantage over reactive compaction)
2. The Reflector fires at 40k observation tokens — rarely needed in typical sessions (each observation run produces ~500–2k tokens; you'd need 20-80 runs before Reflector activates)
3. Following the existing pattern: `Effect.forkIn(scope)` for non-blocking work, matching how `title()` (line 1511) and `compaction.prune()` (line 1759) are already forked

**Implementation sequence:**

1. Migration: add both tables
2. `om/record.ts`: CRUD for `session_observation`
3. `om/buffer.ts`: CRUD for `session_observation_buffer` + activation logic
4. `om/observer.ts`: LLM call + prompt construction
5. Hook in `prompt.ts`'s `runLoop`: check token count, maybe fork buffer/activate
6. Hook in `llm.ts`/`system.ts`: inject observations into system prompt
7. Config extension
8. Tests

---

### Risks

- **Prompt caching breakage:** Adding `system[2]` (observations) must not destabilize BP2 (`system[0]`=agent prompt, 1h cache) or BP3 (`system[1]`=env+skills, 5min cache). Since `applyCaching` (transform.ts) only marks BP on `system[0]` and `system[1]`, inserting at index 2 via `splice` should be safe — but needs validation with a cache-stability test.
- **Token counting mismatch:** `Token.estimate()` is char/4, which can over/undercount by 20–30% vs actual tiktoken. Observer trigger may fire slightly early/late. Acceptable for the threshold logic; use a slightly lower trigger (25k) as buffer.
- **Observer LLM quality:** The quality of observations depends heavily on prompt engineering. Poor prompts → noisy observations → degraded agent performance. Needs iteration.
- **Existing sessions:** First threshold cross auto-migrates (Observer reads all messages from `time_created > 0`). Safe.
- **Test DB isolation:** Tests use real DB via `Instance.provide`. Need to `Session.remove()` in finally blocks to avoid cross-test contamination.
- **Effect layer complexity:** Adding a new OM `Service` (like `SessionCompaction.Service`) requires a new Layer with its own dependencies. Alternatively, a simpler non-Effect namespace module (like `AutoDream`) avoids the layer complexity.

---

### Ready for Proposal

**Yes.** The codebase is well-understood. All integration points are identified. The arch doc (`docs/mastra-om-arch.md`) already provides a complete design that has been code-verified against the actual implementation.

Key open question for the proposal: **Should the Observer be an Effect Service (like `SessionCompaction`) or a plain async namespace (like `AutoDream`)?**

- Effect Service: better composability, traces, typed errors
- Plain async namespace: simpler, less boilerplate, consistent with AutoDream pattern

Given that the Observer fires from inside an Effect context (`runLoop`), using an Effect Service (or at least `Effect.fn`) is preferred for proper tracing and error propagation.

---

### File:Line Reference Index

| Claim                                 | File:Line                                                    |
| ------------------------------------- | ------------------------------------------------------------ |
| Session, Message, Part, Todo tables   | `session/session.sql.ts:14–103`                              |
| `Timestamps` mixin definition         | `storage/schema.sql.ts:3–9`                                  |
| Migration command and output path     | `drizzle.config.ts:4–5` + `AGENTS.md:packages/opencode`      |
| Latest migration example (events)     | `migration/20260323234822_events/migration.sql`              |
| Compaction overflow trigger           | `session/overflow.ts:8–21`                                   |
| `COMPACTION_BUFFER` default (20k)     | `session/overflow.ts:6`                                      |
| `runCompactionLLM` signature          | `session/compaction.ts:216–265`                              |
| Compaction summary message shape      | `session/compaction.ts:231–240`                              |
| `PRUNE_MINIMUM` / `PRUNE_PROTECT`     | `session/compaction.ts:36–37`                                |
| `Token.estimate()` = char/4           | `util/token.ts:4–6`                                          |
| Actual token counts on assistant      | `session/processor.ts:284–285`                               |
| Overflow check formula                | `session/overflow.ts:14`                                     |
| `runLoop` location                    | `session/prompt.ts:1457–1762`                                |
| Overflow check in loop                | `session/prompt.ts:1533–1540`                                |
| `recall` loaded at step==1            | `session/prompt.ts:1681–1683`                                |
| Background fork pattern               | `session/prompt.ts:1511,1759`                                |
| `Effect.forkScoped` examples          | `effect/cross-spawn-spawner.ts:193,236` + `tool/bash.ts:344` |
| `InstanceState.make` pattern          | `effect/instance-state.ts:33–52`                             |
| `system.splice(1, 0, recall)`         | `session/llm.ts:131`                                         |
| `LLM.StreamInput.recall` field        | `session/llm.ts:39`                                          |
| `SystemPrompt.recall()`               | `session/system.ts:73–96`                                    |
| `SystemPrompt.volatile()` not cached  | `session/llm.ts:133–134` + comment                           |
| `experimental.autodream_model` config | `config/config.ts:1046–1048`                                 |
| `agent.compaction` in config          | `config/config.ts:924`                                       |
| `AutoDream.idle()` + `summaries()`    | `dream/index.ts:172–198` + `67–100`                          |
| AutoDream Bus subscription pattern    | `dream/index.ts:191–197`                                     |
| Dream agent prompt style              | `dream/prompt.txt:1–59`                                      |
| Test DB pattern (`Instance.provide`)  | `test/dream/summaries.test.ts:76–93`                         |
| `tmpdir` fixture                      | `test/fixture/fixture.ts:46–80`                              |
| `CutPoint.estimate()` = char/4        | `session/cut-point.ts:51–59`                                 |
| Arch doc (full Mastra OM plan)        | `docs/mastra-om-arch.md:1–577`                               |
| `openspec` config                     | `openspec/config.yaml:1–72`                                  |
