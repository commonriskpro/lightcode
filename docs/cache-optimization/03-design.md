# Technical Design: Cache-Optimized Context Management

> **Status (2026-04-05):**
>
> - Phase 1 (breakpoint ordering, volatile extraction) ✅ implemented
> - Phase 2 (system slot stability) ✅ implemented — including Gap D+C reorder (observations at BP3)
> - Phase 3 (cut-point compaction refactor) ❌ **SUPERSEDED** — `compaction.ts`, `cut-point.ts`, `overflow.ts` were deleted entirely
> - Phase 4 (iterative summaries) ❌ **SUPERSEDED** — replaced by OM Observer approach
>
> See `docs/om-replace-compaction.md` for the architectural decision that superseded Phases 3–4.

## Overview

Four phases, each independently deployable. No database migrations. No schema changes. No new dependencies.

**Critical contract**: Every piece of existing code that gets replaced or modified is explicitly documented with a "Before → After" diff, a rationale for why the old code goes away, and what happens to its callers.

---

## Supersession Map

Before diving into phases, here's a complete map of what old code gets replaced, what stays, and why.

### Code That Gets REPLACED (old version deleted)

| Old Code                                    | Location                | Replaced By                                                                  | Why Old Goes Away                                                                                                                                                                            |
| ------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyCaching()` function body              | `transform.ts:192-237`  | New `applyCaching()` with 4-breakpoint volatility strategy                   | Old caches last-2-messages (write-only waste). New uses all 4 Anthropic breakpoints optimally. Same function signature, same callers, same return type.                                      |
| `environment()` lines with date/model       | `system.ts:20,27`       | Date/model lines move to new `volatile()` function                           | These 2 lines invalidate 3K-8K tokens of cache daily. Moving them to uncached system[2] makes BP3 stable for the session lifetime.                                                           |
| `processCompaction()` full-replacement path | `compaction.ts:154-340` | Cut-point path (new), with full-replacement as fallback inside same function | Full-replacement is objectively worse for cache preservation. But it STAYS as fallback when cut-point can't find a valid boundary.                                                           |
| Single `defaultPrompt` constant             | `compaction.ts:189-217` | Two functions: `buildFreshPrompt()` + `buildIterativePrompt()`               | `defaultPrompt` string literal is extracted into `buildFreshPrompt()` (identical content). `buildIterativePrompt()` is new. The old literal is removed because it now lives in the function. |
| 2-part system rejoin                        | `llm.ts:123-128`        | 3-part system assembly                                                       | Old produced `[header, rest]`. New produces `[header, rest, volatile]`. The rejoin logic itself still exists — it just gets a `.push()` after it.                                            |

### Code That Gets EXTENDED (old behavior preserved, new added)

| Old Code                                        | Location                | Extension                                                                                                                       | Old Behavior Preserved?                        |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `processCompaction()`                           | `compaction.ts:141-340` | Adds `CutPoint.find()` before the LLM call. If `type: "cut"` → new path. If `type: "full"` → **exact current path, untouched**. | YES — full-replacement is the fallback         |
| Plugin hook `"experimental.session.compacting"` | `compaction.ts:184-188` | Both `buildFreshPrompt` and `buildIterativePrompt` check `compacting.prompt` first. Plugin override takes priority over both.   | YES — plugin can still replace prompt entirely |
| Config schema `compaction`                      | `config.ts:1006-1017`   | Adds optional `keep` key. All existing keys unchanged.                                                                          | YES — existing configs valid without `keep`    |

### Code That Is NOT TOUCHED (zero changes)

| File            | Function/Area                              | Why Untouched                                                                                                                                                |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message-v2.ts` | `filterCompacted()` (903-919)              | Already walks newest-to-oldest stopping at compaction boundary. Works identically for both full-replacement and cut-point — the boundary format is the same. |
| `overflow.ts`   | `isOverflow()` (1-22)                      | Overflow detection uses provider token counts, independent of caching or compaction strategy.                                                                |
| `processor.ts`  | `halt()` (464-478), `needsCompaction` flag | Detects overflow and sets flag. Doesn't care how compaction runs.                                                                                            |
| `prompt.ts`     | `runLoop` (1480-1760)                      | Calls `compaction.process()` which handles strategy internally. Calls `compaction.create()` to insert CompactionPart. Neither changes.                       |
| `retry.ts`      | Retry policy (1-106)                       | Retry logic excludes overflow errors. Independent of caching.                                                                                                |
| `error.ts`      | Overflow regex patterns (9-155)            | Error detection. No caching involvement.                                                                                                                     |
| `tool/*.ts`     | All tool definitions                       | Tool signatures unchanged. Sorted alphabetically in `llm.ts` (unchanged).                                                                                    |
| `plugin/*.ts`   | Plugin hooks                               | Same hook points, same arguments. `"experimental.session.compacting"` still fires with same signature.                                                       |
| `llm.ts`        | Tool sorting (268-275)                     | Alphabetical sort stays. Cache stability sort is unchanged.                                                                                                  |
| `llm.ts`        | `prompt_cache_key = sessionID`             | OpenAI/OpenRouter cache key logic in `options()` stays.                                                                                                      |
| `prompt.ts`     | Fork subagent (`activeContexts.set`, 1696) | Stashes active context for fork. Unaffected — system array just has 3 items instead of 2.                                                                    |

