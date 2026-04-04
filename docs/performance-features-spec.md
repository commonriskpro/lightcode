# Performance Features — Proposal, Spec & Design

Three performance features to reduce latency, improve cache hit rates, and lower token costs.

---

## Feature 1: Tool Concurrency Safety

### Problem

The AI SDK runs ALL tool calls from one model response via `Promise.all` — no distinction between safe and unsafe tools. Two `edit` calls to overlapping files, or `edit` + `bash` touching the same path, can race and corrupt state.

Today `edit` has `FileTime.withLock` per filepath, which prevents two edits to the SAME file. But `edit` + `bash rm` to the same file, or two `bash` commands with side effects, have no protection.

### Current State

```
Model returns: [tool_call(grep, "auth"), tool_call(edit, "file.ts"), tool_call(bash, "npm test")]
AI SDK: Promise.all([grep(), edit(), bash()])  ← ALL concurrent, no control
```

### Proposed State

```
Model returns: [tool_call(grep, "auth"), tool_call(edit, "file.ts"), tool_call(bash, "npm test")]
Execution:
  1. grep("auth")          → runs immediately (safe)
  2. edit("file.ts")       → waits for semaphore (unsafe)
  3. bash("npm test")      → waits for semaphore (unsafe)
  2 and 3 run sequentially, 1 runs in parallel with both
```

### Classification

| Tool                                  | Side Effects             | Safe?                   |
| ------------------------------------- | ------------------------ | ----------------------- |
| `read`, `glob`, `grep`                | Read-only filesystem     | ✅ safe                 |
| `webfetch`, `websearch`, `codesearch` | External API (read-only) | ✅ safe                 |
| `lsp`                                 | LSP queries (read-only)  | ✅ safe                 |
| `invalid`                             | Error response           | ✅ safe                 |
| `tool_search`                         | Mutates tools dict       | ✅ safe (no filesystem) |
| `edit`, `write`, `apply_patch`        | Write files              | ❌ unsafe               |
| `bash`                                | Arbitrary shell          | ❌ unsafe               |
| `task`                                | Spawn subagent           | ❌ unsafe               |
| `question`                            | Block on user input      | ❌ unsafe               |
| `todowrite`                           | Write state              | ❌ unsafe               |
| `skill`                               | Load instructions        | ✅ safe                 |
| MCP tools                             | Unknown                  | ❌ unsafe (default)     |

### Design

#### 1. Add `concurrent` field to `Tool.Def` (`tool.ts`)

```ts
export interface Def<...> {
  // ... existing fields
  concurrent?: boolean  // default false (unsafe)
}
```

#### 2. Wrap unsafe tool execute with semaphore (`prompt.ts`)

In `resolveTools()`, wrap the `execute` function of unsafe tools with a shared semaphore:

```ts
const sem = new Semaphore(1) // one unsafe tool at a time

const wrapped = tool({
  execute(args, options) {
    if (item.concurrent) {
      return doExecute(args, options)
    }
    return sem.acquire().then(() => doExecute(args, options).finally(() => sem.release()))
  },
})
```

#### 3. Mark safe tools in registry

```ts
// In each tool definition file:
export const GrepTool = Tool.define("grep", async () => ({
  concurrent: true, // read-only
  // ...
}))
```

### Files to Modify

| File                    | Change                                        |
| ----------------------- | --------------------------------------------- |
| `src/tool/tool.ts`      | Add `concurrent?: boolean` to `Def` interface |
| `src/session/prompt.ts` | Semaphore wrapping in `resolveTools()`        |
| `src/tool/read.ts`      | `concurrent: true`                            |
| `src/tool/glob.ts`      | `concurrent: true`                            |
| `src/tool/grep.ts`      | `concurrent: true`                            |
| `src/tool/webfetch.ts`  | `concurrent: true`                            |
| `src/tool/search.ts`    | `concurrent: true` (tool_search)              |
| `src/tool/skill.ts`     | `concurrent: true`                            |
| `src/tool/invalid.ts`   | `concurrent: true`                            |
| `src/tool/lsp.ts`       | `concurrent: true`                            |

