# LightCode v2 Memory Architecture (Code-Verified)

This document is based on direct source inspection only. Every behavioral claim is tied to code locations.

---

## 1) Overview (end-to-end)

LightCode currently has 4 memory layers:

1. **Cross-session recall injection**: fetches Engram context via MCP and injects it into system prompt as `<engram-recall>...</engram-recall>` (`src/session/system.ts:87-110`, `:71-73`).
2. **Intra-session observation**: token-threshold state machine triggers background extraction of local observations from chat messages (`src/session/om/buffer.ts:22-35`, `src/session/prompt.ts:1515-1569`).
3. **Reflection/condensation**: when local observation text grows beyond threshold, LLM condenses into `reflections` while preserving original `observations` (`src/session/om/reflector.ts:9`, `:26-59`, `src/session/om/record.ts:76-83`).
4. **AutoDream consolidation**: on session idle, spawns a hidden `dream` agent session and injects local summary/observation context into dream prompt (`src/dream/index.ts:182-207`, `:112-115`, `:118-160`).

High-level runtime flow:

```text
User/assistant turns
  -> runLoop checks token delta
  -> OMBuf emits idle|buffer|activate|force
  -> Observer.run extracts local observations
  -> OM.upsert stores/updates session_observation
  -> Reflector.run may condense to reflections
  -> SystemPrompt.observations injects reflections ?? observations into next turn
  -> Session idle event triggers AutoDream -> Engram MCP consolidation session
```

Verified at `src/session/prompt.ts:1515-1569,1740-1780`, `src/session/system.ts:79-85`, `src/dream/index.ts:182-207`.

---

## 2) Layer 1: Cross-Session Recall

### `SystemPrompt.recall(pid)` exact flow

1. Calls `MCP.tools()`.
2. Finds first tool key containing both `"engram"` and `"mem_context"`.
3. Executes it with `{ limit: 30, project: pid }` and tool context `{ toolCallId: "recall", messages: [], abortSignal }`.
4. Reads only text parts from `res.content`.
5. Applies token cap (`2000`) via `capRecallBody`.
6. Wraps in `<engram-recall>...</engram-recall>`.
7. On **any exception**, returns `undefined`.

Verified at `src/session/system.ts:87-110`.

### Helper contracts

- `wrapRecall(body)` -> exact format:

```text
<engram-recall>
{body}
</engram-recall>
```

Verified at `src/session/system.ts:71-73`.

- `capRecallBody(txt)`:
  - cap = `2000` tokens
  - method = `Token.estimate(txt) > cap ? txt.slice(0, cap * 4) : txt`

Verified at `src/session/system.ts:66-69`.

Implication: this is approximate token truncation (char/4 heuristic downstream of `Token.estimate` usage here).

---

## 3) Layer 2: Intra-Session Observer

### 3.1 OMBuf (`src/session/om/buffer.ts`)

#### Exact `State` type

```ts
type State = { tok: number; pending: boolean; lastInterval: number }
```

Verified at `src/session/om/buffer.ts:5`.

`pending` exists in state but is not used by current logic.

#### Exact constants

- `TRIGGER = 30_000`
- `INTERVAL = 6_000`
- `FORCE = 36_000`

Verified at `src/session/om/buffer.ts:10-12`.

#### `check(sid, tok)` behavior (exact)

`check` mutates cumulative `s.tok += tok`, then:

1. `>= FORCE` => `"force"`
2. else `>= TRIGGER` => `"activate"`
3. else computes interval boundaries:
   - `intervals = floor(s.tok / INTERVAL)`
   - `lastIntervals = floor(s.lastInterval / INTERVAL)`
   - if crossed (`intervals > lastIntervals`): set `s.lastInterval = s.tok`, return `"buffer"`
4. else `"idle"`

Verified at `src/session/om/buffer.ts:22-35`.

#### `add`, `tokens`, `reset`

- `add(sid, tok)` increments `ensure(sid).tok` (`src/session/om/buffer.ts:46-48`).
- `tokens(sid)` returns `state.get(sid)?.tok ?? 0` (`:42-44`).
- `reset(sid)` deletes map entry entirely (`:37-40`).