---

## Phase 1: Breakpoint Optimization

### 1.1 File: `src/provider/transform.ts` — `applyCaching()`

#### Before (DELETED — lines 192-237)

```typescript
// THIS ENTIRE FUNCTION BODY IS REPLACED
function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

  const providerOptions = {
    anthropic: { cacheControl: { type: "ephemeral" } },
    openrouter: { cacheControl: { type: "ephemeral" } },
    bedrock: { cachePoint: { type: "default" } },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
    copilot: { copilot_cache_control: { type: "ephemeral" } },
  }

  for (const msg of unique([...system, ...final])) {
    const useMessageLevelOptions = /* ... */
    const shouldUseContentOptions = /* ... */
    if (shouldUseContentOptions) { /* ... */ }
    msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
  }
  return msgs
}
```

**Why it goes away**: Caches `system[0..1]` + `last_2_messages`. The last-2-messages breakpoints change every turn — they generate cache writes (1.25× cost) that are never read. 2 of 4 Anthropic slots wasted. All breakpoints use 5min TTL even though system/tools are stable for hours.

#### After (NEW — replaces entire function body)

```typescript
function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  const isAnthropic =
    model.providerID === "anthropic" ||
    model.providerID.includes("bedrock") ||
    model.api.npm === "@ai-sdk/amazon-bedrock"

  // 5-minute TTL options — all providers
  const cache5m = {
    anthropic: { cacheControl: { type: "ephemeral" } },
    openrouter: { cacheControl: { type: "ephemeral" } },
    bedrock: { cachePoint: { type: "default" } },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
    copilot: { copilot_cache_control: { type: "ephemeral" } },
  }

  // 1-hour TTL options — Anthropic only, others fall back to 5min
  const cache1h = isAnthropic
    ? {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        bedrock: { cachePoint: { type: "default" } },
      }
    : cache5m

  // BP2: Agent prompt (system[0]) — 1hr TTL
  // Most stable content: only changes on agent switch
  const system = msgs.filter((msg) => msg.role === "system")
  if (system[0]) {
    applyBreakpoint(system[0], cache1h, model)
  }

  // BP3: Env + skills + instructions (system[1]) — 5min TTL
  // Stable within a session (volatile data moved to system[2] in Phase 2)
  if (system[1]) {
    applyBreakpoint(system[1], cache5m, model)
  }

  // NOTE: system[2] (volatile — date, model name) is deliberately NOT cached

  // BP4: Second-to-last conversation message — 5min TTL
  // This is the last message that WON'T change on the next turn.
  // On turn N+1 it's a cache READ; only the new user msg is a write.
  const conversation = msgs.filter((msg) => msg.role !== "system")
  if (conversation.length >= 3) {
    applyBreakpoint(conversation[conversation.length - 2], cache5m, model)
  }

  return msgs
}
```

