# Technical Spec: Streaming Tool Execution

## 1. Overview

Execute tool calls in parallel as they arrive during LLM streaming. Enable the AI SDK to handle multi-step tool loops internally, eliminating per-step overhead from the outer loop.

## 2. Codebase Analysis — Current State

### 2.1 Architecture Layers

| Layer         | File                                       | Responsibility                                                   |
| ------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| **Loop**      | `src/session/prompt.ts` (lines 1402-1637)  | Outer `while(true)` loop, turn-taking                            |
| **Processor** | `src/session/processor.ts` (lines 86-502)  | Handles one LLM stream, parses events, persists parts            |
| **LLM**       | `src/session/llm.ts` (lines 52-77, 80-337) | Creates AI SDK `streamText` call, returns Effect `Stream<Event>` |

### 2.2 Critical Finding: Tools ARE Already Parallel Within a Step

The AI SDK's `runToolsTransformation` (node_modules/ai/dist/index.mjs lines 6259-6287) already launches all tool executions concurrently within a step:

```javascript
// Inside runToolsTransformation, on "tool-call" chunk:
if (tool2.execute != null) {
    outstandingToolResults.add(toolExecutionId);
    executeToolCall({...}).then((result) => {
        toolResultsStreamController.enqueue(result);
    }).finally(() => {
        outstandingToolResults.delete(toolExecutionId);
        attemptClose();
    });
}
```

Multiple `tool-call` chunks → all `execute()` start immediately in parallel.

### 2.3 Where The Bottleneck Actually Is

The bottleneck is NOT "tools wait for ALL tool calls before executing." Instead:

1. **The outer loop is sequential between steps**: Each `runLoop` iteration calls `handle.process()` for one AI SDK step. After ALL tools complete, control returns to the outer loop which re-gathers messages, re-resolves tools, and starts a new model call.

2. **`stepCountIs(1)` limits the SDK**: The SDK only does one model call per `process()` invocation (default). After tool results are collected, the SDK stops instead of automatically feeding results back.

3. **Per-step overhead**: message re-gathering + tool re-resolution + new context construction adds 200-500ms per eliminated iteration.

### 2.4 Tool Concurrency Classification

| Tool                                  | Side Effects                            | Concurrency-Safe? |
| ------------------------------------- | --------------------------------------- | ----------------- |
| `read`, `glob`, `grep`                | Read-only filesystem                    | **Yes**           |
| `webfetch`, `websearch`, `codesearch` | External API (read-only)                | **Yes**           |
| `lsp`                                 | LSP queries (read-only)                 | **Yes**           |
| `invalid`                             | Error response                          | **Yes**           |
| `edit`, `write`                       | Writes files (uses `FileTime.withLock`) | **No**            |
| `bash`                                | Arbitrary shell commands                | **No**            |
| `task`                                | Launches subagent sessions              | **No**            |
| `question`                            | Blocks on user input                    | **No**            |
| `todowrite`                           | Writes todo state                       | **No**            |
| `batch`                               | Already parallel internally             | N/A               |

## 3. Sequence Diagrams

### 3.1 Current Flow

```
User       runLoop        Processor     AI SDK streamText     Tool A    Tool B
  |            |               |               |                |          |
  |--prompt--->|               |               |                |          |
  |            |--process()--->|               |                |          |
  |            |               |--stream()---->|                |          |
  |            |               |               |==model call==> |          |
  |            |               |<-tool-call(A)-|---execute(A)-->|          |
  |            |               |<-tool-call(B)-|               |--exec(B)->|
  |            |               |<-tool-result-A|<--result-------|          |
  |            |               |<-tool-result-B|               |<-result---|
  |            |               |<-finish-step--|               |          |
  |            |<-"continue"---|               |               |          |
  |            |                               |               |          |
  |            | [re-gather, re-resolve tools]  |               |          |
  |            |                               |               |          |
  |            |--process()--->|               |               |          |
  |            |               |--stream()---->|               |          |
  |            |               |               |==model call==> |          |
  |            |               |<-finish(stop)-|               |          |
  |            |<-"stop"-------|               |               |          |
  |<--result---|               |               |               |          |
```