#### What signals mean in practice (actual runtime integration)

In run loop:

- `"buffer"` and `"activate"`: both currently trigger **same async forked observer path** (`src/session/prompt.ts:1518-1543`).
- `"force"`: triggers same observer path but **blocking (not forked)**, then continues (`:1544-1569`).
- `"idle"`: no observer action.

#### Module-level `Map` implications

`state` is process-local module state keyed by `SessionID` (`src/session/om/buffer.ts:7`):

- Shared among all sessions in same process.
- No cross-process coordination.
- Lost on process restart.
- No persistence to DB.

---

### 3.2 Observer (`src/session/om/observer.ts`)

#### Exact `CONDENSE_PROMPT`

```text
You are a memory consolidation agent. You receive multiple observation chunks and must produce a single, coherent observation log.

Rules:
- Preserve ALL important facts — nothing should be lost
- Merge duplicate or related facts into single bullets
- Keep 🔴 (user assertions) and 🟡 (user requests) markers
- Prefer recent observations over older ones when they contradict
- Condense older facts more aggressively, retain more detail for recent ones
- Preserve timestamps when present
- Output format must match the input format exactly

Output the consolidated log directly, no preamble.
```

Verified at `src/session/om/observer.ts:10-21`.

#### Exact `PROMPT` (observation extraction)

```text
You are an observation agent. Extract facts from the conversation below as a structured observation log.

Rules:
- 🔴 User assertions (facts the user stated): "I work at Acme", "the app uses PostgreSQL"
- 🟡 User requests/questions (what they asked for, NOT facts): "Can you help me..."
- Include timestamps when messages have them
- Resolve relative dates to absolute (e.g. "next week" → actual date)
- Mark superseded info explicitly: "~old fact~ → new fact"
- Skip: routine tool calls, file reads, assistant acknowledgements
- Keep bullets concise — one fact per bullet

Output format:
## Observations

- 🔴 HH:MM [fact]
- 🟡 HH:MM [request]
```

Verified at `src/session/om/observer.ts:23-38`.

#### `run()` signature and return

```ts
run(input: { sid: SessionID; msgs: MessageV2.WithParts[]; prev?: string }): Promise<string | undefined>
```

Verified at `src/session/om/observer.ts:74-78`.

#### `condense()` signature and behavior

```ts
condense(chunks: string[], prev?: string): Promise<string>
```

- `chunks.length <= 1` => returns joined chunks directly.
- Otherwise tries LLM condense, fallback to joined text on failures/disabled.

Verified at `src/session/om/observer.ts:43-72`.

`condense()` is called by `OM.activate()` (`src/session/om/record.ts:44`).

#### Model resolution chain

Both `run()` and `condense()` follow:

`Config.get()` -> resolve `modelStr` (`observer_model` or default) -> `Provider.parseModel` -> `Provider.getModel` -> `Provider.getLanguage` -> `generateText`.

Verified at `src/session/om/observer.ts:47-57,79-97,119-123`.

#### `observer: false` opt-out

- `run()`: immediate `undefined` return.
- `condense()`: immediate joined text fallback.

Verified at `src/session/om/observer.ts:48,81`.

#### Graceful degradation (exact failure handling)

- model resolution failure (`getModel`) => undefined/joined
- language resolution failure (`getLanguage`) => undefined/joined
- LLM call failure (`generateText`) => undefined/joined
- empty textual context => undefined

Verified at `src/session/om/observer.ts:52-57,66-71,87-97,113,123-129`.

#### What messages are passed to Observer

`run()` filters incoming `msgs` to roles `user|assistant`; from parts, keeps only `type === "text"`; joins text parts per message; emits `[User]: ...` / `[Assistant]: ...` blocks.

Verified at `src/session/om/observer.ts:99-112`.

---

## 4) Layer 3: Reflector

### Reflector constants/prompt

- `THRESHOLD = 40_000` (`src/session/om/reflector.ts:9`)
- prompt is the consolidation rules text in `PROMPT` (`:11-21`)

### `run(sid)` flow