#### New helper: `applyBreakpoint()` (extracted from old inline logic)

```typescript
// Extracted from the old for-loop body. Same logic, reusable.
function applyBreakpoint(msg: ModelMessage, opts: Record<string, unknown>, model: Provider.Model) {
  const useMessageLevel =
    model.providerID === "anthropic" ||
    model.providerID.includes("bedrock") ||
    model.api.npm === "@ai-sdk/amazon-bedrock"
  const useContentLevel = !useMessageLevel && Array.isArray(msg.content) && msg.content.length > 0

  if (useContentLevel) {
    const last = msg.content[msg.content.length - 1]
    if (
      last &&
      typeof last === "object" &&
      last.type !== "tool-approval-request" &&
      last.type !== "tool-approval-response"
    ) {
      last.providerOptions = mergeDeep(last.providerOptions ?? {}, opts)
      return
    }
  }
  msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, opts)
}
```

**Note on `applyBreakpoint`**: This is NOT new logic. It's the exact `if/else` from the old `for` loop body (lines 214-234), extracted into a named function so it can be called per-breakpoint instead of in a loop over `unique([...system, ...final])`. Same behavior, just callable individually.

#### Callers of `applyCaching()`

`applyCaching` is called from one place: `ProviderTransform.normalizeForProvider()` inside `transform.ts`. That call site does NOT change — it still calls `applyCaching(msgs, model)` and gets back `ModelMessage[]`.

### 1.2 File: `src/session/llm.ts` — BP1 via Automatic Caching

#### Before

No tool-level cache breakpoint exists. Tools are sorted alphabetically (lines 268-275) but have no `cache_control`.

#### After

Use Anthropic's automatic caching mode on the `streamText` call. This lets the provider auto-place a breakpoint on the last cacheable block in the tools prefix, consuming 1 of the 4 slots.

```typescript
// In the streamText call (line 277+), add to providerOptions:
const anthropicAuto = isAnthropicModel(input.model) ? { anthropic: { cache_control: { type: "ephemeral" } } } : {}

return streamText({
  // ... existing params ...
  providerOptions: {
    ...params.options,
    ...anthropicAuto,
  },
})
```

**Investigation before implementation**: Verify that `@ai-sdk/anthropic` supports top-level `cache_control` on the `streamText` call. If NOT, skip BP1 — we still get 3 explicit breakpoints. The sorted tools still benefit from OpenAI's automatic prefix caching.

### 1.3 File: `src/session/llm.ts` — System Message Split

**NO CHANGE in Phase 1.** The existing 2-part rejoin (lines 123-128) stays as-is. Phase 2 extends it to 3 parts.

---

## Phase 2: System Prompt Stabilization

### 2.1 File: `src/session/system.ts` — `environment()` + new `volatile()`

#### Before (MODIFIED — lines 16-41)

```typescript
export async function environment(model: Provider.Model) {
  const project = Instance.project
  return [
    [
      `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      `  Workspace root folder: ${Instance.worktree}`,
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      `  Today's date: ${new Date().toDateString()}`,
      `</env>`,
      // ... directories ...
    ].join("\n"),
  ]
}
```

#### After (2 lines removed, new function added)

```typescript
export async function environment(_model: Provider.Model) {
  const project = Instance.project
  return [
    [
      // REMOVED: "You are powered by..." line — moved to volatile()
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      `  Workspace root folder: ${Instance.worktree}`,
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      // REMOVED: "Today's date..." line — moved to volatile()
      `</env>`,
      `<directories>`,
      `  ${project.vcs === "git" && false ? await Ripgrep.tree({ cwd: Instance.directory, limit: 50 }) : ""}`,
      `</directories>`,
    ].join("\n"),
  ]
}