### 3.2 Proposed Flow: Multi-Step

```
User       runLoop        Processor     AI SDK streamText     Tool A    Tool B
  |            |               |               |                |          |
  |--prompt--->|               |               |                |          |
  |            |--process()--->|               |                |          |
  |            |               |--stream(N)--->|                |          |
  |            |               |               |==model call 1=>|          |
  |            |               |<-tool-call(A)-|---execute(A)-->|          |
  |            |               |<-tool-call(B)-|               |--exec(B)->|
  |            |               |<-tool-result-A|<--result-------|          |
  |            |               |<-tool-result-B|               |<-result---|
  |            |               |<-finish-step--|               |          |
  |            |               |               |==model call 2=>|  (auto!) |
  |            |               |<-text-delta---|  (no outer     |          |
  |            |               |<-finish(stop)-|   loop!)       |          |
  |            |<-"stop"-------|               |               |          |
  |<--result---|               |               |               |          |
```

## 4. Implementation Plan

### Phase 1: Enable Multi-Step in AI SDK (P0 — Highest ROI)

#### 4.1.1 Modify `LLM.stream()` — `src/session/llm.ts`

**Current** (line 260): `streamText({...})` with default `stopWhen = stepCountIs(1)`

**Change**: Allow multi-step:

```typescript
return streamText({
  // ... existing options ...
  stopWhen: [stepCountIs(input.maxInternalSteps ?? 5), hasNoToolCalls()],
})
```

#### 4.1.2 Update `StreamInput` type — `src/session/llm.ts` lines 25-38

Add: `maxInternalSteps?: number`

#### 4.1.3 Fix Token Accumulation — `src/session/processor.ts` line 275

**Current**: `ctx.assistantMessage.tokens = usage.tokens` (overwrites)

**Change**: Accumulate across steps:

```typescript
ctx.assistantMessage.tokens = {
  input: ctx.assistantMessage.tokens.input + usage.tokens.input,
  output: ctx.assistantMessage.tokens.output + usage.tokens.output,
  reasoning: ctx.assistantMessage.tokens.reasoning + usage.tokens.reasoning,
  cache: {
    read: ctx.assistantMessage.tokens.cache.read + usage.tokens.cache.read,
    write: ctx.assistantMessage.tokens.cache.write + usage.tokens.cache.write,
  },
}
```

#### 4.1.4 Simplify Outer Loop — `src/session/prompt.ts` lines 1438-1446

With multi-step SDK, the outer loop only needs to iterate for:

- Compaction needed
- Subtasks queued
- SDK step limit reached but model wants more

### Phase 2: Concurrency Classification (P2 — Defensive)

#### 4.2.1 Add to `Tool.Def` — `src/tool/tool.ts` line 29

```typescript
concurrency?: "safe" | "unsafe"  // default "unsafe"
```

#### 4.2.2 Semaphore Wrapping — `src/session/prompt.ts` lines 443-475

For unsafe tools, acquire a semaphore before `execute()`:

```typescript
if (item.concurrency !== "safe") {
  yield * Semaphore.withPermits(unsafeSem, 1)(Effect.promise(() => item.execute(args, ctx)))
} else {
  yield * Effect.promise(() => item.execute(args, ctx))
}
```

### Phase 3: `prepareStep` for Dynamic Tools (P3 — Edge Case)

Add `prepareStep` callback to `streamText()` for dynamic tool availability across SDK-internal steps. Needed for deferred tools (`tool_search`) to work across multi-step.

## 5. Files to Modify

