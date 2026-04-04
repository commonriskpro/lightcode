# Exploration: Observational Memory + Engram Integration

## Change: observational-memory-engram

**Date**: 2026-04-04
**Status**: Exploration complete — ready for proposal

---

## Current State

### 1. Compaction (reactive, intra-session only)

**`packages/opencode/src/session/compaction.ts`** — 558 lines

`runCompactionLLM` (lines 216–265) is the reference pattern for background LLM calls:

- Takes `messages: MessageV2.WithParts[]`, builds model messages via `MessageV2.toModelMessagesEffect`
- Calls `processor.process()` with `system: []` and `tools: {}`
- Result stored as `MessageV2.Assistant` with `summary: true` flag
- Used by `processCompaction` which has two modes:
  - **cut-point** (preferred): summarize old messages, keep recent verbatim (`CutPoint.find`)
  - **full replacement** (fallback): summarize all, replay last user message

**Key gap**: compaction is triggered only on context overflow, blocking the main turn. The resulting summary is stored as an in-session assistant message and **never crosses the session boundary**.

### 2. Prompt Caching (must not break)

**`packages/opencode/src/session/llm.ts`** (lines 103–131) — system array assembly:

```
system[0] = agent prompt (BP2: 1h cache — most stable)
system[1] = custom instructions (BP3: 5min cache — stable within session)
system[2] = volatile (date + model identity — NOT cached, injected last)
```

`applyCaching()` in **`packages/opencode/src/provider/transform.ts`** (lines 237–255):

- BP1: last tool (1h for Anthropic)
- BP2: `system[0]` (1h)
- BP3: `system[1]` (5min)
- BP4: second-to-last conversation message (5min)

**`system[2]` is intentionally NOT cached** (volatile, line 131 comment).

### 3. System Prompt Assembly (where Engram recall goes)

**`packages/opencode/src/session/prompt.ts`** (lines 1679–1696):

```typescript
const [skills, env, instructions, modelMsgs] =
  yield *
  Effect.all([
    Effect.promise(() => SystemPrompt.skills(agent)),
    Effect.promise(() => SystemPrompt.environment(model)),
    instruction.system().pipe(Effect.orDie),
    Effect.promise(() => MessageV2.toModelMessages(msgs, model)),
  ])
const system = [...env, ...(skills ? [skills] : []), ...instructions, ...(deferredSection ? [deferredSection] : [])]
```

This `system` array is passed as `system[1]` in `llm.ts` after the agent prompt is prepended in `stream()`.

**`packages/opencode/src/session/system.ts`** — `environment()`, `volatile()`, `skills()` helpers.

**`packages/opencode/src/session/instruction.ts`** — `Instruction.system()` reads AGENTS.md/CLAUDE.md files. This is the pattern Engram recall should follow: async lookup → string[] → injected into `system`.

### 4. AutoDream (idle trigger — blind to session content)

**`packages/opencode/src/dream/index.ts`** — `AutoDream.init()` (line 125):

```typescript
export function init(): () => void {
  return Bus.subscribe(SessionStatus.Event.Idle, () => {
    if (!configuredModel) return
    void run().catch(...)
  })
}
```

Fires `run()` → `spawn()` → creates a NEW session with the `"dream"` agent and `PROMPT` text.

**Critical gap**: The idle event (`SessionStatus.Event.Idle`) carries only `sessionID`. AutoDream has **zero access to what happened in the session** that just went idle. It reads only Engram's existing observations — not the session's messages.

**`packages/opencode/src/session/status.ts`** (lines 74–82): `Idle` event is published when a session transitions to idle. It includes `sessionID` — enough to query `session.messages({ sessionID })` if we wire it.

### 5. Engram Integration (existing, needs bridging)

**`packages/opencode/src/dream/engram.ts`**:

- `Engram.ensure()` — downloads/finds binary, registers as MCP via `engram mcp --tools=agent`
- MCP registered as `"engram"` server