All other tools default to `false` (unsafe, sequential).

### Risk

| Risk                                        | Mitigation                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Performance regression (semaphore overhead) | Only unsafe tools pay the cost. Safe tools are unaffected.                  |
| Deadlock                                    | Single semaphore, no nesting. Safe tools don't acquire.                     |
| Tool execution order                        | Results arrive in any order — AI SDK handles this via `toolCallId` matching |

---

## Feature 2: Prompt Cache Stability Sorting

### Problem

The tool list sent to the API determines the prompt hash for caching. If tool order changes between API calls, the prompt cache misses. Today:

1. **Builtin tools**: Deterministic order (hardcoded in `registry.ts`) ✅
2. **MCP tools**: Order depends on `MCP.tools()` response — may vary ❌
3. **Deferred tools**: Mutate the tools dict between steps when `tool_search` loads them ❌
4. **Custom/plugin tools**: Appended after builtins — depends on plugin load order ❌

### Proposed Fix

Sort the final tools dict alphabetically by tool name before passing to `streamText`. This makes the order deterministic regardless of registration order.

### Where the sort happens

In `llm.ts`, right before passing tools to `streamText`:

```ts
// Sort tools alphabetically for prompt cache stability
const sorted = Object.fromEntries(Object.entries(input.tools).sort(([a], [b]) => a.localeCompare(b)))
```

### Why alphabetical?

1. Deterministic across sessions, restarts, and MCP reconnections
2. Stable when deferred tools are loaded mid-stream (added in sorted position)
3. Simple — no configuration needed
4. Same approach Claude Code uses (`assembleToolPool()` sorts for cache stability)

### Impact

For Anthropic models with prompt caching: each tool definition is ~200-400 tokens. With 15+ tools, that's 3000-6000 tokens of tool definitions. A cache hit on this prefix saves significant input cost.

### Files to Modify

| File                 | Change                                              |
| -------------------- | --------------------------------------------------- |
| `src/session/llm.ts` | Sort `input.tools` before passing to `streamText()` |

Single line change. Zero risk.

### Edge Case: `prepareStep` and dynamic tools

When `tool_search` adds deferred tools between steps, the `prepareStep` callback in `llm.ts` updates `activeTools`. The sorted order must be maintained there too:

```ts
prepareStep({ tools }) {
  const active = Object.keys(input.tools).filter(k => !disabled[k]).sort()
  return { activeTools: active }
}
```

---

## Feature 3: Fork Subagent (Prompt Cache Sharing)

### Problem

When the `task` tool spawns a subagent:

1. A NEW session is created (`Session.create({ parentID })`)
2. The system prompt is rebuilt FROM SCRATCH (environment, skills, instructions, tools)
3. Tools are re-initialized (`tool.init()` for every tool)
4. The child starts with ZERO message history — only the task prompt

This means:

- **Full cache miss** on the system prompt (even if parent and child use the same model/agent)
- **Full tool resolution cost** (~200ms for 15+ tools)
- **No context sharing** — the child has to re-explore everything the parent already knows

### What Claude Code Does

Claude Code's `forkSubagent.ts` creates a "fork" that:

1. **Inherits the parent's EXACT system prompt** — same text = same cache hash = prompt cache HIT
2. **Inherits the parent's conversation history** via `buildForkedMessages()` — the child sees everything the parent saw
3. Uses `useExactTools: true` to inherit the parent's tool set (no re-resolution)
4. Has a recursive fork guard (no fork-within-fork)

The result: the forked subagent's API call prefix is IDENTICAL to the parent's, maximizing prompt cache hits on Anthropic.

### Design for LightCode

#### New agent mode: `fork`

When `task` tool is called WITHOUT a `subagent_type` (or with `subagent_type: "fork"`), instead of creating a fresh session:

1. **Copy the parent's system prompt** — pass it directly to the child session instead of rebuilding
2. **Copy the parent's messages** — inject them as the child's initial context
3. **Copy the parent's tool set** — skip `resolveTools()`, use the already-resolved tools
4. **Short directive prompt** — the task prompt is minimal because all context is inherited

#### Implementation

##### 1. Capture parent context in `prompt.ts`

In `handleSubtask()` and `resolveTools()`, capture the resolved system prompt and tools:

```ts
// In the runLoop, after building system prompt and resolving tools:
const forkContext = {
  system, // the built system prompt array
  tools, // the resolved tools dict
  messages: msgs, // the conversation history
}
```

##### 2. New `fork` path in `task.ts`

When `subagent_type` is missing or `"fork"`:

```ts
// task.ts
if (!params.subagent_type || params.subagent_type === "fork") {
  // Use parent's system, tools, and messages
  const result = await SessionPrompt.prompt({
    sessionID: session.id,
    model,
    agent: "build", // same as parent
    system: parentContext.system, // inherited
    tools: parentContext.tools, // inherited, no re-resolution
    forkMessages: parentContext.messages, // prepended to child history
    parts: promptParts,
  })
}
```

##### 3. Modify `SessionPrompt.prompt()` to accept fork context

Add optional `forkMessages` and `system` override parameters:

```ts
interface PromptInput {
  // ... existing fields
  forkMessages?: ModelMessage[] // prepend these to child's message history
  system?: string[] // use these instead of rebuilding system prompt
}
```

In `runLoop()`, when `forkMessages` is provided:

- Skip `SystemPrompt.environment()`, `SystemPrompt.skills()`, `resolveTools()` — use provided values
- Prepend `forkMessages` to the message history sent to the model

##### 4. Fork guard

Prevent fork-within-fork (exponential context explosion):

```ts
// In task.ts
const isFork = !params.subagent_type || params.subagent_type === "fork"
const parentIsFork = ctx.extra?.isFork === true
if (isFork && parentIsFork) {
  // Downgrade to regular subagent
  params.subagent_type = "general"
}
```

### Files to Modify

| File                    | Change                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| `src/tool/task.ts`      | Fork detection, pass parent context                                   |
| `src/session/prompt.ts` | Accept `forkMessages` + `system` override, skip rebuild when provided |
| `src/session/llm.ts`    | Accept pre-built system prompt                                        |

### Cache Savings Estimate

For a typical Anthropic session:

- System prompt: ~2000-4000 tokens
- Tool definitions: ~3000-6000 tokens
- Conversation history: ~5000-50000 tokens
- **Total cacheable prefix: ~10000-60000 tokens**

Without fork: child misses ALL of this → full input cost
With fork: child hits cache on ALL of this → cache read rate (90% discount on Anthropic)

For a session with 3 subagent calls: **30,000-180,000 tokens saved** per session.

### Risk

| Risk                        | Mitigation                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context too large for child | Child inherits parent's full history — could hit context limit. Mitigate: truncate fork messages to last N turns                                          |
| Fork-within-fork explosion  | Guard prevents recursive forks                                                                                                                            |
| Stale tool state in fork    | Fork uses parent's tools which were resolved at fork time. If MCP tools change between parent and child calls, fork has stale tools. Acceptable tradeoff. |
| Model mismatch              | Fork only works when child uses same model as parent. If different model, fall back to regular subagent.                                                  |

---

## Implementation Status

| #   | Feature                            | Status         | Commit    |
| --- | ---------------------------------- | -------------- | --------- |
| 1   | **Prompt cache stability sorting** | ✅ IMPLEMENTED | `797f614` |
| 2   | **Tool concurrency safety**        | ✅ IMPLEMENTED | `797f614` |
| 3   | **Fork subagent**                  | ✅ IMPLEMENTED | `797f614` |

All three features implemented in a single commit. Typecheck passes across all 13 packages.