| Priority | File                                 | Change                       | Risk   |
| -------- | ------------------------------------ | ---------------------------- | ------ |
| **P0**   | `src/session/llm.ts`                 | Add `stopWhen` / multi-step  | Low    |
| **P0**   | `src/session/processor.ts`           | Accumulate tokens (line 275) | Low    |
| **P1**   | `src/session/prompt.ts`              | Simplify outer loop          | Medium |
| **P1**   | `src/session/llm.ts:StreamInput`     | Add `maxInternalSteps`       | Low    |
| **P2**   | `src/tool/tool.ts`                   | Add `concurrency` field      | Low    |
| **P2**   | `src/session/prompt.ts:resolveTools` | Semaphore wrapping           | Medium |
| **P2**   | All tool files                       | Annotate concurrency         | Low    |
| **P3**   | `src/session/llm.ts`                 | Add `prepareStep`            | Medium |

## 6. Risk Assessment

| Risk                                 | Severity | Mitigation                                                                       |
| ------------------------------------ | -------- | -------------------------------------------------------------------------------- |
| Two edits to same file in parallel   | High     | Already mitigated by `FileTime.withLock` (Semaphore per filepath)                |
| Permission prompt ordering           | Medium   | `Permission.ask()` uses `Deferred`. Multiple asks queue in UI.                   |
| Snapshot tracking across multi-step  | Medium   | `ctx.snapshot` set at `start-step`, consumed at `finish-step`. Already per-step. |
| Token accumulation                   | Low      | Switch from overwrite to accumulation in processor.ts:275                        |
| Doom loop detection across SDK steps | Medium   | Uses `MessageV2.parts()` which reads persisted parts. Works across steps.        |
| Tool results out of order            | Low      | Processor uses `ctx.toolcalls` keyed by `toolCallId`. Order-independent.         |
| Compaction mid-step                  | Medium   | `Stream.takeUntil(() => ctx.needsCompaction)` aborts SDK loop cleanly.           |
| Dynamic tools (tool_search)          | Medium   | Phase 3 `prepareStep` solves this. Phase 1 uses original tools dict.             |

### Breaking Changes

| Change                 | Backward-Compatible?                                       |
| ---------------------- | ---------------------------------------------------------- |
| Multi-step SDK         | Yes — outer loop still works, iterates less                |
| Token accumulation     | Subtle — "total tokens" now means all steps, not just last |
| `Tool.Def.concurrency` | Yes — defaults to `"unsafe"`                               |

## 7. Testing Strategy

### Unit Tests

| Test               | File                             | What                                       |
| ------------------ | -------------------------------- | ------------------------------------------ |
| Token accumulation | `test/session/processor.test.ts` | Multiple `finish-step` → cumulative tokens |
| Concurrency field  | `test/tool/tool.test.ts`         | Each tool's `concurrency` matches expected |
| Multi-step stream  | `test/session/llm.test.ts`       | `stepCountIs(3)` emits multiple step pairs |

### Integration Tests

| Test                       | What                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| Read + Grep parallel       | Two read-only tools in same step → concurrent (wall-clock)                     |
| Edit + Edit sequential     | Two edits to different files → both succeed                                    |
| Edit same file             | Two edits to same file → `withLock` prevents corruption                        |
| Permission during parallel | One needs permission, another auto-approved → approved completes while waiting |
| Compaction mid-step        | Overflow during multi-step → clean abort via `takeUntil`                       |
| Doom loop                  | Same tool 3+ times identical args → permission prompt fires                    |

### Performance Benchmarks

| Scenario                                     | Expected Improvement                                 |
| -------------------------------------------- | ---------------------------------------------------- |
| Multi-step tool loop (read → analyze → edit) | 200-500ms saved per eliminated outer loop iteration  |
| 5-step agent session                         | Identical total tokens (no duplicate system prompts) |

## 8. Recommendation

**Start with Phase 1 only.** The AI SDK already parallelizes tools within a step. The main win is enabling multi-step to eliminate outer loop overhead. Phase 2 is defensive. Phase 3 is edge-case for deferred tools.