**`packages/opencode/src/dream/prompt.txt`** — AutoDream consolidation workflow uses `mem_context`, `mem_search`, `mem_save`, `mem_update`. It does NOT receive session content as input.

### 6. MCP Tool Path (how Engram tools reach agents)

**`packages/opencode/src/mcp/index.ts`** — MCP tools exposed via `mcp.tools()` (returns `Record<string, Tool>`).

**`packages/opencode/src/session/prompt.ts`** (lines 516–591): `resolveTools` iterates `yield* mcp.tools()` and wraps each with `permission.ask` guard. All MCP tools are tagged `_deferred = true` (candidates for lazy loading).

This means the Engram `mem_save`, `mem_context`, etc. tools are already available in any agent session that has Engram registered — including a future Observer agent.

### 7. Token Utility

**`packages/opencode/src/util/token.ts`** — `Token.estimate(input: string)`:

```typescript
return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
```

Simple char/4 estimate. Sufficient for budgeting OM trigger thresholds.

### 8. DB Migration Pattern

**`packages/opencode/drizzle.config.ts`**: schema glob = `./src/**/*.sql.ts`, output = `./migration`.

Migration command: `bun run db generate --name <slug>`

Output per-folder: `migration/<timestamp>_<slug>/migration.sql` + `snapshot.json`. No `_journal.json`.

Example migration `20260323234822_events/migration.sql` shows simple `CREATE TABLE` + FK + `CREATE INDEX` pattern — no complex transactions.

**New tables needed**:

- `observation` (per-session OM observations: sessionID, text, createdAt)
- No cross-session tables needed if Engram handles persistence

### 9. ForkContext (child sessions sharing parent cache)

**`packages/opencode/src/session/prompt.ts`** (lines 72–88):

```typescript
export interface ForkContext {
  system: string[]
  tools: Record<string, AITool>
  messages: readonly any[]
}
```

Parent stashes context in `activeContexts` map (line 1696). Child sessions use this to reuse the same system/tools without re-building, enabling cache hits.

**Impact on OM**: If an Observer session is spawned as a fork child, it inherits parent's system + tools (including Engram tools). This is a cheap path for the Observer — no separate tool resolution needed.

---

## Affected Areas

| File                                           | Why Affected                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/compaction.ts`  | Reference pattern for Observer LLM call; prune logic may need to coordinate with OM   |
| `packages/opencode/src/session/llm.ts`         | System array assembly — Engram recall injected here as new element in `system` array  |
| `packages/opencode/src/session/prompt.ts`      | System assembly (lines 1679–1696) — OM recall added alongside env/skills/instructions |
| `packages/opencode/src/session/system.ts`      | New `recall()` function analogous to `environment()` and `skills()`                   |
| `packages/opencode/src/session/instruction.ts` | Pattern reference for async system injection                                          |
| `packages/opencode/src/dream/index.ts`         | AutoDream idle handler needs session content access                                   |
| `packages/opencode/src/dream/engram.ts`        | Already correct — no change needed                                                    |
| `packages/opencode/src/dream/prompt.txt`       | May need OM-specific section added                                                    |
| `packages/opencode/src/session/session.sql.ts` | New `ObservationTable` for intra-session OM logs                                      |
| `packages/opencode/src/session/status.ts`      | Idle event carries `sessionID` — sufficient for AutoDream to fetch messages           |

---

## Approaches

### Layer 1: Intra-session Observer (replaces reactive compaction)

**Approach A — Proactive background LLM Observer**

- A scheduled Effect fiber (`Effect.repeat` + `Schedule`) runs every N turns or T tokens
- Calls a mini-LLM (via `runCompactionLLM`-style call) on the last K messages
- Produces an observation string, writes to `ObservationTable` (new DB table)
- Does NOT block or replace compaction — runs in parallel
- Pros: proactive, non-blocking, incremental
- Cons: additional LLM cost per session, needs new DB table and migration
- Effort: **Medium**

**Approach B — Post-turn hook in processor.ts**

- After each `finish-step` event, trigger an async observation task
- Reads the last completed turn's messages, calls a small LLM, stores result
- Pros: simpler scheduling (already in the step lifecycle)
- Cons: still async cost per turn, harder to batch
- Effort: **Medium**

**Approach C — Enhanced compaction summary as observation**

- Reuse existing compaction summary output as OM observation (no new LLM call)
- On compaction, save the summary text to `ObservationTable` + pass to AutoDream
- Pros: zero extra LLM cost, reuses existing infrastructure
- Cons: only fires on context overflow (still reactive), doesn't improve over current state
- Effort: **Low**

**Recommendation for Layer 1**: Approach A with a budget cap (skip if session < 5K tokens) using `Token.estimate`. Use `Effect.forkScoped` inside `InstanceState.make` for the background fiber.

---

### Layer 2: AutoDream → Engram (cross-session pipeline)

**Gap**: AutoDream fires on `SessionStatus.Event.Idle` but receives only `sessionID`. It has no session content.

**Fix**: Pass `sessionID` in the dream `spawn()` call → read `session.messages({ sessionID })` → extract OM observations from `ObservationTable` → pass as additional context to the dream prompt.

**Pattern**:

1. `AutoDream.init()` receives `sessionID` from the Idle event
2. Reads `ObservationTable` for that session
3. Appends observation text to the dream prompt as `## Session Observations\n{text}`
4. Dream agent calls `mem_save` with `project_id`-scoped `topic_key`

