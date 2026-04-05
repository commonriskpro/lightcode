# LightCode Memory Core V2 — Technical Design

**Status**: Active
**Date**: 2026-04-05
**Depends On**: `LIGHTCODE_MEMORY_CORE_V2_SPEC.md`, `LIGHTCODE_MEMORY_CORE_V1_DESIGN.md`
**V1 Baseline Commit**: `efa82ac`

---

## Table of Contents

1. [Technical Approach](#technical-approach)
2. [Design 1 — OM Durability Fix](#design-1--om-durability-fix)
3. [Design 2 — Dream Output Capture](#design-2--dream-output-capture)
4. [Design 3 — Fix recallNative() Query](#design-3--fix-recallnative-query)
5. [Design 4 — Wire Memory.buildContext() into runLoop](#design-4--wire-memorybuildcontext-into-runloop)
6. [Design 5 — Add update_working_memory Agent Tool](#design-5--add-update_working_memory-agent-tool)
7. [Design 6 — Recall Query Improvement](#design-6--recall-query-improvement)
8. [Design 7 — Engram Compatibility Isolation](#design-7--engram-compatibility-isolation)
9. [File Changes Summary](#file-changes-summary)
10. [Module Dependency Changes](#module-dependency-changes)
11. [Migration Strategy](#migration-strategy)
12. [Testing Strategy](#testing-strategy)
13. [Open Questions](#open-questions)

---

## Technical Approach

V2 is a pure **wiring phase** — no new tables, no schema changes, no new abstractions. Every V1 function that was defined but never called gets connected to its intended call site. The seven designs below address the seven gaps identified in the V2 spec, in dependency order:

1. Fix atomicity of the OM buffer path (prerequisite for everything else)
2. Capture dream output and persist via native memory
3. Fix the FTS5 query so recall returns results
4. Wire `Memory.buildContext()` into the LLM system prompt
5. Expose working memory writes to the agent via a tool
6. Improve recall query construction for better semantic matches
7. Isolate the Engram dependency so autodream works without it

The guiding principle: **change the wiring, not the plumbing**. The V1 schema, services, and contracts remain unchanged.

---

## Design 1 — OM Durability Fix

### Problem

In `prompt.ts` lines 1550–1603, the "buffer" signal path has an atomicity defect:

```
Current broken sequence:
1. OMBuf.check() → "buffer"
2. OMBuf.seal(sessionID, sealAt)          ← line 1565, BEFORE async observer
3. OM.trackObserved(sessionID, ids)       ← line 1566–1569, BEFORE async observer
4. (async () => { Observer.run() → OM.addBuffer() })()  ← fire-and-forget
5. OMBuf.setInFlight(sessionID, p)        ← line 1602
```

If `Observer.run()` fails at step 4, the seal and trackObserved at steps 2–3 have already advanced. Those messages are permanently marked "observed" but no observation record was written. They are lost from the OM window forever.

### Solution

Move `seal` + `trackObserved` **inside** the async promise body, after `Observer.run()` and `OM.addBuffer()` succeed. On failure, no state advances.

### Before (prompt.ts ~lines 1550–1603)

```ts
if (sig === "buffer") {
  if (!OMBuf.getInFlight(sessionID)) {
    const rec = OM.get(sessionID)
    const boundary = rec?.last_observed_at ?? 0
    const obsIds = new Set<string>(/* ... */)
    const sealed = OMBuf.sealedAt(sessionID)
    const unobserved = msgs.filter(/* ... */)
    const sealAt = unobserved.at(-1)?.info.time?.created ?? 0
    if (sealAt > 0) OMBuf.seal(sessionID, sealAt) // ❌ premature
    OM.trackObserved(sessionID, unobserved.map(/* ... */)) // ❌ premature
    const p = (async () => {
      OMBuf.setObserving(true)
      try {
        const result = await Observer.run({ sid: sessionID, msgs: unobserved /* ... */ })
        if (result) {
          OM.addBuffer({
            /* ... */
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

### After (prompt.ts ~lines 1550–1603)

```ts
if (sig === "buffer") {
  if (!OMBuf.getInFlight(sessionID)) {
    const rec = OM.get(sessionID)
    const boundary = rec?.last_observed_at ?? 0
    const obsIds = new Set<string>(rec?.observed_message_ids ? (JSON.parse(rec.observed_message_ids) as string[]) : [])
    const sealed = OMBuf.sealedAt(sessionID)
    const unobserved = msgs.filter(
      (m) =>
        (m.info.time?.created ?? 0) > boundary &&
        !obsIds.has(m.info.id) &&
        (sealed === 0 || (m.info.time?.created ?? 0) > sealed),
    )
    const sealAt = unobserved.at(-1)?.info.time?.created ?? 0
    // ✅ seal + trackObserved moved INSIDE async body, after successful write
    const p = (async () => {
      OMBuf.setObserving(true)
      try {
        const result = await Observer.run({
          sid: sessionID,
          msgs: unobserved,
          prev: rec?.observations ?? undefined,
          priorCurrentTask: rec?.current_task ?? undefined,
        })
        if (!result) return // no seal advance on failure
        OM.addBuffer({
          id: ulid(),
          session_id: sessionID,
          observations: result.observations,
          message_tokens: tok,
          observation_tokens: result.observations.length >> 2,
          starts_at: boundary,
          ends_at: unobserved.at(-1)?.info.time?.created ?? Date.now(),
          first_msg_id: unobserved[0]?.info.id ?? null,
          last_msg_id: unobserved.at(-1)?.info.id ?? null,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        // ✅ Only advance state after successful DB write
        if (sealAt > 0) OMBuf.seal(sessionID, sealAt)
        OM.trackObserved(
          sessionID,
          unobserved.map((m) => m.info.id),
        )
      } catch (err) {
        log.error("background observer failed", { err })
        // ✅ On error: seal NOT advanced, messages remain unobserved for retry
      } finally {
        OMBuf.setObserving(false)
        OMBuf.clearInFlight(sessionID)
      }
    })()
    OMBuf.setInFlight(sessionID, p)
  }
}
```

### Affected Files

| File                                      | Lines      | Change                                          |
| ----------------------------------------- | ---------- | ----------------------------------------------- |
| `packages/opencode/src/session/prompt.ts` | ~1564–1602 | Move `seal` + `trackObserved` inside async body |

### observeSafe() Scope

The existing `observeSafe()` in `record.ts` (lines 129–140) wraps `upsert` + `seal` in a DB transaction for the **activate/upsert** path. For the buffer path, we do NOT need a DB transaction because `addBuffer()` and `seal()` operate on different storage layers (DB vs in-memory map). The fix is purely about ordering: don't advance in-memory state until the DB write succeeds. `observeSafe()` remains available for the activate path — no changes needed to that function.

### Architecture Decision

| Option                                                         | Tradeoff                                                                       | Decision     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| Wrap `addBuffer` + `seal` in `observeSafe()`-style transaction | Overkill — seal is in-memory, not DB. Transaction provides no extra guarantee. | **Rejected** |
| Move seal/track into async body after success                  | Simple, correct ordering, no new abstractions                                  | **Chosen**   |
| Create `observeBufferSafe()` wrapper                           | Over-engineering for a pure ordering fix                                       | **Rejected** |

---

## Design 2 — Dream Output Capture

### Problem

`dream/daemon.ts` creates a dream session, fires a prompt, polls until idle, then writes a timestamp — but never reads the dream LLM output. `persistConsolidation()` in `dream/index.ts:164` is defined but never called.

### Solution

After the daemon poll loop confirms idle, the **parent process** (`dream/index.ts` `idle()`) reads the dream session output and calls `persistConsolidation()`.

Two options were evaluated:

| Option                                                                 | Tradeoff                                                                         | Decision     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ |
| Daemon reads output and sends via socket response                      | Daemon needs access to `Session.messages()` which runs in parent process context | **Rejected** |
| Parent (`idle()`) reads dream session after daemon confirms completion | Simple — idle() already runs in the correct process context with DB access       | **Chosen**   |

### Implementation

#### daemon.ts — Return sessionID in /trigger response

The daemon already returns `{ ok: true }` from `/trigger`. Modify `doDream()` to store the completed `sessionID` so `/status` returns it:

**Before** (`daemon.ts:117–119`):

```ts
lastCompleted = Date.now()
lastError = undefined
console.log("dream completed", { sessionID })
```

**After** (`daemon.ts:117–120`):

```ts
lastCompleted = Date.now()
lastSession = sessionID
lastError = undefined
console.log("dream completed", { sessionID })
```

Add at module scope (line 16):

```ts
let lastSession: string | undefined
```

Modify `/status` response (line 148):

```ts
return Response.json({ dreaming, lastCompleted, lastSession, lastError })
```

#### dream/index.ts — idle() reads output and persists

**Before** (`index.ts:119–145`, `idle()`):

```ts
async function idle(sid: string): Promise<void> {
  const available = await Engram.ensure()
  if (!available) return
  // ...config...
  try {
    const sock = await ensureDaemon(Instance.directory)
    const obs = await summaries(sid)
    await fetch("http://localhost/trigger", { unix: sock /* ... */ })
    log.info("dream triggered via daemon", { sock })
  } catch (err) {
    /* ... */
  }
}
```

**After** (`index.ts:119–170`, `idle()`):

```ts
async function idle(sid: string): Promise<void> {
  const { Config } = await import("../config/config")
  const cfg = await Config.get()
  if (cfg.experimental?.autodream === false) return
  const model = cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"

  const url = Server.url?.toString() ?? process.env.LIGHTCODE_SERVER_URL
  if (url) process.env.LIGHTCODE_SERVER_URL = url

  try {
    const sock = await ensureDaemon(Instance.directory)
    const obs = await summaries(sid)
    // @ts-ignore — Bun-native unix socket fetch option
    const res = await fetch("http://localhost/trigger", {
      unix: sock,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, obs }),
    })
    const data = (await res.json()) as { ok: boolean }
    if (!data.ok) return
    log.info("dream triggered via daemon", { sock })

    // Poll daemon status until dream completes, then capture output
    await captureDreamOutput(sock)
  } catch (err) {
    log.warn("autodream daemon unavailable", { error: err instanceof Error ? err.message : String(err) })
  }
}

async function captureDreamOutput(sock: string): Promise<void> {
  // Poll daemon /status for up to 10 min
  for (let i = 0; i < 300; i++) {
    await Bun.sleep(2_000)
    try {
      // @ts-ignore — Bun-native unix socket fetch option
      const r = await fetch("http://localhost/status", { unix: sock })
      const data = (await r.json()) as { dreaming: boolean; lastSession?: string }
      if (data.dreaming) continue
      if (!data.lastSession) return

      // Read dream session output
      const msgs = await Session.messages({ sessionID: data.lastSession as any })
      const last = msgs.findLast((m) => m.info.role === "assistant" && m.parts.some((p) => p.type === "text"))
      if (!last) return
      const text = last.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (!text.trim()) return

      // Persist to native memory
      persistConsolidation(
        Instance.project.id,
        `Dream consolidation ${new Date().toISOString().split("T")[0]}`,
        text,
        "dream/consolidation",
      )
      return
    } catch {
      continue
    }
  }
}
```

### Affected Files

| File                                    | Lines               | Change                                                    |
| --------------------------------------- | ------------------- | --------------------------------------------------------- |
| `packages/opencode/src/dream/daemon.ts` | 14–16, 117–119, 148 | Add `lastSession` tracking, expose in `/status`           |
| `packages/opencode/src/dream/index.ts`  | 119–145             | Remove `Engram.ensure()` gate, add `captureDreamOutput()` |

---

## Design 3 — Fix recallNative() Query

### Problem

`system.ts:165` passes the project UUID (`pid`) as the first argument to `Memory.searchArtifacts()`:

```ts
const artifacts = Memory.searchArtifacts(pid, scopes, 20)
```

`pid` is a ULID like `"01JNX2abc..."` — it will never match any natural language content in FTS5.

### Solution

Change `recall()` to accept a semantic query derived from the last user message. The caller in `prompt.ts` already knows the last user message text.

### Before (system.ts:150–173)

```ts
export async function recall(pid: string, sessionId?: string): Promise<string | undefined> {
  if (Flag.OPENCODE_MEMORY_USE_ENGRAM) {
    return recallEngram(pid)
  }
  return recallNative(pid, sessionId)
}

async function recallNative(pid: string, sessionId?: string): Promise<string | undefined> {
  try {
    const scopes = [
      ...(sessionId ? [{ type: "thread" as const, id: sessionId }] : []),
      { type: "project" as const, id: pid },
      { type: "user" as const, id: "default" },
    ]
    const artifacts = Memory.searchArtifacts(pid, scopes, 20) // ❌ UUID as query
    // ...
```

### After (system.ts:150–185)

```ts
export async function recall(pid: string, sessionId?: string, query?: string): Promise<string | undefined> {
  if (Flag.OPENCODE_MEMORY_USE_ENGRAM) {
    return recallEngram(pid)
  }
  return recallNative(pid, sessionId, query)
}

async function recallNative(pid: string, sessionId?: string, query?: string): Promise<string | undefined> {
  try {
    const scopes = [
      ...(sessionId ? [{ type: "thread" as const, id: sessionId }] : []),
      { type: "project" as const, id: pid },
      { type: "user" as const, id: "default" },
    ]

    // Build semantic query: prefer explicit query, fall back to OM context
    const fts = query ?? buildRecallQuery(pid, sessionId)
    if (!fts) return undefined

    const artifacts = Memory.searchArtifacts(fts, scopes, 20) // ✅ real query
    if (!artifacts.length) return undefined
    const body = SemanticRecall.format(artifacts, 2000)
    if (!body) return undefined
    return wrapRecall(capRecallBody(body))
  } catch {
    return undefined
  }
}

function buildRecallQuery(pid: string, sessionId?: string): string | undefined {
  // 1. Try OM record context (current_task, suggested_continuation)
  if (sessionId) {
    const rec = OM.get(sessionId as SessionID)
    if (rec?.current_task) return rec.current_task
    if (rec?.suggested_continuation) return rec.suggested_continuation
  }
  // 2. Fall back to project name
  try {
    return Instance.project.name || undefined
  } catch {
    return undefined
  }
}
```

### Caller Change (prompt.ts ~line 1752)

**Before**:

```ts
recall = yield * Effect.promise(() => SystemPrompt.recall(Instance.project.id))
```

**After**:

```ts
const lastText = msgs
  .findLast((m) => m.info.role === "user")
  ?.parts.filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
  .map((p) => p.text)
  .join(" ")
recall = yield * Effect.promise(() => SystemPrompt.recall(Instance.project.id, sessionID, lastText || undefined))
```

### Affected Files

| File                                      | Lines   | Change                                             |
| ----------------------------------------- | ------- | -------------------------------------------------- |
| `packages/opencode/src/session/system.ts` | 150–173 | Add `query` param, add `buildRecallQuery()` helper |
| `packages/opencode/src/session/prompt.ts` | ~1752   | Pass last user message text to `recall()`          |

---

## Design 4 — Wire Memory.buildContext() into runLoop

### Problem

`prompt.ts` calls `SystemPrompt.observations(sid)` and `SystemPrompt.recall(pid)` individually. `Memory.buildContext()` in `provider.ts` is never called. Working memory is never injected into the system prompt.

### Solution

Replace the individual calls with a single `Memory.buildContext()` call that composes all layers. The `MemoryContext` result provides `observations`, `semanticRecall`, and `workingMemory` — all formatted and token-budgeted.

### Architecture Decision

| Option                                                                | Tradeoff                                                                                                                        | Decision                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Replace both calls with `buildContext()` completely                   | Clean, single entry point. But `buildContext()` is async and observations need per-turn refresh while recall is session-frozen. | **Rejected** — recall must stay session-scoped (step 1 only) while observations refresh every turn |
| Keep individual calls but ADD working memory injection alongside them | Incremental, low risk, preserves existing cache breakpoint semantics in `llm.ts`                                                | **Chosen**                                                                                         |
| Call `buildContext()` only on step 1, cache observations separately   | Adds complexity for minimal gain                                                                                                | **Rejected**                                                                                       |

The existing `llm.ts` cache breakpoint structure is:

```
system[0] = provider prompt + env + skills + instructions
system[1] = observations (BP3 slot — stable between Observer cycles)
system[2] = recall (session-frozen)
system[last] = volatile (model ID + date)
```

Adding working memory needs to go into a stable slot. We inject it at system[1] alongside observations — it changes infrequently and is small (~200–500 tokens).

### Implementation (prompt.ts ~lines 1751–1810)

**Before**:

```ts
if (step === 1) {
  recall = yield * Effect.promise(() => SystemPrompt.recall(Instance.project.id))
}
obs = yield * Effect.promise(() => SystemPrompt.observations(sessionID))
```

**After**:

```ts
if (step === 1) {
  const lastText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
    .map((p) => p.text)
    .join(" ")
  recall = yield * Effect.promise(() => SystemPrompt.recall(Instance.project.id, sessionID, lastText || undefined))
}
obs = yield * Effect.promise(() => SystemPrompt.observations(sessionID))

// Working memory: compose thread + project scope into a single block
const wm = WorkingMemory.getForScopes({ type: "thread", id: sessionID }, [{ type: "project", id: Instance.project.id }])
const wmBlock = WorkingMemory.format(wm, 2000)
if (wmBlock) {
  obs = (obs ?? "") + "\n\n" + `<working-memory>\n${wmBlock}\n</working-memory>`
}
```

This keeps the existing `observations` slot in the system prompt and appends working memory to it. The `llm.ts` cache structure is preserved: `system[1]` remains the "observations + working memory" block (BP3), and `system[2]` remains recall.

### Import Addition (prompt.ts)

Add to existing imports:

```ts
import { WorkingMemory } from "@/memory"
```

### Affected Files

| File                                      | Lines               | Change                                             |
| ----------------------------------------- | ------------------- | -------------------------------------------------- |
| `packages/opencode/src/session/prompt.ts` | ~1751–1757, imports | Add working memory injection, pass query to recall |

---

## Design 5 — Add update_working_memory Agent Tool

### Problem

`Memory.setWorkingMemory()` exists but no agent tool exposes it. Agents cannot persist structured facts during a session.

### Solution

Create `packages/opencode/src/tool/memory.ts` exposing `update_working_memory`. Register in `registry.ts`.

### Tool Definition

**New file: `packages/opencode/src/tool/memory.ts`**

```ts
import z from "zod"
import { Tool } from "./tool"
import { Memory } from "../memory"

export const MemoryTool = Tool.define("update_working_memory", {
  description:
    "Store or update a structured fact, preference, goal, or constraint in working memory. " +
    "Facts persist across turns within this thread and optionally across the project. " +
    "Use this proactively when you discover information that should be remembered.",
  parameters: z.object({
    scope: z
      .enum(["thread", "project"])
      .describe("'thread' for session-local facts, 'project' for cross-session facts"),
    key: z
      .string()
      .describe("Short identifier for the fact (e.g. 'preferred_language', 'test_framework', 'db_schema')"),
    value: z.string().describe("The content to remember. Use markdown for structured data."),
  }),
  async execute(params, ctx) {
    const ref =
      params.scope === "thread"
        ? { type: "thread" as const, id: ctx.sessionID }
        : { type: "project" as const, id: ctx.sessionID.split("/")[0] ?? ctx.sessionID }
    Memory.setWorkingMemory(ref, params.key, params.value)
    return {
      title: `Updated ${params.scope} memory: ${params.key}`,
      output: `Working memory key "${params.key}" updated in ${params.scope} scope.`,
      metadata: { scope: params.scope, key: params.key },
    }
  },
})
```

**Scope resolution note**: For `"project"` scope, we need the project ID (not session ID). The caller context in `prompt.ts` provides `Instance.project.id`, but tools receive only `ctx.sessionID`. Two approaches:

| Option                                           | Tradeoff                                           | Decision                                             |
| ------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| Add `projectId` to `Tool.Context`                | Clean, but changes tool interface across all tools | **Chosen** — minimal change, adds one optional field |
| Parse project from session metadata at tool time | Fragile, requires DB query                         | **Rejected**                                         |

Add to `Tool.Context` (in `tool/tool.ts` line 18):

```ts
export type Context<M extends Metadata = Metadata> = {
  // ...existing fields...
  projectId?: string // project ID for scope resolution
}
```

And in `prompt.ts` `resolveTools` context builder (~line 436):

```ts
const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
  // ...existing fields...
  projectId: Instance.project.id,
})
```

Then in `memory.ts`:

```ts
const ref =
  params.scope === "thread"
    ? { type: "thread" as const, id: ctx.sessionID }
    : { type: "project" as const, id: ctx.projectId ?? ctx.sessionID }
```

### Registration (registry.ts)

**Add import** (line ~40):

```ts
import { MemoryTool } from "./memory"
```

**Build tool** (after line 146):

```ts
const memory = yield * build(MemoryTool)
```

**Add to `all` array** (inside the return array, ~line 178):

```ts
defer(memory, "Store persistent facts and preferences in working memory"),
```

### Affected Files

| File                                      | Action     | Description                                |
| ----------------------------------------- | ---------- | ------------------------------------------ |
| `packages/opencode/src/tool/memory.ts`    | **Create** | `update_working_memory` tool               |
| `packages/opencode/src/tool/tool.ts`      | Modify     | Add optional `projectId` to `Tool.Context` |
| `packages/opencode/src/tool/registry.ts`  | Modify     | Import + register MemoryTool               |
| `packages/opencode/src/session/prompt.ts` | Modify     | Pass `projectId` in tool context           |

---

## Design 6 — Recall Query Improvement

### Problem

Even after fixing the UUID-as-query bug (Design 3), the recall results quality needs improvement:

1. Content preview is 300 chars — too short for useful context
2. No project scope priority
3. No weighting by recency

### Solution

Enhance `SemanticRecall.format()` and the search ordering within `recallNative()`.

### Changes

#### semantic-recall.ts — Expand preview (line 292)

**Before**:

```ts
const preview = a.content.length > 300 ? a.content.slice(0, 300) + "…" : a.content
```

**After**:

```ts
const preview = a.content.length > 800 ? a.content.slice(0, 800) + "…" : a.content
```

#### system.ts — Search project scope first, increase limit

In the new `recallNative()` (from Design 3), search project scope first, then user scope:

```ts
async function recallNative(pid: string, sessionId?: string, query?: string): Promise<string | undefined> {
  try {
    const fts = query ?? buildRecallQuery(pid, sessionId)
    if (!fts) return undefined

    // Search project scope first (higher priority), then user scope
    const project: ScopeRef[] = [{ type: "project", id: pid }]
    const user: ScopeRef[] = [{ type: "user", id: "default" }]
    const thread: ScopeRef[] = sessionId ? [{ type: "thread", id: sessionId }] : []

    const artifacts = Memory.searchArtifacts(fts, [...thread, ...project, ...user], 20)
    if (!artifacts.length) return undefined
    const body = SemanticRecall.format(artifacts, 2000)
    if (!body) return undefined
    return wrapRecall(capRecallBody(body))
  } catch {
    return undefined
  }
}
```

### Affected Files

| File                                              | Lines            | Change                                       |
| ------------------------------------------------- | ---------------- | -------------------------------------------- |
| `packages/opencode/src/memory/semantic-recall.ts` | 292              | Expand preview from 300 to 800 chars         |
| `packages/opencode/src/session/system.ts`         | `recallNative()` | Scope ordering (already changed in Design 3) |

---

## Design 7 — Engram Compatibility Isolation

### Problem

`dream/index.ts` `idle()` (line 120) calls `Engram.ensure()` — which downloads and installs the Engram Go binary. Users without Engram get `false` and autodream silently returns. This is a V0 holdover; the daemon approach doesn't need Engram at all.

Also, `run()` (line 94–96) still gates on `Engram.ensure()` for the manual `/dream` command.

### Solution

Remove `Engram.ensure()` from both `idle()` and `run()`. Keep `Engram` import and `recallEngram()` path in `system.ts` only under `OPENCODE_MEMORY_USE_ENGRAM=true`.

### Before (dream/index.ts:94–96, 119–121)

```ts
export async function run(focus?: string): Promise<string> {
  const available = await Engram.ensure()
  if (!available) return "Engram not available. Install with: brew install gentleman-programming/tap/engram"
  // ...
}

async function idle(sid: string): Promise<void> {
  const available = await Engram.ensure()
  if (!available) return
  // ...
}
```

### After (dream/index.ts)

```ts
export async function run(focus?: string): Promise<string> {
  try {
    const { Config } = await import("../config/config")
    const cfg = await Config.get()
    const model = cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"
    const dir = Instance.directory
    const sock = await ensureDaemon(dir)
    // ... rest unchanged
  } catch (err) {
    log.error("dream failed", { error: err instanceof Error ? err.message : String(err) })
    return `Dream failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function idle(sid: string): Promise<void> {
  // ✅ No Engram gate — daemon runs natively
  const { Config } = await import("../config/config")
  const cfg = await Config.get()
  if (cfg.experimental?.autodream === false) return
  // ... rest as shown in Design 2
}
```

### Remove Engram import from dream/index.ts

**Before** (line 4):

```ts
import { Engram } from "./engram"
```

**After**: Remove this import. The `Engram` module is only needed in `system.ts` (for the legacy `recallEngram` path behind `OPENCODE_MEMORY_USE_ENGRAM=true`).

### Affected Files

| File                                   | Lines             | Change                         |
| -------------------------------------- | ----------------- | ------------------------------ |
| `packages/opencode/src/dream/index.ts` | 4, 94–96, 119–121 | Remove Engram import and gates |

---

## File Changes Summary

| File                                              | Action     | Designs        |
| ------------------------------------------------- | ---------- | -------------- |
| `packages/opencode/src/session/prompt.ts`         | Modify     | D1, D3, D4, D5 |
| `packages/opencode/src/session/system.ts`         | Modify     | D3, D6         |
| `packages/opencode/src/dream/daemon.ts`           | Modify     | D2             |
| `packages/opencode/src/dream/index.ts`            | Modify     | D2, D7         |
| `packages/opencode/src/memory/semantic-recall.ts` | Modify     | D6             |
| `packages/opencode/src/tool/memory.ts`            | **Create** | D5             |
| `packages/opencode/src/tool/tool.ts`              | Modify     | D5             |
| `packages/opencode/src/tool/registry.ts`          | Modify     | D5             |

**Totals**: 1 new file, 7 modified files, 0 deleted files.

---

## Module Dependency Changes

```
V1 Dependency Graph (unchanged):

  contracts.ts
      ↑
  schema.sql.ts
      ↑
  working-memory.ts  semantic-recall.ts  handoff.ts
      ↑                    ↑                ↑
  provider.ts ─────────────┘────────────────┘
      ↑
  session/system.ts
  session/prompt.ts  ← NEW: imports WorkingMemory directly
  dream/index.ts     ← REMOVED: Engram import

  NEW:
  tool/memory.ts     → memory/provider.ts (Memory.setWorkingMemory)
  tool/registry.ts   → tool/memory.ts
  tool/tool.ts       → (adds projectId field to Context type)
```

**No circular dependencies introduced.** `tool/memory.ts` → `memory/` is a leaf-to-core dependency (same pattern as existing `tool/recall.ts` → `storage/db.ts`).

---

## Migration Strategy

No database migrations required. V2 changes only wiring — all tables and schemas from V1 are reused unchanged.

### Rollback

- **Feature flags**: `OPENCODE_MEMORY_USE_ENGRAM=true` restores Engram-based recall. `OPENCODE_DREAM_USE_NATIVE_MEMORY=false` disables native dream persistence.
- **OM atomicity fix**: If the new ordering causes issues, the old ordering can be restored by moving `seal` + `trackObserved` back outside the async body. This is a pure code revert with no data implications.
- **Working memory tool**: Can be removed from registry without any data loss — working memory records persist in the DB regardless of tool availability.

### Deployment Order

All seven designs can ship in a single commit. There are no phased rollout requirements — no data migrations, no schema changes, no new tables.

---

## Testing Strategy

| Layer           | What to Test                                              | Approach                                                                                             |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Unit**        | OM atomicity: seal not advanced on Observer.run() failure | Mock Observer.run() to throw, verify OMBuf.sealedAt() unchanged                                      |
| **Unit**        | `buildRecallQuery()` returns current_task when available  | Create OM record with current_task, verify query output                                              |
| **Unit**        | `recallNative()` uses semantic query not UUID             | Mock Memory.searchArtifacts, verify first arg is not a ULID                                          |
| **Unit**        | Working memory tool writes to correct scope               | Call MemoryTool.execute with thread/project scope, verify DB records                                 |
| **Unit**        | Working memory format injection                           | Verify WorkingMemory.format() output appears in system prompt                                        |
| **Integration** | Dream output capture end-to-end                           | Start daemon, trigger dream, verify memory_artifacts row created                                     |
| **Integration** | Recall returns results after dream persists               | Run dream → persist → recall → verify non-empty response                                             |
| **E2E**         | Full session with OM buffer + recall                      | Create session, generate enough tokens to trigger OM buffer, verify seal advances only after success |

Tests run from `packages/opencode/` directory (not repo root per AGENTS.md constraint: `do-not-run-tests-from-root`).

The existing 33 V1 tests in `test/memory/memory-core.test.ts` must continue passing without modification.

---

## Open Questions

- [x] **Scope ID for project working memory**: Resolved — add `projectId` to `Tool.Context`. Minimal interface change, no downstream tool modifications needed since the field is optional.
- [ ] **Dream polling in idle()**: The `captureDreamOutput()` function polls in a background async — should it have a timeout shorter than 10 min for the `idle()` path? The daemon already has its own 10-min timeout, so the parent-side poll should use a shorter window (e.g., 5 min) to avoid holding the event handler indefinitely.
- [ ] **Working memory auto-population**: Should the observer automatically extract structured facts into working memory, or is the explicit tool-based approach sufficient for V2? Deferring auto-population to V3 keeps V2 scope tight.