1. `rec = OM.get(sid)`
2. return if no `rec?.observations`
3. return if `observation_tokens <= THRESHOLD`
4. return if `experimental.observer === false`
5. resolve model/language from `observer_model` defaulting to `google/gemini-2.5-flash`
6. call `generateText` with `system: PROMPT`, `prompt: rec.observations`
7. if text present -> `OM.reflect(sid, result.text)`

Verified at `src/session/om/reflector.ts:26-59`.

### Why observations are preserved

`OM.reflect` only updates `{ reflections, time_updated }`, filtered by `session_id`; it does not modify `observations`.

Verified at `src/session/om/record.ts:76-83`.

### Failure modes

Any model/language/LLM error returns early with no throw from `run` path.

Verified at `src/session/om/reflector.ts:36-55,57`.

---

## 5) Layer 4: AutoDream Consolidation

### `idle(sid)` exact steps

1. `Engram.ensure()`; return if false.
2. load config; if `cfg.experimental?.autodream === false`, return.
3. resolve `model = configuredModel ?? cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"`.
4. return if no `sdk`.
5. set `_dreaming = true`.
6. `obs = await summaries(sid)`.
7. `await spawn(undefined, obs, model)`.
8. write state `{ lastConsolidatedAt: Date.now(), lastSessionCount: 0 }`.
9. log errors, always reset `_dreaming=false` in `finally`.

Verified at `src/dream/index.ts:183-205`.

### `summaries(sid)` fallback chain

Priority:

1. `ObservationTable` via `OM.get` -> if `observations` exists, return full or truncated to `4000*4` chars.
2. assistant summary messages (`info.summary === true`), cap ~4000 tokens.
3. fallback last 10 user+assistant text parts, cap ~2000 tokens.

Verified at `src/dream/index.ts:69-110`.

### `spawn(focus?, obs?)` and observation injection

- Builds prompt via `buildSpawnPrompt(PROMPT, focus, obs)`.
- `buildSpawnPrompt` appends:
  - `## Focus` section when `focus` present.
  - `## Session Observations` section when `obs` token estimate > 0.

Verified at `src/dream/index.ts:112-115,118-141`.

### `run(focus?)`

Public API does:

- ensure Engram
- toggle `_dreaming`
- call `spawn(focus)`
- write state
- return user-facing status string

Verified at `src/dream/index.ts:163-180`.

### `init()` idle subscription

Subscribes to `SessionStatus.Event.Idle`; extracts `event.properties.sessionID`; calls `idle(...)` asynchronously.

Verified at `src/dream/index.ts:201-207`.

### Dream agent prompt workflow (`src/dream/prompt.txt`)

The consolidation prompt defines 4 explicit phases:

1. **Phase 1 — Orient**: call `mem_context(limit: 50)`, inspect count/distribution/date range.
2. **Phase 2 — Gather Signal**: run `mem_search` + code verification (`read/grep/glob`) for duplicates, contradictions, stale info, orphaned observations, missing topic links.
3. **Phase 3 — Consolidate**:
   - duplicates -> merge/update canonical observation with `mem_update`
   - contradictions -> verify and mark superseded
   - stale -> prefix `[STALE]`
   - orphaned -> assign proper `topic_key`
   - cross-session patterns -> create new high-level observations via `mem_save`
4. **Phase 4 — Report**: summarize reviewed/merged/created counts and themes.

Session Observations behavior:

- If `## Session Observations` is present in prompt, dream agent should:
  - `mem_search` each item
  - `mem_update` existing topic when found
  - otherwise `mem_save` with topic key format: `project/{name}/session-insight/{topic}`
  - focus on high-signal items only
- If section is absent, skip it entirely.

Verified at `src/dream/prompt.txt:10-52` and topic-key convention at `src/dream/prompt.txt:38-40`.

---

## 6) OM CRUD and DB schema

### 6.1 OM record API (`src/session/om/record.ts`)

- `ObservationRecord = typeof ObservationTable.$inferSelect` (`:7`)
- `ObservationBuffer = typeof ObservationBufferTable.$inferSelect` (`:8`)

Functions:

- `get(sid)`: select single observation by `session_id` (`:11-13`)
- `upsert(rec)`: insert or conflict-update on `id` (`:15-19`)
- `buffers(sid)`: select buffers ordered by `starts_at ASC` (`:21-30`)
- `addBuffer(buf)`: insert buffer row (`:32-34`)
- `activate(sid)`: merge all buffers via `Observer.condense`; update/insert observation row; delete all buffers for session (`:36-74`)
- `reflect(sid, txt)`: update only `reflections`, `time_updated` where `session_id` (`:76-83`)

#### `activate()` details

- reads existing rec + all buffers
- `merged = Observer.condense(chunks, rec?.observations)`
- `last_observed_at = latest.ends_at`
- `generation_count += bufs.length`
- `observation_tokens = merged.length >> 2` (char/4)
- clears `ObservationBufferTable` rows for session

Verified at `src/session/om/record.ts:40-47,49-57,59-70,73`.

### 6.2 Session DB schema (`src/session/session.sql.ts`)

#### `ObservationTable` (`session_observation`)

Columns:

- `id text primary key` (`$type<SessionID>`)
- `session_id text not null` FK -> `SessionTable.id` with `onDelete: cascade`
- `observations text` nullable
- `reflections text` nullable
- `last_observed_at integer` nullable
- `generation_count integer not null default 0`
- `observation_tokens integer not null default 0`
- timestamps (`time_created`, `time_updated`) via spread

Index: `observation_session_idx` on `session_id`.

Verified at `src/session/session.sql.ts:105-125` and timestamp mixin at `src/storage/schema.sql.ts:3-10`.

#### `ObservationBufferTable` (`session_observation_buffer`)

Columns:

- `id text primary key`
- `session_id text not null` FK -> `SessionTable.id` with `onDelete: cascade`
- `observations text not null`
- `message_tokens integer not null`
- `observation_tokens integer not null`
- `starts_at integer not null`
- `ends_at integer not null`
- timestamps (`time_created`, `time_updated`)

Index: `obs_buffer_session_idx` on `session_id`.

Verified at `src/session/session.sql.ts:127-143` and `src/storage/schema.sql.ts:3-10`.

---

## 7) `system[]` Assembly and Caching

### LLM system array construction (actual order)

In `LLM.stream`:

1. `system[0]` starts as joined string of:
   - agent prompt (or provider default)
   - `input.system`
   - `input.user.system` if present
2. plugin hook `experimental.chat.system.transform` can mutate array
3. if array grew and header unchanged, it re-collapses into `[header, rest.join("\n")]`
4. if recall exists: insert at index 1
5. if observations exists: insert at index `2` when recall exists else `1`
6. append volatile string as last element

Verified at `src/session/llm.ts:105-137`.

### Recall and observations splice positions

- Recall splice: `system.splice(1, 0, input.recall)`.
- Observations splice: `system.splice(input.recall ? 2 : 1, 0, input.observations)`.

Verified at `src/session/llm.ts:132-134`.

### Where volatile is pushed

`system.push(SystemPrompt.volatile(input.model))`.

Verified at `src/session/llm.ts:137`.

### Where `applyCaching()` is effectively invoked

`LLM.stream` middleware calls `ProviderTransform.message(...)` (`src/session/llm.ts:368`).
Inside `ProviderTransform.message`, `applyCaching(msgs, model)` is called only for Anthropic-like models (excluding AI SDK gateway npm package check) (`src/provider/transform.ts:295-309`).

### BP markers and TTL behavior

**BP1** (in `llm.ts`):

- Last tool definition gets `anthropic.cacheControl = { type: "ephemeral", ttl: "1h" }`.
- Marks tool section boundary for prompt cache stability in Anthropic prefix order.

Verified at `src/session/llm.ts:286-296`.

**BP2 / BP3 / BP4** (in `transform.ts`):

- BP2: `system[0]`, `cacheOpts(long=true)`
- BP3: `system[1]`, `cacheOpts(long=false)`
- BP4: second-to-last non-system message, `cacheOpts(long=false)`

Verified at `src/provider/transform.ts:237-252`.

`cacheOpts` provider payloads:

- `long=true` and anthropic-like ->
  - `anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } }`
  - `bedrock: { cachePoint: { type: "default" } }`