**Alternatively (no new table)**: Read the compaction summaries from the session's messages (existing `summary: true` assistant messages) and pass those to AutoDream. Lower fidelity but zero new infrastructure.

---

### Layer 3: Session Recall via Engram

**Where to inject**: `packages/opencode/src/session/prompt.ts` lines 1679–1696.

**Which system[] slot**: Add as part of `system` (the array passed as `system[1]` to `llm.ts`), alongside `env`, `skills`, and `instructions`. Engram recall should be appended AFTER instructions — it's the least stable (changes session-to-session) so it fits at the end of `system[1]`.

**Cache implications**:

- `system[0]` = agent prompt (1h cache) — DO NOT touch
- `system[1]` = env + skills + instructions + **[Engram recall]** (5min cache, BP3)
- Adding Engram recall to `system[1]` will cause BP3 cache to miss when recall changes (i.e., every session start if Engram has new data)
- This is acceptable — BP3 is already 5min, and it fires only at session start (not every turn)
- **Alternative**: Inject recall into `system[2]` (volatile, never cached). Lower cache pressure but recall is never cached even across same-session turns. Given that recall is static per session, `system[1]` is correct.

**Implementation**: New `SystemPrompt.recall()` function in `system.ts`:

```typescript
export async function recall(projectID: string): Promise<string[]> {
  const bin = Engram.bin()
  if (!bin) return []
  // Call engram CLI to get context, or use MCP tool if available
  // Return formatted string
}
```

**Trigger**: First turn of a session only (check `step === 1` in runLoop). Cache the result in InstanceState so subsequent turns don't re-fetch.

---

## Key Findings (Q&A Format)

### Q1: Where to inject Engram recall?

**`packages/opencode/src/session/prompt.ts` lines 1679–1696** — the `Effect.all([...])` block that assembles `system`.

Add `SystemPrompt.recall(project.id)` to the parallel `Effect.all` call, append result to the `system` array. This places it in `system[1]` (BP3: 5min cache). Only fetch on `step === 1` via `InstanceState` cache.

### Q2: What does AutoDream idle trigger look like?

`Bus.subscribe(SessionStatus.Event.Idle, callback)` — fires every time a session goes idle. The callback receives `{ sessionID }`. AutoDream currently ignores the sessionID entirely and spawns a blind consolidation session. Fix: read observations from DB using the sessionID before spawning.

### Q3: How does Observer LLM call pattern work?

Follow `runCompactionLLM` in `compaction.ts` (lines 216–265):

- Create a `MessageV2.Assistant` with `mode: "observation"`, `agent: "observer"`
- Call `processor.process()` with `tools: {}`, `system: []`
- Result text → insert into `ObservationTable`
- Wrap in `Effect.forkScoped` for non-blocking execution

