# Design: Observational Memory + Engram Integration

## Technical Approach

Three components wired with zero new DB tables: (1) `SystemPrompt.recall(pid)` fetches Engram context at session start, (2) `session/prompt.ts` computes recall and passes it into `handle.process({ ..., recall })`, then `session/llm.ts` reads `input.recall` and inserts it explicitly as `system[1]`, (3) AutoDream reads session summaries, with a minimal fallback signal when summaries are absent, and threads that context into the dream prompt for Engram persistence.

## Architecture Decisions

| Decision                   | Choice                                                        | Alternatives                               | Rationale                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recall data source         | MCP `mem_context` tool via `MCP.tools()` → execute            | Shell out to `engram` CLI                  | MCP client already connected; reuses existing transport, no child process spawn                                                                                                                   |
| System array slot          | Append to `system[1]` (BP3: 5min cache)                       | Inject as `system[2]` (volatile, uncached) | Recall is stable per session — 5min cache is appropriate. Volatile slot wastes cache for no reason                                                                                                |
| Recall trigger             | `step === 1` guard + cache in closure var                     | InstanceState cache                        | Recall is per-prompt-loop, not per-project. A simple `let recall: string \| undefined` in the `run()` closure suffices. InstanceState is overkill here since the loop already scopes the lifetime |
| Summary extraction         | Filter `msg.info.summary === true` with fallback to last msgs | New DB table `ObservationTable`            | Phase 1 reuses existing compaction summaries; when none exist, fallback to recent user+assistant text keeps minimal memory signal without migrations                                              |
| Dream prompt format        | Append `## Session Observations` section                      | Structured JSON block                      | Dream agent is LLM-driven; markdown is natural for it to parse and act on                                                                                                                         |
| Token budget for summaries | 4000 tokens cap via `Token.estimate`                          | Uncapped                                   | Prevents blowing dream context window on sessions with many compactions                                                                                                                           |

## Data Flow

```
Session Idle Event
       │
       ▼
AutoDream.init()──────► Bus.subscribe(Event.Idle, (event) => { void idle(event.properties.sessionID) })
       │
       ▼
idle(sid)
       │
       ├──► Session.messages({sessionID})
       │         │
       │         ▼
       │    filter summary === true
       │    if empty: fallback to last 10 user+assistant text msgs
       │    cap fallback at ~2000 tokens
       │         │
       │         ▼
       ├──► PROMPT + "## Session Observations\n{summaries}"
       │
       ▼
spawn(prompt)──────► Dream agent session
       │
       ▼
Dream agent calls mem_save/mem_update
       │
       ▼
Engram DB updated
       │
       ▼ (next session start, step === 1)
       │
SystemPrompt.recall()
       │
       ├──► MCP.tools() → find engram_mem_context
       │         │
       │         ▼
       │    tool.execute({limit: 30, project: pid})
       │         │
       │         ▼
       │    format response → string (~2000 tokens max)
       │
       ▼
`session/llm.ts` inserts recall as explicit system[1]
```

## File Changes

| File                    | Action | Description                                                                                        |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `src/session/system.ts` | Modify | Add `recall(pid: string): Promise<string \| undefined>`                                            |
| `src/session/prompt.ts` | Modify | Compute `recall` via `SystemPrompt.recall(pid)` and pass it into `handle.process({ ..., recall })` |
| `src/session/llm.ts`    | Modify | Extend `LLM.StreamInput` with `recall?: string`; insert recall at `system[1]`                      |
| `src/dream/index.ts`    | Modify | Keep `run(focus?)` public API; add internal `idle(sid)` for idle summaries threading               |
| `src/dream/prompt.txt`  | Modify | Add `## Session Observations` section with instructions for `mem_save` with `topic_key`            |

## Interfaces / Contracts

### Component 1: Recall injection architecture

```typescript
// session/prompt.ts
type Build = {
  system: string[]
  recall?: string
  // ...existing fields...
}
```

`SystemPrompt.recall(pid)` still fetches context from Engram. The architecture fix is direction and separation: `session/prompt.ts` computes recall first, passes it into `handle.process({ ..., recall })`, and `session/llm.ts` owns exact placement via `input.recall`.

### Component 2: Recall insertion in `session/prompt.ts` + `session/llm.ts`

```typescript
// prompt.ts
let recall: string | undefined
const mem = step === 1 ? yield * Effect.promise(() => SystemPrompt.recall(Instance.project.id)) : recall
if (step === 1) recall = mem

return {
  system,
  recall,
  // ...existing fields...
}

// session/llm.ts (extend LLM.StreamInput, then after system.push(baseJoin), before volatile push)
type StreamInput = LLM.StreamInput & {
  recall?: string
}

if (input.recall) system.splice(1, 0, input.recall)
```