- otherwise -> `CACHE_5M`:
  - `anthropic: { cacheControl: { type: "ephemeral" } }`
  - `openrouter: { cacheControl: { type: "ephemeral" } }`
  - `bedrock: { cachePoint: { type: "default" } }`
  - `openaiCompatible: { cache_control: { type: "ephemeral" } }`
  - `copilot: { copilot_cache_control: { type: "ephemeral" } }`

Verified at `src/provider/transform.ts:193-216`.

---

## 8) Configuration Reference (actual defaults from code)

Experimental memory-related config fields:

- `experimental.autodream?: boolean`
- `experimental.autodream_model?: string`
- `experimental.observer?: boolean`
- `experimental.observer_model?: string`

Verified at `src/config/config.ts:1044-1060`.

### Actual runtime defaults (not description text)

- `experimental.observer`: no schema default; behavior is effectively **enabled unless explicitly `false`** because checks are `cfg.experimental?.observer === false`.
  - Verified at `src/config/config.ts:1024-1062`, `src/session/om/observer.ts:48,81`, `src/session/om/reflector.ts:32`.
- `experimental.observer_model`: defaults to `"google/gemini-2.5-flash"` in Observer and Reflector.
  - Verified at `src/session/om/observer.ts:49,83`, `src/session/om/reflector.ts:33`.
- `experimental.autodream_model`: no schema default; `idle()` falls back to `cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"` — same model as observer.
  - Verified at `src/dream/index.ts:191`.
- `experimental.autodream` is checked in `idle()`: if explicitly `false`, skips consolidation immediately.
  - Verified at `src/dream/index.ts:187-189`.

---

## 9) Data Flow Diagrams (ASCII)

### Turn-time local memory flow

```text
runLoop
  |
  | tok = lastFinished.input + output
  v
OMBuf.check(sid, tok)
  |-- idle ------> no-op
  |-- buffer ----> fork Observer pipeline
  |-- activate --> fork Observer pipeline
  |-- force -----> blocking Observer pipeline

Observer pipeline:
  OM.get(sid) -> boundary=last_observed_at||0
  msgs.filter(created > boundary)
  Observer.run({msgs, prev})
  if obs: OM.upsert(... observations=obs, reflections=null, last_observed_at=Date.now())
  if observation_tokens > 40k: Reflector.run(sid)
```

Verified at `src/session/prompt.ts:1516-1569`.

### System prompt memory injection flow

```text
step===1 ? recall = SystemPrompt.recall(projectID) : keep previous recall
obs = SystemPrompt.observations(sessionID) // every turn

LLM.system construction:
  system[0] = header
  + splice recall at [1] (if present)
  + splice obs at [2] or [1]
  + push volatile last
```

Verified at `src/session/prompt.ts:1740-1745`, `src/session/llm.ts:132-137`.

### Idle AutoDream flow

```text
SessionStatus.Event.Idle(sessionID)
  -> AutoDream.idle(sessionID)
       -> Engram.ensure()
       -> require configuredModel
       -> obs = AutoDream.summaries(sessionID)
       -> spawn(undefined, obs)
            -> session.create(title)
            -> promptAsync(agent="dream", text=buildSpawnPrompt(PROMPT, focus?, obs?))
            -> poll session.status up to 10 min
```

Verified at `src/dream/index.ts:118-160,182-207`.

---

## 10) Failure Modes & Graceful Degradation

- **Recall path failures**: missing tool, missing execute, empty output, execute error -> returns `undefined` and does not fail turn.
  - `src/session/system.ts:91-109`
- **Observer model resolution / LLM failures**: return `undefined` (`run`) or joined chunks (`condense`).
  - `src/session/om/observer.ts:52-57,66-71,87-97,123-129`
- **Reflector failures**: early return, no throw.
  - `src/session/om/reflector.ts:36-57`
- **AutoDream failures**: logs and returns status string / no throw in idle subscriber path.
  - `src/dream/index.ts:174-177,193-205`
- **Engram install/register failures**: `ensure()` flips sticky `failed=true` and returns false afterward.
  - `src/dream/engram.ts:158-171`

---

## 11) Known Limitations (from code)