### Q4: What's in Token utility?

`Token.estimate(str)` = `str.length / 4`. Simple, not tokenizer-exact. Good enough for thresholds.

### Q5: DB migration pattern?

1. Add new `*.sql.ts` file with table definition
2. Run `bun run db generate --name <slug>` from `packages/opencode`
3. Output: `migration/<timestamp>_<slug>/migration.sql`
4. Table for OM observations: `project_id` + `session_id` FK + `text` + `time_created`

### Q6: How do Engram tools reach agents?

`mcp.tools()` (MCP service) → `resolveTools()` in `prompt.ts` (lines 516–591) → wrapped with `permission.ask` guard → included in `tools` dict → available to LLM. All MCP tools are tagged `_deferred = true`. If Engram is registered, its tools (`mem_save`, `mem_context`, etc.) are already available to any agent.

### Q7: What does `instruction.ts` inject and when?

`Instruction.system()` reads AGENTS.md/CLAUDE.md from disk (project + global paths + URL instructions). Returns `string[]`. Called once per turn (lines 1682). Engram recall should mirror this pattern: `SystemPrompt.recall()` async → `string[]` → spread into `system`.

### Q8: ForkContext and OM awareness?

Fork children inherit `system + tools + messages` from parent. If parent's `system[1]` already includes Engram recall, children get it for free. The Observer agent could also be spawned as a fork child to inherit Engram tools without separate tool resolution. OM does NOT need special fork awareness — it benefits automatically.

---

## Risks

1. **Cache invalidation (BP3)**: Adding Engram recall to `system[1]` will bust BP3 cache at every session start when recall content changes. Acceptable given it's 5min TTL and session starts are infrequent. Mitigate: only fetch on `step === 1`, not every turn.

2. **AutoDream is not Effect**: `dream/index.ts` is plain async code (no Effect). The Observer and recall features need to bridge Effect ↔ async cleanly. Use `Effect.runPromise` for Effect calls from AutoDream; use the existing `makeRuntime` pattern for any new Effect service.

3. **Engram availability**: `Engram.bin()` may return `undefined` if Engram isn't installed. All recall/observer code must guard on `Engram.ensure()` returning `true` before proceeding.

4. **New DB table migration**: Adding `ObservationTable` requires a migration. Risk is low (additive). Must be backward-compatible.

5. **Observer LLM cost**: Each proactive observation call costs tokens. Budget guard using `Token.estimate` on message list before triggering. Configurable threshold recommended.

6. **Idle event frequency**: `SessionStatus.Event.Idle` fires for every session (including dream sessions, title sessions, etc.). AutoDream must filter: only trigger for non-dream, non-compaction sessions (check session `agent` field).

7. **Recall staleness**: Engram data may be stale (from previous sessions). This is by design — cross-session memory is intentionally persistent. Document this clearly.

---

## Recommendation

**Phased approach**:

**Phase 1 (MVP — lowest risk)**: Layers 2 + 3 only, using existing compaction summaries as OM signal.

- Wire `sessionID` from Idle event to AutoDream's `spawn()`
- Read existing `summary: true` messages from the idle session
- Pass them as context to the dream prompt
- Add `SystemPrompt.recall()` in `system.ts` that calls Engram CLI directly
- Inject recall into `prompt.ts` system array (step === 1 only)

**Phase 2**: Full Layer 1 (Observer LLM) as a proactive background fiber.

- New `ObservationTable` (migration)
- New `SessionObserver` service using `Effect.forkScoped` + `Effect.repeat`
- Observer runs after N turns or T tokens
- Feeds AutoDream with richer, proactive observations

---

## Ready for Proposal

**Yes** — Layer 3 (session recall) and Layer 2 (AutoDream bridging) are well-understood and low-risk. Layer 1 (Observer LLM) requires more design on scheduling and cost budgeting.

Recommend starting proposal with Phase 1 (Layers 2+3) as the bounded, safe first change.