// NEW FUNCTION — contains the 2 volatile lines extracted from environment()
export function volatile(model: Provider.Model) {
  return [
    `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
    `Today's date: ${new Date().toDateString()}`,
  ].join("\n")
}
```

**What moved where**:

- `"You are powered by..."` → `volatile()` — changes when model changes
- `"Today's date: ..."` → `volatile()` — changes daily

**Why**: These 2 lines invalidated BP3 (the entire env+skills+instructions block, typically 3K-8K tokens). By extracting them, BP3 becomes stable for the entire session duration. The model still receives the same information, just in system[2] instead of system[1].

#### Callers of `environment()`

Called from exactly one place: `prompt.ts` line 1681:

```typescript
Effect.promise(() => SystemPrompt.environment(model)),
```

This caller gets back the same `string[]` array, just without 2 lines. No caller change needed.

#### Callers of `volatile()` (NEW)

Called from `llm.ts` only — see 2.2 below.

### 2.2 File: `src/session/llm.ts` — 3-Part System Assembly

#### Before (MODIFIED — lines 123-128)

```typescript
const header = system[0]
await Plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
// rejoin to maintain 2-part structure for caching if header unchanged
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

#### After (lines 123-131 — 3 lines added after rejoin)

```typescript
const header = system[0]
await Plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
// rejoin to maintain 2-part structure for caching if header unchanged
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
// NEW: Append volatile context as system[2] — NOT cached by applyCaching
// (applyCaching only touches system[0] and system[1])
system.push(SystemPrompt.volatile(input.model))
```

**What changes for downstream code**: The `system` array now has 3 items instead of 2. This flows into:

1. **`messages` array** (line 155): `system.map(x => ({ role: "system", content: x }))` — now produces 3 system messages instead of 2. Harmless — all providers accept multiple system messages.

2. **`applyCaching()`** (Phase 1): Only caches `system[0]` (BP2) and `system[1]` (BP3). `system[2]` has no breakpoint — uncached by design.