Call path stays the same: `MCP.tools()` returns `Record<string, Tool>`. Find key matching `engram_mem_context`. Call `tool.execute({limit: 30, project: pid})`. Response is `CallToolResult` with `content[].text`. Join text, wrap in `<engram-recall>` tags. If `MCP.tools()` has no engram key, return `undefined`.

### Component 3: AutoDream session threading

```typescript
// dream/index.ts — keep public run(focus?), add internal idle(sid)
async function summaries(sid: string): Promise<string> {
  const msgs = await Session.messages({ sessionID: sid as any })
  const obs: string[] = []
  let cap = 0
  const sum = msgs
    .filter((x) => x.info.role === "assistant" && x.info.summary)
    .flatMap((x) => x.parts)
    .filter((x) => x.type === "text")
    .map((x) => x.text)
  if (sum.length > 0) {
    for (const txt of sum) {
      const est = Token.estimate(txt)
      if (cap + est > 4000) break
      obs.push(txt)
      cap += est
    }
    return obs.join("\n---\n")
  }

  const back = msgs
    .filter((x) => x.info.role === "user" || x.info.role === "assistant")
    .flatMap((x) => x.parts)
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .slice(-10)
  obs.length = 0
  cap = 0
  for (const txt of back) {
    const est = Token.estimate(txt)
    if (cap + est > 2000) break
    obs.push(txt)
    cap += est
  }
  return obs.join("\n---\n")
}

export async function run(focus?: string): Promise<string> {
  // ... existing Engram.ensure() check ...
  const result = await spawn(focus, "")
  // ...
}

async function idle(sid: string): Promise<string> {
  // ... existing Engram.ensure() check ...
  const obs = await summaries(sid)
  const result = await spawn(undefined, obs)
  // ...
}

Bus.subscribe(Event.Idle, (event) => {
  void idle(event.properties.sessionID)
})
```

### Component 4: Dream prompt update

Append to `dream/prompt.txt`:

```
## Session Observations

{observations}

If session observations are provided above, use them to:
1. Search existing memory for related observations (mem_search)
2. If a matching topic exists, update it (mem_update) — do NOT create duplicates
3. If no match, create new observations (mem_save) with topic_key format:
   project/{project-name}/session-insight/{topic}
4. Focus on decisions, patterns, bugs, and architectural choices from the session
5. Ignore routine tool calls and boilerplate — extract only meaningful signal
```

The `{observations}` placeholder is replaced by `summaries()` output at runtime. When empty, the section is omitted entirely.

## Degradation Table

| Condition                   | Behavior                                                                      | User impact                                    |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Engram not installed        | `recall()` → `undefined`, `run()` → error string                              | No recall, no dreaming. Session works normally |
| Engram MCP not connected    | `MCP.tools()` has no `engram_*` keys → `undefined`                            | Same as above                                  |
| `mem_context` returns empty | `recall()` → `undefined` (no usable content)                                  | First session ever — expected                  |
| `mem_context` call throws   | `Effect.catchAll((_) => Effect.succeed(undefined))` in `recall()`             | Silent degradation, logged                     |
| Session has no summaries    | `summaries()` falls back to last 10 user+assistant text msgs (2000 token cap) | Dream retains minimal session signal           |
| AutoDream SDK not set       | `spawn()` throws → caught by `run()`                                          | Dream fails gracefully, logged                 |
| Token budget exceeded       | `summaries()` truncates at 4000 tokens                                        | Oldest summaries included, newest may be cut   |

## Testing Strategy

| Layer | What to Test                                                             | Approach                                                      |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Unit  | `SystemPrompt.recall()` returns formatted string when Engram tool exists | Mock `MCP.tools()` to return a fake `engram_mem_context` tool |
| Unit  | `SystemPrompt.recall()` returns `undefined` when no Engram               | Mock `MCP.tools()` to return empty record                     |
| Unit  | `summaries()` uses summary-first extraction with fallback to recent msgs | Create `MessageV2.WithParts[]` fixtures, verify both paths    |
| Unit  | `summaries()` respects 4000 token cap                                    | Fixture with large text, verify truncation                    |
| Unit  | Dream prompt includes observations section when provided                 | String assertion on constructed prompt                        |
| Unit  | Dream prompt omits section when no observations                          | String assertion                                              |

## Migration / Rollout

No migration required. Phase 1 uses only existing data structures (`summary: true` messages) and existing MCP transport (Engram). Rollback is a code revert with zero data impact.

## Open Questions

- [x] All resolved — no blockers for Phase 1.