1. **Char/4 token approximations** used for observation token accounting (`obs.length >> 2`, `merged.length >> 2`) and recall truncation (`slice(cap*4)`), which can diverge from provider tokenizer reality.
   - `src/session/prompt.ts:1536,1562`, `src/session/om/record.ts:46`, `src/session/system.ts:66-69`
2. **One-turn race window**: `buffer/activate` path is forked, so observation update can lag by one or more turns while next LLM call already proceeds.
   - `src/session/prompt.ts:1518-1543`
3. **Boundary drift risk**: `last_observed_at` is set with `Date.now()` (not last message timestamp), while filtering uses message `time.created > boundary`; clock/timing ordering can skip edge messages.
   - `src/session/prompt.ts:1521-1523,1534,1547-1549,1560`
4. **`OMBuf.pending` is unused**, suggesting incomplete state semantics.
   - `src/session/om/buffer.ts:5`
5. **ObservationBuffer table path is effectively dormant in turn loop**: runLoop writes directly to `ObservationTable` with `OM.upsert` and never calls `OM.addBuffer/OM.activate`.
   - `src/session/prompt.ts:1529-1539,1555-1565`; `src/session/om/record.ts:32-74`
6. **`experimental.autodream` flag is checked in `idle()` at runtime** — if `false`, consolidation is skipped immediately after `Engram.ensure()`. The idle subscription is always installed at bootstrap, but the flag is respected before any model call.
   - `src/dream/index.ts:187-189`
7. **`readState()` in AutoDream is currently unused** (state is written but never read in this module).
   - `src/dream/index.ts:25-32,171,191`

---

## 12) Test Coverage Map (what is and is not tested)

### Covered by mandatory test files

- OMBuf thresholds, accumulation, reset behavior:
  - `test/session/observer.test.ts:18-135`
- SystemPrompt wrappers/caps and observations wrapping path:
  - `test/session/observer.test.ts:137-219`
- OM CRUD basics + activate merge path + reflect no-overwrite of observations:
  - `test/session/observer.test.ts:221-365,442-489`
- Recall graceful undefined contracts + wrapper format:
  - `test/session/recall.test.ts:7-68`
- Observations reflections-priority logic:
  - `test/session/system.test.ts:108-194`
- AutoDream summaries fallback and prompt injection composition:
  - `test/dream/summaries.test.ts:74-253`

### Not covered / weakly covered

1. **Observer/Reflector prompt text correctness** not assertion-tested against exact strings.
2. **Model resolution chain failures** only indirectly covered; no targeted mocks for each failure branch.
3. **runLoop async race behavior (`buffer` fork vs `force`)** not concurrency-tested.
4. **`OM.addBuffer`/`OM.activate` integration in live runLoop** not covered (and not wired in runLoop).
5. **Engram tool surface (exact tool names)** not verified by code-level contract in repo; external binary behavior is assumed.
6. **Caching BP interactions with recall/observations under real provider responses** not end-to-end tested here.

---

## Appendix A: Engram integration specifics

### Auto-install / auto-register

`Engram.ensure()` resolves in order:

1. already connected MCP named like `engram`
2. `which("engram")`
3. cached binary at `Global.Path.bin/engram`
4. download GitHub release tarball and extract

Then registers MCP local server command:

```text
[bin, "mcp", "--tools=agent"]
```

Verified at `src/dream/engram.ts:43-52,65-71,122-156`.

### Tool names exposed

This repository does **not** hardcode the full `mem_*` tool list in TypeScript. It delegates to external Engram binary with `--tools=agent`.

What is explicitly referenced in repo code/text:

- runtime recall path expects a tool key containing `mem_context` (`src/session/system.ts:90-91`)
- dream prompt documents available tools as `mem_context`, `mem_search`, `mem_save`, `mem_update`, `mem_get_observation` (`src/dream/prompt.txt:4`)

---

## Appendix B: Observer Buffer API re-exports

`src/session/om/index.ts` re-exports:

- `OM`, `ObservationRecord`, `ObservationBuffer`
- `Observer`
- `OMBuf`
- `Reflector`

Verified at `src/session/om/index.ts:1-4`.