3. **OpenAI OAuth path** (line 146): `options.instructions = system.join("\n")` — joins all 3 parts. Volatile data included. Same behavior as before (it was in system[1] before, now it's in system[2], but joined into one string either way).

4. **Fork subagent** (`prompt.ts:1696`): `activeContexts.set(sessionID, { system, tools, messages })` — stashes system array with 3 items. Fork child inherits all 3. Same behavior, more items.

### 2.3 Impact Assessment

| What                       | Before                          | After                                        | Risk                                                       |
| -------------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| system message count       | 2                               | 3                                            | Very low — all providers accept N system messages          |
| Date in cache prefix       | Yes (invalidates BP3 daily)     | No (in uncached system[2])                   | None                                                       |
| Model name in cache prefix | Yes (invalidates BP3 on switch) | No (in uncached system[2])                   | None                                                       |
| Token cost of system[2]    | N/A                             | ~30 tokens uncached per turn                 | Negligible (~$0.0001/turn)                                 |
| Plugin `system.transform`  | Operates on system array        | Still operates on system array (now 3 items) | Low — plugin may modify system[2] which is fine (uncached) |

---

## Phase 3: Cut-Point Compaction

### 3.1 New File: `src/session/cut-point.ts`

Completely new module. Does NOT replace anything — it's consumed by the modified `processCompaction()`.

```typescript
import { Token } from "../util/token"
import type { MessageV2 } from "./message-v2"

const DEFAULT_KEEP = 20_000

export namespace CutPoint {
  export interface Result {
    type: "cut" | "full"
    cutIndex?: number
    summarize: MessageV2.WithParts[]
    keep: MessageV2.WithParts[]
  }

  export function find(msgs: MessageV2.WithParts[], keepTokens = DEFAULT_KEEP): Result {
    let accumulated = 0
    let cutIndex = -1

    for (let i = msgs.length - 1; i >= 0; i--) {
      accumulated += estimate(msgs[i])
      if (accumulated >= keepTokens) {
        cutIndex = validCut(msgs, i)
        break
      }
    }

    // Fallback: too few messages, no valid boundary, or cut would keep everything
    if (cutIndex < 0 || cutIndex <= 1 || cutIndex >= msgs.length - 1) return { type: "full", summarize: msgs, keep: [] }

    return {
      type: "cut",
      cutIndex,
      summarize: msgs.slice(0, cutIndex),
      keep: msgs.slice(cutIndex),
    }
  }

  // Walk forward from startIndex to the nearest valid cut boundary.
  // Valid: a user message (not a compaction msg), or the message after
  // a finished assistant message that isn't followed by an orphaned tool result.
  function validCut(msgs: MessageV2.WithParts[], start: number): number {
    for (let i = start; i < msgs.length; i++) {
      const msg = msgs[i]
      if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) return i
      if (msg.info.role === "assistant" && msg.info.finish) {
        const next = msgs[i + 1]
        if (!next || next.info.role === "user") return i + 1
      }
    }
    return -1
  }

  function estimate(msg: MessageV2.WithParts): number {
    let chars = 0
    for (const part of msg.parts) {
      if (part.type === "text") chars += part.text.length
      if (part.type === "tool") chars += (part.state.input?.length ?? 0) + (part.state.output?.length ?? 0)
      if (part.type === "reasoning") chars += part.text.length
    }
    return Math.ceil(chars / 4) // same heuristic as Token.estimate
  }
}
```

### 3.2 File: `src/session/compaction.ts` — `processCompaction()` Rewrite

This is the biggest change. The old function body (lines 141-340) is refactored into a structure with two paths.

#### Before (single path — full replacement)

```
processCompaction():
  1. Find parent user message
  2. If overflow: find replay message, slice history
  3. Get compaction agent + model
  4. Fire plugin hook
  5. Build prompt (single defaultPrompt)
  6. Convert ALL messages to model format (stripMedia)
  7. Run compaction LLM on ALL messages
  8. If compaction itself overflows: error + stop
  9. If auto + replay: replay user message
  10. If auto + no replay: inject continue message
  11. Publish compacted event
```

#### After (two paths — cut-point with full-replacement fallback)

```
processCompaction():
  1. Find parent user message                         ← SAME
  2. Get compaction agent + model                     ← SAME (moved before overflow logic)
  3. Get config for keepTokens budget                 ← NEW
  4. Fire plugin hook                                 ← SAME
  5. Run CutPoint.find(messages, keepTokens)          ← NEW decision point
  │
  ├── type: "cut" → CUT-POINT PATH (NEW)
  │   6a. Check for previous summary in summarize zone  ← NEW (Phase 4)
  │   7a. Build prompt (fresh or iterative)             ← NEW (Phase 4)
  │   8a. Convert ONLY summarize msgs to model format   ← CHANGED (subset, not all)
  │   9a. Run compaction LLM on summarize msgs only     ← CHANGED (fewer tokens)
  │   10a. If compaction itself overflows: error + stop  ← SAME guard
  │   11a. Keep zone messages are UNTOUCHED              ← NEW (cache preserved)
  │   12a. Check if overflow user msg is in keep zone    ← NEW
  │        → Yes: no replay needed (msg preserved verbatim)
  │        → No: fall through to full path
  │   13a. Publish compacted event                       ← SAME
  │
  └── type: "full" → FULL REPLACEMENT PATH (EXISTING — unchanged)
      6b. If overflow: find replay message, slice history ← SAME as old step 2
      7b. Build prompt (defaultPrompt)                    ← SAME as old step 5
      8b. Convert ALL messages to model format            ← SAME as old step 6
      9b. Run compaction LLM on ALL messages              ← SAME as old step 7
      10b. If compaction itself overflows: error + stop   ← SAME as old step 8
      11b. If auto + replay: replay user message          ← SAME as old step 9
      12b. If auto + no replay: inject continue message   ← SAME as old step 10
      13b. Publish compacted event                        ← SAME as old step 11
```

**Key point**: The `type: "full"` path is the EXACT current code, untouched. The `type: "cut"` path is new. The decision between them is made by `CutPoint.find()` based on whether a valid cut boundary exists.

#### Overflow + Cut-Point Interaction

The old overflow logic (lines 161-176) needs careful handling:

**Old behavior**: On overflow, find the last real user message before the compaction request, slice history to exclude it, hold it for replay after summarization.

**New behavior with cut-point**:

- Run `CutPoint.find()` on the full message set FIRST
- If the triggering user message (the one that caused overflow) is in `keep` zone: it's already preserved. No replay needed. No slicing.
- If the triggering user message is in `summarize` zone (rare — would mean the overflow happened on a very short recent exchange): fall back to `type: "full"` path with old replay logic.

```typescript
// Pseudocode for the overflow + cut-point interaction:
if (input.overflow && cutResult.type === "cut") {
  const triggerUserIdx = findTriggerUserMessage(input.messages, input.parentID)
  const triggerIsKept = triggerUserIdx >= cutResult.cutIndex
  if (!triggerIsKept) {
    // Trigger msg would be summarized away — unsafe for cut-point.
    // Fall back to full replacement with replay (old behavior).
    cutResult = { type: "full", summarize: messages, keep: [] }
  }
  // If triggerIsKept: no replay needed, msg is in the verbatim zone
}
```

### 3.3 File: `src/session/message-v2.ts` — `filterCompacted()`

**NO CHANGE.** Here's why it works with both strategies:

`filterCompacted()` walks newest-to-oldest looking for:

1. An assistant message with `summary: true` + `finish` + no error → records its `parentID`
2. A user message with that ID + a `compaction` part → STOPS, reverses

After **full replacement**: the summary + compaction user msg are the only old content. Everything after is post-compaction.

After **cut-point**: the summary + compaction user msg are at the cut point. Messages in the "keep" zone are between the compaction boundary and the newest message. `filterCompacted()` finds the boundary and returns `[compaction user msg] + [summary] + [keep zone] + [post-compaction]`. Identical contract.

### 3.4 File: `src/config/config.ts` — New Optional Config Key

#### Before (line 1006-1017)

```typescript
compaction: z.object({
  auto: z.boolean().optional(),
  prune: z.boolean().optional(),
  reserved: z.number().int().min(0).optional(),
}).optional()
```

#### After (1 line added)

```typescript
compaction: z.object({
  auto: z.boolean().optional(),
  prune: z.boolean().optional(),
  reserved: z.number().int().min(0).optional(),
  keep: z.number().int().min(0).optional(), // NEW: tokens to keep after cut-point compaction
}).optional()
```

Default: `20_000` (used in `CutPoint.find()` when `cfg.compaction?.keep` is undefined).

**Backward compatible**: Existing configs without `keep` continue to work — the Zod schema makes it optional with a code-level default.

---

## Phase 4: Iterative Summary Updates

### 4.1 File: `src/session/compaction.ts` — Prompt Functions

#### Before (REPLACED — lines 189-219)

```typescript
// This string literal is REMOVED from processCompaction and extracted
// into buildFreshPrompt(). The content is IDENTICAL.
const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation...
... existing template ...`

const prompt = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
```

#### After (2 new functions + 1 helper, replaces the inline prompt)

```typescript
// Extracted from the old inline `defaultPrompt` — SAME CONTENT, just in a function
function buildFreshPrompt(compacting: { prompt?: string; context: string[] }): string {
  if (compacting.prompt) return compacting.prompt
  const fresh = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.
Do not call any tools. Respond only with the summary text.
Respond in the same language as the user's messages in the conversation.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`
  return [fresh, ...compacting.context].join("\n\n")
}

// NEW — used when a previous compaction summary exists in the summarize zone
function buildIterativePrompt(prev: string, compacting: { prompt?: string; context: string[] }): string {
  if (compacting.prompt) return compacting.prompt // Plugin override wins

  const iterative = `UPDATE the following conversation summary with information from the new messages above.

RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Accomplished section: mark completed items, add new ones
- If previous Discoveries conflict with new information, keep the newer version
- Do not call any tools. Respond only with the updated summary.
- Respond in the same language as the user's messages in the conversation.

PREVIOUS SUMMARY:
---
${prev}
---

Use the same template as the previous summary. Update it with the new information.`

  return [iterative, ...compacting.context].join("\n\n")
}

// NEW — scans the summarize zone for a previous compaction summary
function findPreviousSummary(msgs: MessageV2.WithParts[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error) {
      const text = msg.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (text.trim()) return text
    }
  }
  return undefined
}
```

**How old prompt line is replaced**: The old line `const prompt = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")` becomes:

```typescript
const prev = findPreviousSummary(toSummarize)
const prompt = prev ? buildIterativePrompt(prev, compacting) : buildFreshPrompt(compacting)
```

### 4.2 Summary Size Guard

**New addition** to the compaction LLM call:

```typescript
const maxTokens = Math.floor(0.8 * (cfg.compaction?.reserved ?? COMPACTION_BUFFER))
```

This caps the summary at ~16,000 tokens (80% of 20K reserve), preventing unbounded growth on iterative updates. Passed to `streamText` as `maxTokens` for the compaction agent.

**Currently**: No explicit maxTokens on the compaction call. The model decides length.

---

## Complete File Change Summary

| File                        | Phase | Action               | What Happens to Old Code                                                                                                                                                                                                                               |
| --------------------------- | ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/provider/transform.ts` | P1    | **Rewrite function** | `applyCaching()` body deleted, replaced with 4-breakpoint version. `applyBreakpoint()` extracted from old inline logic.                                                                                                                                |
| `src/session/llm.ts`        | P1+P2 | **Extend**           | Lines 123-128 (rejoin) stay, `system.push(volatile)` added after. Anthropic auto-cache option added to `streamText` call.                                                                                                                              |
| `src/session/system.ts`     | P2    | **Modify + Add**     | 2 lines removed from `environment()`. New `volatile()` function added. Export list gains `volatile`.                                                                                                                                                   |
| `src/session/cut-point.ts`  | P3    | **New file**         | N/A — brand new module.                                                                                                                                                                                                                                |
| `src/session/compaction.ts` | P3+P4 | **Refactor**         | `processCompaction()` body restructured: cut-point path added, full-replacement becomes else-branch. `defaultPrompt` literal removed, replaced by `buildFreshPrompt()` + `buildIterativePrompt()` + `findPreviousSummary()`. Summary size guard added. |
| `src/config/config.ts`      | P3    | **Extend**           | 1 line added to Zod schema (`keep` optional key).                                                                                                                                                                                                      |

### Dead Code After All Phases

| Old Code                                                | Status                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `applyCaching()` old body                               | **Deleted** — replaced by new body                                    |
| `const defaultPrompt = ...` inline literal              | **Deleted** — content lives in `buildFreshPrompt()`                   |
| `const final = msgs.filter(...).slice(-2)`              | **Deleted** — no more last-2-messages caching                         |
| `const providerOptions = { ... }` (single object)       | **Deleted** — replaced by `cache5m` + `cache1h` + `applyBreakpoint()` |
| `for (const msg of unique([...system, ...final]))` loop | **Deleted** — replaced by per-breakpoint calls                        |
| `"Today's date..."` in environment()                    | **Deleted from here** — moved to `volatile()`                         |
| `"You are powered by..."` in environment()              | **Deleted from here** — moved to `volatile()`                         |

No orphaned code. No dead paths. No unused functions.

---

## Dependency Graph

```
Phase 1 (Breakpoints)  ←── independent, deploy first
Phase 2 (Stability)    ←── independent, deploy second (but benefits from Phase 1)
Phase 3 (Cut-Point)    ←── independent, benefits from Phase 1+2
Phase 4 (Iterative)    ←── depends on Phase 3 (needs cut-point to find previous summary)
```

**Recommended deploy order**: P1 → P2 → P3+P4 (together, since P4's prompt selection depends on P3's cut-point split).

---

## Testing Strategy

### Unit Tests (NEW)

| Test                                                                         | Phase | File                              |
| ---------------------------------------------------------------------------- | ----- | --------------------------------- |
| `applyCaching places BP2 on system[0] with 1hr TTL for Anthropic`            | P1    | `test/provider/transform.test.ts` |
| `applyCaching places BP3 on system[1] with 5min TTL`                         | P1    | `test/provider/transform.test.ts` |
| `applyCaching places BP4 on second-to-last conversation msg`                 | P1    | `test/provider/transform.test.ts` |
| `applyCaching does NOT cache system[2]`                                      | P1    | `test/provider/transform.test.ts` |
| `applyCaching handles < 3 conversation messages (no BP4)`                    | P1    | `test/provider/transform.test.ts` |
| `applyCaching non-Anthropic providers use 5min for all BPs`                  | P1    | `test/provider/transform.test.ts` |
| `applyBreakpoint uses message-level for Anthropic, content-level for others` | P1    | `test/provider/transform.test.ts` |
| `environment() does NOT contain date or model name`                          | P2    | `test/session/system.test.ts`     |
| `volatile() returns date and model name`                                     | P2    | `test/session/system.test.ts`     |
| `CutPoint.find returns type:cut with correct split for 50-msg conversation`  | P3    | `test/session/cut-point.test.ts`  |
| `CutPoint.find returns type:full when conversation < 3 messages`             | P3    | `test/session/cut-point.test.ts`  |
| `CutPoint.find respects keepTokens budget`                                   | P3    | `test/session/cut-point.test.ts`  |
| `CutPoint.find skips orphaned tool results as cut boundary`                  | P3    | `test/session/cut-point.test.ts`  |
| `CutPoint.find returns type:full when no valid boundary exists`              | P3    | `test/session/cut-point.test.ts`  |
| `buildFreshPrompt returns existing template text`                            | P4    | `test/session/compaction.test.ts` |
| `buildFreshPrompt uses plugin prompt when provided`                          | P4    | `test/session/compaction.test.ts` |
| `buildIterativePrompt includes previous summary in prompt`                   | P4    | `test/session/compaction.test.ts` |
| `buildIterativePrompt uses plugin prompt when provided`                      | P4    | `test/session/compaction.test.ts` |
| `findPreviousSummary extracts text from summary message`                     | P4    | `test/session/compaction.test.ts` |
| `findPreviousSummary returns undefined when no summary exists`               | P4    | `test/session/compaction.test.ts` |

### Integration Tests (NEW)

| Test                                                                      | Phase |
| ------------------------------------------------------------------------- | ----- |
| `processCompaction with cut-point keeps recent messages in context`       | P3    |
| `processCompaction falls back to full when CutPoint returns type:full`    | P3    |
| `processCompaction with overflow + trigger in keep zone skips replay`     | P3    |
| `processCompaction with overflow + trigger in summarize zone uses replay` | P3    |
| `processCompaction with previous summary uses iterative prompt`           | P4    |
| `processCompaction without previous summary uses fresh prompt`            | P4    |
| `filterCompacted returns correct messages after cut-point compaction`     | P3    |

### Regression Tests (existing — MUST pass unchanged)

| Test                           | File                                    |
| ------------------------------ | --------------------------------------- |
| All processor/compaction tests | `test/session/processor-effect.test.ts` |
| All compaction-specific tests  | `test/session/compaction.test.ts`       |
| All retry tests                | `test/session/retry.test.ts`            |
| All overflow/error tests       | `test/provider/error.test.ts`           |

---

## Observability

### Metrics to Track (via existing provider usage fields)

```typescript
usage.cache_read_input_tokens // Should INCREASE after Phase 1+2
usage.cache_creation_input_tokens // Should DECREASE after Phase 1+2
usage.input_tokens // Should DECREASE overall
```

### Validation Checks

| Check                                                | Phase | Expected                          |
| ---------------------------------------------------- | ----- | --------------------------------- |
| Cache read > 0 on turn 2+ (Anthropic)                | P1    | System prompt + tools cached      |
| Cache creation < 15% of total after turn 3           | P1+P2 | Only new conversation is uncached |
| Cache read > 0 on first post-compaction turn         | P3    | Keep-zone messages still cached   |
| BP3 doesn't invalidate between turns within same day | P2    | Date removed from system[1]       |
| No Anthropic 400 errors from TTL ordering            | P1    | 1hr always before 5min in prefix  |
