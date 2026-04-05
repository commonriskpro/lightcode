# LightCode Memory Core V3 — Technical Design

**Status**: Active
**Date**: 2026-04-05
**Depends On**: `LIGHTCODE_MEMORY_CORE_V3_SPEC.md`, `LIGHTCODE_MEMORY_CORE_V2_DESIGN.md`
**V2 Baseline**: Current `dev` HEAD

---

## Table of Contents

1. [Technical Approach](#technical-approach)
2. [D1 — Fix Fork Step Counter Bug](#d1--fix-fork-step-counter-bug)
3. [D2 — Load Memory Context in Fork Path](#d2--load-memory-context-in-fork-path)
4. [D3 — Make Memory.buildContext() Canonical for Normal Path](#d3--make-memorybuildcontext-canonical-for-normal-path)
5. [D4 — Wire Durable Fork Context](#d4--wire-durable-fork-context)
6. [D5 — Fix activeContexts Memory Leak](#d5--fix-activecontexts-memory-leak)
7. [D6 — Remove observeSafe()](#d6--remove-observesafe)
8. [D7 — Auto-index OM Observations at Session End](#d7--auto-index-om-observations-at-session-end)
9. [D8 — Add Working Memory Guidance to System Prompt](#d8--add-working-memory-guidance-to-system-prompt)
10. [D9 — Remove Engram.ensure() from run()](#d9--remove-engramensure-from-run)
11. [D10 — Engram Audit and Isolation](#d10--engram-audit-and-isolation)
12. [Data Flow](#data-flow)
13. [File Changes Summary](#file-changes-summary)
14. [Module Dependencies](#module-dependencies)
15. [Testing Strategy](#testing-strategy)
16. [Migration Strategy](#migration-strategy)
17. [Open Questions](#open-questions)

---

## Technical Approach

V3 is a **fix-and-connect phase**. V1 built the schema and services. V2 wired them into the hot path. V3 closes the gaps V2 left open: a broken fork path, a leaked Map, dead code, missing auto-indexing, and the last Engram gate.

The guiding principle: **every memory path must be reachable, canonical, bounded, and durable**.

- **Reachable**: the fork step counter bug (D1) makes the entire fork context path dead code. Fix it first.
- **Canonical**: `Memory.buildContext()` must be the sole entry point for all context assembly — normal turns AND fork turns (D2, D3).
- **Bounded**: `activeContexts` must have a cleanup path (D5). `observeSafe()` must be removed (D6).
- **Durable**: fork context must survive restarts (D4). Session observations must flow into `memory_artifacts` (D7).

No schema changes. No new tables. No new abstractions. The ten designs are ordered by dependency:

```
D1 (step fix) → D2 (fork memory) → D3 (canonical buildContext)
                  ↓
                D4 (durable fork) → D5 (activeContexts cleanup)
                                    D6 (dead code)
                                    D7 (auto-index)
                                    D8 (agent guidance)
                                    D9 (Engram.ensure)
                                    D10 (Engram audit)
```

D1 must land first. D2 depends on D1. D3 can parallel D2. Everything else is independent.

---

## D1 — Fix Fork Step Counter Bug

### Problem

**File**: `packages/opencode/src/session/prompt.ts`
**Lines**: 1466, 1511, 1636

The fork path is unreachable. The `while(true)` loop at line 1472 increments `step` at line 1511 (from 0 → 1) before the fork check at line 1636:

```
Line 1466:  let step = 0
Line 1511:  step++          ← fires first iteration, step becomes 1
Line 1636:  if (fork && step === 0) {   ← ALWAYS FALSE
```

The child session enters the normal path (line 1685+), building its own system prompt from scratch without any parent context.

### Design

**Choice**: Change the guard from `step === 0` to `step === 1`.

**Alternatives considered**:

- Move `step++` below the fork check → rejected: would break the `step === 1` title generation at line 1512 and the summarize call at line 1735.
- Use a separate boolean `firstTurn` → rejected: `step === 1` is semantically identical and avoids adding a variable.

**Rationale**: The fork check should fire on the first real iteration. After `step++` at line 1511, the first iteration has `step === 1`. This is the minimal, correct fix.

### Before / After

```ts
// prompt.ts line 1636 — BEFORE:
if (fork && step === 0) {

// prompt.ts line 1636 — AFTER:
if (fork && step === 1) {
```

One line change. No other lines affected.

### Failure Semantics

If `forks.get(sessionID)` returns `undefined` (no fork was stashed), the guard is false and the normal path runs — identical to current behavior. Zero risk of regression for non-fork sessions.

---

## D2 — Load Memory Context in Fork Path

### Problem

**File**: `packages/opencode/src/session/prompt.ts`
**Lines**: 1635–1683

Even with D1 applied, the fork path passes `recall=undefined`, `obs=undefined`, `workingMem=undefined` to `handle.process()` (lines 1676–1678). These variables are only populated at `step === 1` in the normal path (lines 1757–1774), which the fork path bypasses via `continue` at line 1682.

Child agents start with zero memory context.

### Design

**Choice**: Call `Memory.buildContext()` inside the fork block to load the child's own memory, then pass the results to `handle.process()`.

**Alternatives considered**:

- Copy the parent's recall/obs/workingMem into the fork stash → rejected: stale by the time the child runs; the child deserves its own fresh context.
- Move the step===1 memory load above the fork check → rejected: the fork check is structurally separate (has its own `continue`); mixing control flow makes it harder to reason about.

**Rationale**: `Memory.buildContext()` already composes all four layers. Using it here makes the fork path and normal path converge on the same canonical function. The child gets fresh context scoped to its session ID and the parent's project.

### Before / After

```ts
// prompt.ts lines 1635-1683 — BEFORE (after D1 fix):
const fork = forks.get(sessionID)
if (fork && step === 1) {
  forks.delete(sessionID)
  log.info("using fork context", { sessionID })
  // ... creates msg, handle ...
  const result =
    yield *
    handle.process({
      // ...
      recall, // undefined
      observations: obs, // undefined
      workingMemory: workingMem, // undefined
    })
  // ...
}

// prompt.ts — AFTER:
const fork = forks.get(sessionID)
if (fork && step === 1) {
  forks.delete(sessionID)
  log.info("using fork context", { sessionID })

  // Load child's own memory context — fresh, scoped to this session + project
  const childText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .trim()

  const mem =
    yield *
    Effect.promise(() =>
      Memory.buildContext({
        scope: { type: "thread", id: sessionID },
        ancestorScopes: [{ type: "project", id: Instance.project.id }],
        semanticQuery: childText,
      }),
    )
  recall = mem.semanticRecall
  obs = mem.observations
  workingMem = mem.workingMemory

  // ... existing msg/handle creation unchanged ...
  const result =
    yield *
    handle.process({
      // ...
      recall,
      observations: obs,
      workingMemory: workingMem,
    })
  // ...
}
```

### Module Dependencies

`prompt.ts` already imports `Memory` (via `@/memory`) and `Instance` (via `@/project/instance`). No new imports needed.

### Failure Semantics

`Memory.buildContext()` catches all errors internally and returns `undefined` for each layer on failure. If the child has no observations or working memory yet (common for fresh forks), the fields are `undefined` — which is the existing behavior, so no regression. If `buildContext()` succeeds, the child gets strictly more context than before (an improvement from zero).

---

## D3 — Make Memory.buildContext() Canonical for Normal Path

### Problem

**File**: `packages/opencode/src/session/prompt.ts`
**Lines**: 1757–1774

The normal path assembles memory from three separate calls:

```ts
// Line 1766-1770:
;[recall, workingMem] =
  yield *
  Effect.all([
    Effect.promise(() => SystemPrompt.recall(Instance.project.id, sessionID, lastUserText)),
    Effect.promise(() => SystemPrompt.projectWorkingMemory(Instance.project.id)),
  ])
// Line 1774:
obs = yield * Effect.promise(() => SystemPrompt.observations(sessionID))
```

Meanwhile, `Memory.buildContext()` in `provider.ts:53` does the same composition in a single call — but has zero callers in the live codebase.

### Design

**Choice**: Replace the `step === 1` scattered calls with a single `Memory.buildContext()` call for `recall` and `workingMem`. Keep the per-turn `obs` reload via `SystemPrompt.observations()` separately.

**Alternatives considered**:

- Replace ALL three calls with `Memory.buildContext()` called every turn → rejected: `buildContext()` loads recall and working memory, which are stable per-session. Loading them every turn wastes tokens and DB reads.
- Remove `SystemPrompt.recall()` and `SystemPrompt.projectWorkingMemory()` entirely → rejected: they still serve as the underlying functions `buildContext()` uses. They are utility functions, not dead code.

**Rationale**: `Memory.buildContext()` returns the pre-formatted, token-budgeted strings ready for injection. Calling it once at `step === 1` replaces the two parallel calls and adds semantic recall automatically. Observations are loaded every turn because they change during the session (observer fires between turns).

### Before / After

```ts
// prompt.ts lines 1757-1774 — BEFORE:
if (step === 1) {
  const lastUserText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .trim()
  ;[recall, workingMem] =
    yield *
    Effect.all([
      Effect.promise(() => SystemPrompt.recall(Instance.project.id, sessionID, lastUserText)),
      Effect.promise(() => SystemPrompt.projectWorkingMemory(Instance.project.id)),
    ])
}
// Load observations every turn
obs = yield * Effect.promise(() => SystemPrompt.observations(sessionID))

// prompt.ts — AFTER:
if (step === 1) {
  const lastUserText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .trim()

  const mem =
    yield *
    Effect.promise(() =>
      Memory.buildContext({
        scope: { type: "thread", id: sessionID },
        ancestorScopes: [{ type: "project", id: Instance.project.id }],
        semanticQuery: lastUserText,
      }),
    )
  recall = mem.semanticRecall
  workingMem = mem.workingMemory
}
// Load observations every turn — they change between turns
obs = yield * Effect.promise(() => SystemPrompt.observations(sessionID))
```

### Key Difference from D2

D2 uses `buildContext()` in the fork path. D3 uses it in the normal path. Together, they make `buildContext()` the sole entry point for recall + working memory across both paths. `SystemPrompt.observations()` remains separate because it wraps OM formatting with continuation hints, retrieval instructions, and observation groups — formatting that `buildContext()` does not replicate (it uses the simpler `formatObservations()` from provider.ts). To preserve the rich observation formatting, observations continue to flow through `SystemPrompt.observations()`.

### Failure Semantics

`Memory.buildContext()` returns `undefined` for each field on failure. This is identical to the current behavior where `SystemPrompt.recall()` and `SystemPrompt.projectWorkingMemory()` return `undefined` on error.

---

## D4 — Wire Durable Fork Context

### Problem

**File**: `packages/opencode/src/tool/task.ts` line 123
**File**: `packages/opencode/src/memory/handoff.ts`

`Memory.writeForkContext()` and `Memory.getForkContext()` exist (provider.ts:138-148, handoff.ts:33-67) but have zero callers. Fork context flows through `forks` Map (prompt.ts:79) — lost on restart.

### Design

**Choice**: After stashing in the transient map (line 123), also write to DB via `Memory.writeForkContext()`. On the consumer side (D1/D2 fork block), if `forks.get(sessionID)` returns `undefined`, attempt `Memory.getForkContext()` as a restart-safe fallback.

### Before / After

```ts
// tool/task.ts lines 119-124 — BEFORE:
if (isFork) {
  const parent = SessionPrompt.getActiveContext(ctx.sessionID)
  if (parent) {
    log.info("fork subagent", { parent: ctx.sessionID, child: session.id })
    SessionPrompt.setForkContext(session.id, parent)
  }
}

// tool/task.ts — AFTER:
if (isFork) {
  const parent = SessionPrompt.getActiveContext(ctx.sessionID)
  if (parent) {
    log.info("fork subagent", { parent: ctx.sessionID, child: session.id })
    SessionPrompt.setForkContext(session.id, parent)
    // Durable write — survives process restart
    Memory.writeForkContext({
      session_id: session.id,
      parent_session_id: ctx.sessionID,
      context: JSON.stringify(parent),
    })
  }
}
```

```ts
// prompt.ts fork block — AFTER (inside D2):
let fork = forks.get(sessionID)
if (!fork && step === 1) {
  // Restart-safe fallback: load from DB
  const durable = Memory.getForkContext(sessionID)
  if (durable) {
    try {
      fork = JSON.parse(durable.context) as SessionPrompt.ForkContext
    } catch {
      log.warn("corrupt fork context", { sessionID })
    }
  }
}
if (fork && step === 1) {
  forks.delete(sessionID)
  // ... D2 memory loading + handle.process ...
}
```

### Module Dependencies

`task.ts`: add import `{ Memory } from "@/memory"`.
`prompt.ts`: already imports `Memory`.

### Failure Semantics

`Memory.writeForkContext()` uses `Database.transaction()` — if the DB write fails, the transient map still holds the context. The child works on happy path; restart recovery is best-effort. `JSON.parse` failure is caught and logged — child falls through to normal path.

---

## D5 — Fix activeContexts Memory Leak

### Problem

**File**: `packages/opencode/src/session/prompt.ts`
**Line**: 80, 1833

`activeContexts` (line 80: `new Map<string, ForkContext>()`) grows every turn at line 1833 but is never cleaned up.

### Design

**Choice**: Delete the entry when the session loop exits (the `break` at line 1507–1508 or the implicit return at line 1883). Add a `clearActiveContext()` export for external cleanup.

### Before / After

```ts
// prompt.ts — ADD export after line 88:
export function clearActiveContext(sessionID: string) {
  activeContexts.delete(sessionID)
}

// prompt.ts — ADD cleanup before the loop return at line 1883:
activeContexts.delete(sessionID)
return yield * lastAssistant(sessionID)
```

Additionally, clean up after the fork block consumes the context:

```ts
// Inside the fork block (D2), after forks.delete(sessionID):
activeContexts.delete(sessionID)
```

### Failure Semantics

If `activeContexts.delete()` is called twice (once in fork block, once at loop exit), no harm — Map.delete on a missing key is a no-op.

---

## D6 — Remove observeSafe()

### Problem

**File**: `packages/opencode/src/session/om/record.ts`
**Lines**: 119–140

`observeSafe()` wraps the old `upsert+seal` pattern in a transaction. But V2 moved observation writes to `addBuffer+activate` inside an async closure (prompt.ts lines 1571–1607). `observeSafe()` has zero callers. It is architecturally obsolete.

### Design

**Choice**: Delete lines 119–140 from `record.ts`.

**Alternatives considered**:

- Keep as `@deprecated` → rejected: it is not just unused, it targets a pattern that no longer exists. The `addBuffer+activate` path has its own atomicity guarantee (seal only advances after buffer write at lines 1596-1597). Keeping dead code invites confusion.

### Before / After

```ts
// record.ts lines 119-140 — DELETE entirely:
/**
 * Durability-safe observation write + seal advance.
 * ...
 */
export function observeSafe(sid: SessionID, rec: ObservationRecord, sealAt: number): void {
  // ...
}
```

Add a comment at the deletion site:

```ts
// observeSafe() was removed in V3 — the addBuffer+activate path (prompt.ts)
// provides its own durability guarantee: seal advances only after buffer write.
```

### Failure Semantics

None — zero callers.

---

## D7 — Auto-index OM Observations at Session End

### Problem

`memory_artifacts` only grows when AutoDream runs. There is no per-session harvesting. If AutoDream is disabled or fails, project memory never accumulates.

### Design

**Choice**: When the `runLoop` exits (the `break` paths at lines 1507 and 1879), check if the session has observations and index them as a `memory_artifact`.

### Before / After

```ts
// prompt.ts — ADD before the return at line 1883:

// V3: auto-index session observations into memory_artifacts
const final = OM.get(sessionID)
if (final?.observations) {
  try {
    Memory.indexArtifact({
      scope_type: "project",
      scope_id: Instance.project.id,
      type: "observation",
      title: `Session ${sessionID.slice(0, 8)} observations`,
      content: final.reflections ?? final.observations,
      topic_key: `session/${sessionID}/observations`,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
  } catch {
    log.warn("failed to index session observations", { sessionID })
  }
}
```

`Memory.indexArtifact()` delegates to `SemanticRecall.index()` which inserts into `memory_artifacts` + `memory_artifacts_fts`. The `topic_key` uses the session ID, so re-runs of the same session upsert rather than duplicate.

### Failure Semantics

Try/catch — failure is logged and does not block session teardown. The artifact is write-once-per-session via the `topic_key` constraint. If `final.observations` is null (observer never fired), no artifact is created.

---

## D8 — Add Working Memory Guidance to System Prompt

### Problem

The `update_working_memory` tool exists and is registered, but agents rely solely on the tool description to know when to use it. No system prompt instruction tells agents when to proactively persist facts.

### Design

**Choice**: Add a constant instruction block in `system.ts` and inject it after the working memory block in `llm.ts`.

### Before / After

```ts
// system.ts — ADD export:
export const WORKING_MEMORY_GUIDANCE =
  `When you make a significant architectural decision, technology choice, ` +
  `or discover a key constraint or user preference for this project, call \`update_working_memory\` ` +
  `with scope="project" to persist it for future sessions. Use scope="thread" for facts ` +
  `relevant only to the current conversation.`
```

```ts
// llm.ts line 141 — AFTER existing workingMemory injection:
if (input.workingMemory) {
  system.splice(input.recall ? 3 : 2, 0, input.workingMemory)
  // V3: inject agent guidance after working memory block
  const idx = system.indexOf(input.workingMemory)
  if (idx !== -1) system.splice(idx + 1, 0, SystemPrompt.WORKING_MEMORY_GUIDANCE)
}
```

**Alternatively** (simpler — append to the working memory wrapper):

```ts
// system.ts wrapWorkingMemory() — AFTER:
export function wrapWorkingMemory(body: string): string {
  return [
    `<working-memory>\n${body}\n</working-memory>`,
    `IMPORTANT: The working memory above contains stable facts, goals, and decisions for this project. Use it as authoritative context when answering questions about the project state.`,
    WORKING_MEMORY_GUIDANCE,
  ].join("\n\n")
}
```

**Decision**: Use the simpler approach — append to `wrapWorkingMemory()`. This keeps the guidance co-located with the working memory block and avoids index arithmetic in `llm.ts`.

### Failure Semantics

If no working memory exists (new project), `wrapWorkingMemory()` is never called, so the guidance is never injected. Agents still have the tool description as fallback. No regression.

---

## D9 — Remove Engram.ensure() from run()

### Problem

**File**: `packages/opencode/src/dream/index.ts`
**Line**: 95

`run()` (manual `/dream` trigger) calls `await Engram.ensure()` and returns an error message if Engram is not installed. This blocks `/dream` for users without the Go binary, even though the daemon path at `idle()` already removed this gate in V2 (line 120–123 comments confirm this).

### Design

**Choice**: Remove the `Engram.ensure()` call and the early return. Let `run()` proceed to the daemon path directly.

### Before / After

```ts
// dream/index.ts lines 94-96 — BEFORE:
export async function run(focus?: string): Promise<string> {
  const available = await Engram.ensure()
  if (!available) return "Engram not available. Install with: brew install gentleman-programming/tap/engram"

// dream/index.ts — AFTER:
export async function run(focus?: string): Promise<string> {
  // V3: Engram.ensure() gate removed. Manual /dream uses the daemon path
  // which requires only native LightCode memory, not the Engram binary.
```

### Failure Semantics

If the daemon socket is unavailable, `fetch()` at line 105 will throw and be caught by the existing try/catch at line 98. The error message is more informative than the old "Engram not available" message.

---

## D10 — Engram Audit and Isolation

### Problem

Remaining Engram references need classification and documentation.

### Design

| File                        | Reference                         | Action                                                                       |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `dream/engram.ts`           | Entire module                     | **Retain** as `@deprecated` compatibility module. Already marked. No change. |
| `dream/index.ts:95`         | `Engram.ensure()`                 | **Remove** (D9)                                                              |
| `dream/index.ts:120-123`    | Comment about V2 removal          | **Retain** — accurate documentation                                          |
| `cli/cmd/tui/app.tsx`       | `Engram.setRegistrar(...)`        | **Retain** — TUI legacy adapter for auto-connecting Engram MCP               |
| `session/system.ts:183`     | `Flag.OPENCODE_MEMORY_USE_ENGRAM` | **Retain** — feature flag for rollback to Engram recall path                 |
| `session/system.ts:217-248` | `recallEngram()`                  | **Retain** — guarded by feature flag, provides rollback capability           |

No new code changes beyond D9. The audit confirms Engram is properly isolated behind feature flags and deprecation markers.

---

## Data Flow

### Normal Path (after D3):

```
User Message
    │
    ▼
runLoop step === 1
    │
    ├──→ Memory.buildContext(thread, project, query)
    │         ├── WorkingMemory.getForScopes()  → workingMem
    │         ├── OM.get(sessionID)              → (used internally)
    │         └── SemanticRecall.search()        → recall
    │
    ├──→ SystemPrompt.observations(sessionID)   → obs  (every turn)
    │
    ▼
LLM.stream({ system, recall, obs, workingMem })
    │
    ▼
system[0] = agent prompt + env + skills + instructions
system[1] = observations (or <!-- ctx --> sentinel)
system[2] = recall
system[3] = workingMemory + guidance
system[N] = volatile (model + date)
```

### Fork Path (after D1 + D2 + D4):

```
Parent: activeContexts.set(sessionID, { system, tools, messages })
           │
           ▼
task.ts: SessionPrompt.setForkContext(child.id, parent)
         Memory.writeForkContext(child.id, parent.id, JSON.stringify(parent))
           │
           ▼
Child runLoop step === 1:
    │
    ├──→ forks.get(sessionID)  ||  Memory.getForkContext(sessionID)  → fork
    │
    ├──→ Memory.buildContext(thread=child, project, query)
    │         ├── recall
    │         ├── workingMem
    │         └── obs
    │
    ▼
handle.process({ fork.system, fork.messages ++ childMsgs, recall, obs, workingMem })
```

### Session End (after D5 + D7):

```
runLoop exits (break)
    │
    ├──→ activeContexts.delete(sessionID)      (D5)
    │
    ├──→ OM.get(sessionID)                     (D7)
    │     └── Memory.indexArtifact(observations) → memory_artifacts + FTS5
    │
    ▼
return lastAssistant(sessionID)
```

---

## File Changes Summary

| File                       | Action | Designs            | Description                                                                                  |
| -------------------------- | ------ | ------------------ | -------------------------------------------------------------------------------------------- |
| `src/session/prompt.ts`    | Modify | D1, D2, D3, D5, D7 | Fix step guard, load fork memory, canonical buildContext, cleanup activeContexts, auto-index |
| `src/tool/task.ts`         | Modify | D4                 | Write durable fork context after stash                                                       |
| `src/session/om/record.ts` | Modify | D6                 | Remove `observeSafe()`, add explanatory comment                                              |
| `src/session/system.ts`    | Modify | D8                 | Add `WORKING_MEMORY_GUIDANCE` constant, update `wrapWorkingMemory()`                         |
| `src/dream/index.ts`       | Modify | D9                 | Remove `Engram.ensure()` gate from `run()`                                                   |

No new files. No deleted files. No schema changes.

---

## Module Dependencies

```
prompt.ts ──imports──→ Memory (already imported)
                       Instance (already imported)
                       OM (already imported)

task.ts ──imports──→ Memory (NEW import)
                     SessionPrompt (already imported)

system.ts ──exports──→ WORKING_MEMORY_GUIDANCE (NEW constant)

llm.ts ──no changes──  (guidance injected via wrapWorkingMemory)

record.ts ──deletes──→ observeSafe() (zero downstream impact)

dream/index.ts ──removes──→ Engram.ensure() call (retains Engram import for other paths)
```

No circular dependencies introduced. The only new import is `Memory` in `task.ts`.

---

## Testing Strategy

| Design | Layer       | Test Approach                                                                                                                                                                               |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1     | Unit        | Test that `step === 1` guard is reachable: mock `forks.get()` to return a value, assert fork block executes. Verify `forks.delete()` is called.                                             |
| D2     | Unit        | Assert `Memory.buildContext()` is called inside fork block with correct scope/ancestorScopes. Verify `recall`, `obs`, `workingMem` are non-undefined when buildContext returns values.      |
| D3     | Unit        | Assert `Memory.buildContext()` is called at step===1 in normal path. Verify `SystemPrompt.recall()` and `SystemPrompt.projectWorkingMemory()` are no longer called directly from prompt.ts. |
| D4     | Integration | Write fork context via `Memory.writeForkContext()`, restart (clear transient map), read via `Memory.getForkContext()`, verify round-trip.                                                   |
| D5     | Unit        | Assert `activeContexts.delete(sessionID)` is called when loop exits. Assert Map size is 0 after session completes.                                                                          |
| D6     | Static      | Verify `observeSafe` has zero references in codebase (grep). Typecheck passes.                                                                                                              |
| D7     | Integration | Run a session with observations, verify `memory_artifacts` has a row with `topic_key = "session/{id}/observations"` after session ends.                                                     |
| D8     | Unit        | Assert `WORKING_MEMORY_GUIDANCE` text appears in the output of `wrapWorkingMemory()`.                                                                                                       |
| D9     | Unit        | Call `Dream.run()` without Engram binary. Assert it does not return the "Engram not available" string.                                                                                      |
| D10    | Static      | Grep for `Engram` references. Verify each is either deprecated, feature-flagged, or explicitly retained.                                                                                    |

All tests run from `packages/opencode` (not repo root — see AGENTS.md guard `do-not-run-tests-from-root`).

---

## Migration Strategy

No migration required.

- No schema changes — V3 uses the existing V2 tables.
- No data format changes — `memory_artifacts`, `memory_fork_contexts`, `observation` tables accept the same shapes.
- `observeSafe()` removal is safe — zero callers.
- `Engram.ensure()` removal is non-breaking — the daemon path already works without it.
- The `WORKING_MEMORY_GUIDANCE` constant is additive — it does not change the structure of the system prompt array, only the content of the working memory wrapper.

---

## Open Questions

- [ ] **D3 observation format divergence**: `Memory.buildContext()` uses `formatObservations()` (simple token-budgeted truncation) while `SystemPrompt.observations()` uses `wrapObservations()` (adds continuation hints, context instructions, retrieval instructions). Should `buildContext()` be upgraded to use the richer formatting, or is the current split (buildContext for recall+WM, SystemPrompt.observations for obs) the correct long-term architecture?
- [ ] **D7 deduplication**: If AutoDream also indexes session observations, we may get duplicates. The `topic_key` constraint prevents exact duplicates within the same session, but AutoDream uses different topic keys. Should we add a `normalized_hash` check to prevent semantic duplicates across indexing paths?
- [ ] **D4 fork context size**: `JSON.stringify(parent)` includes the full system prompt and tool definitions. For large tool sets this could be several KB. Should we compress or summarize the fork context before DB persistence?
