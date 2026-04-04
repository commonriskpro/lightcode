# Technical Design: Deferred Tools / Tool Search (Hybrid)

## Goal

Implementar deferred tools (lazy tool loading) de forma agnóstica al provider, funcionando en:

- Modelos con soporte nativo (Anthropic, OpenAI)
- Modelos open-source (DeepSeek, Qwen, Llama, Ollama, vLLM, etc.)
- Cualquier modelo que soporte function calling básico

## Background

### Native Deferred (Anthropic + OpenAI)

Claude Code implementa esto con:

- `shouldDefer: true` en tool definitions
- `tool_reference` blocks en respuestas del modelo

OpenAI implementa lo mismo con:

- `defer_loading: true` en tool definitions
- `tool_search` tool
- `tool_search_call` / `tool_search_output` en respuestas

### Client-Side Deferred (Universal)

Para modelos que NO soportan el protocolo nativo pero sí function calling básico:

- Enviar un **ToolIndex** con hints de cada tool deferred
- Incluir un **ToolSearchTool** que el modelo puede invocar
- Cuando el modelo llama ToolSearchTool, devolver los schemas de las tools matching

---

## Codebase Analysis — How Tools Flow Today

Before implementing, you MUST understand the existing pipeline:

### Pipeline: Tool Registration → LLM Call

```
1. ToolRegistry.tools(model, agent)
   └─ src/tool/registry.ts line 177
   └─ Returns: (Tool.Def & { id: string })[]
   └─ Filters by model/provider (e.g. codesearch only for opencode provider)
   └─ Calls tool.init({ agent }) for each tool → resolves Def

2. SessionPrompt.resolveTools(...)
   └─ src/session/prompt.ts line 388
   └─ Iterates registry.tools() output
   └─ Wraps each in AI SDK `tool()` with jsonSchema + execute
   └─ ALSO iterates mcp.tools() separately (MCP tools are NOT in registry)
   └─ Returns: Record<string, AITool>

3. LLM.stream(input)
   └─ src/session/llm.ts line 80
   └─ Receives tools as Record<string, AITool>
   └─ Passes them to streamText({ tools, ... })
   └─ AI SDK handles tool serialization per provider

4. SessionProcessor.handleEvent(event)
   └─ src/session/processor.ts line 111
   └─ Handles: tool-call, tool-result, tool-error events
   └─ No awareness of "deferred" — every tool in the dict is callable
```

### Key Types

```typescript
// src/tool/tool.ts — Tool.Def (what registry returns)
interface Def<P, M> {
  description: string
  parameters: P          // zod schema
  execute(args, ctx): Promise<{ title, metadata, output }>
  formatValidationError?(error): string
  // NOTE: NO shouldDefer field exists yet
}

// src/tool/tool.ts — Tool.Info (pre-init handle)
interface Info<P, M> {
  id: string
  init: (ctx?) => Promise<Def<P, M>>
}

// AI SDK tool() — what gets sent to LLM
// Created in SessionPrompt.resolveTools, line 441
tool({
  id: item.id,
  description: item.description,
  inputSchema: jsonSchema(schema),
  execute(args, options) { ... }
})
```

### Critical: MCP Tools Are Separate

MCP tools are NOT part of ToolRegistry. They are resolved in `SessionPrompt.resolveTools`
via `mcp.tools()` (line 476) and merged into the same `Record<string, AITool>` dict.
Any deferred tool implementation MUST handle MCP tools too.

### Critical: AI SDK Abstraction

OpenCode uses the Vercel AI SDK (`streamText` from "ai" package). The SDK handles
serialization to provider-specific formats. The `tool()` helper produces an `AITool`.
We do NOT manually build JSON schemas for the wire — the SDK does it.

This means:

- We CANNOT inject `defer_loading: true` into the AI SDK tool format directly
- Native deferred would require AI SDK support OR a middleware/provider wrapper
- Hybrid mode (client-side) works entirely within our control

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenCode — Tool Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ToolRegistry.tools()      MCP.tools()                          │
│        │                       │                                 │
│        └───────┬───────────────┘                                │
│                │                                                 │
│                ▼                                                 │
│  SessionPrompt.resolveTools()                                   │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐       │
│  │         NEW: filterByDeferMode(model)               │       │
│  │                                                      │       │
│  │  if hybrid:                                          │       │
│  │    core tools → Record<string, AITool>              │       │
│  │    deferred → ToolIndex in system prompt             │       │
│  │    + ToolSearchTool added to core                   │       │
│  │                                                      │       │
│  │  if fallback:                                        │       │
│  │    all tools → Record<string, AITool>               │       │
│  └─────────────────────────────────────────────────────┘       │
│                │                                                 │
│                ▼                                                 │
│        LLM.stream({ tools, system })                            │
│                │                                                 │
│                ▼                                                 │
│        SessionProcessor (unchanged)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Deferred Strategy per Model

| Capability                      | Mode         | Description                |
| ------------------------------- | ------------ | -------------------------- |
| `tool_call: true` + large model | **Hybrid**   | ToolIndex + ToolSearchTool |
| `tool_call: true` + few tools   | **Fallback** | Send all tools directly    |
| `tool_call: false`              | **No tools** | Skip entirely              |

> NOTE: Native mode (Anthropic/OpenAI `defer_loading`) is deferred to a future phase
> because the AI SDK does not expose `defer_loading` in `tool()`. It would require
> a custom provider middleware or upstream SDK support.

---

## Implementation

### Phase 1: Core (Hybrid Mode)

#### 1.1 Add `shouldDefer` and `searchHint` to Tool.Def

```typescript
// src/tool/tool.ts — add to Def interface
export interface Def<P extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  description: string
  parameters: P
  execute(args: z.infer<P>, ctx: Context): Promise<{ title: string; metadata: M; output: string }>
  formatValidationError?(error: z.ZodError): string
  shouldDefer?: boolean // ← NEW: defer this tool
  searchHint?: string // ← NEW: short hint for index (~50 chars max)
}
```

Also propagate through `Tool.Info`:

```typescript
export interface Info<P extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  shouldDefer?: boolean // ← NEW: set at registration time
  searchHint?: string // ← NEW: set at registration time
  init: (ctx?: InitContext) => Promise<Def<P, M>>
}
```

#### 1.2 Mark tools as deferred in registry

```typescript
// src/tool/registry.ts — in the `all` Effect
return [
  invalid,
  ...(question ? [ask] : []),
  bash,
  read,
  glob,
  grep,
  edit,
  write,
  task,
  // Deferred tools — these are available but hidden from initial context
  { ...fetch, shouldDefer: true, searchHint: "Fetch URL content" },
  { ...todo, shouldDefer: true, searchHint: "Create and manage todo lists" },
  { ...search, shouldDefer: true, searchHint: "Web search via Exa" },
  { ...code, shouldDefer: true, searchHint: "Search code via Context7" },
  skill,
  { ...patch, shouldDefer: true, searchHint: "Apply unified diff patches" },
  ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL
    ? [{ ...lsp, shouldDefer: true, searchHint: "Language server diagnostics" }]
    : []),
  ...(cfg.experimental?.batch_tool === true
    ? [{ ...batch, shouldDefer: true, searchHint: "Run multiple tools in parallel" }]
    : []),
  ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [plan] : []),
  ...custom,
]
```

> MCP tools: ALL MCP tools should be deferred by default. They come from
> `SessionPrompt.resolveTools` via `mcp.tools()`. We tag them in that loop.

#### 1.3 Create ToolSearchTool

```typescript
// src/tool/search.ts — NEW FILE
import z from "zod"
import { Tool } from "./tool"

interface IndexEntry {
  id: string
  hint: string
  description: string
  parameters: z.ZodType
  execute: Tool.Def["execute"]
}

// Mutable state — populated per session by resolveTools
let index: IndexEntry[] = []

export function setIndex(entries: IndexEntry[]) {
  index = entries
}

export function getIndex() {
  return index
}

function search(query: string, max: number): IndexEntry[] {
  const lower = query.toLowerCase().trim()

  // select:tool1,tool2 syntax
  const select = lower.match(/^select:(.+)$/)
  if (select) {
    const names = select[1].split(",").map((s) => s.trim())
    return index.filter((t) => names.includes(t.id.toLowerCase()))
  }

  // Keyword search with scoring
  const terms = lower.split(/\s+/).filter((t) => t.length > 0)
  const scored = index.map((entry) => {
    let score = 0
    for (const term of terms) {
      if (entry.id.toLowerCase().includes(term)) score += 10
      if (entry.hint.toLowerCase().includes(term)) score += 5
      if (entry.description.toLowerCase().includes(term)) score += 2
    }
    return { entry, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.entry)
}

export const ToolSearchTool = Tool.define("tool_search", {
  description: `Search and load deferred tools by name or keyword.

When called, returns the names of tools matching the query.
After this tool returns, the matched tools become callable in subsequent turns.

Available deferred tools are listed in <deferred-tools> in the system prompt.

Query formats:
- "select:webfetch,lsp" — load specific tools by exact name
- "web search" — keyword search, returns up to max_results
- "+mcp slack" — require "mcp" in name, rank by remaining terms`,
  parameters: z.object({
    query: z.string().describe("Search query or select:tool_name,tool_name2"),
    max_results: z.number().optional().default(5).describe("Max results (default 5)"),
  }),
  async execute({ query, max_results }, ctx) {
    const matches = search(query, max_results ?? 5)
    return {
      title: `Found ${matches.length} tools`,
      metadata: { matches: matches.map((m) => m.id) },
      output:
        matches.length === 0
          ? "No matching tools found. Check available tools in <deferred-tools>."
          : matches.map((m) => `- ${m.id}: ${m.hint}`).join("\n"),
    }
  },
})
```

#### 1.4 Modify `SessionPrompt.resolveTools` — the integration point

This is the CRITICAL change. `resolveTools` (src/session/prompt.ts line 388) must:

1. Separate core vs deferred tools
2. Register deferred tools in the ToolSearchTool index
3. Actually make deferred tools callable when model invokes them
4. Inject tool index into system prompt

```typescript
// src/session/prompt.ts — inside resolveTools Effect
// After building `tools` dict from registry + MCP...

import { setIndex, getIndex, ToolSearchTool } from "@/tool/search"
import { Flag } from "@/flag/flag"

// Inside resolveTools, after the existing for-loops that build `tools`:

if (Flag.OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS) {
  const threshold = 15  // Only defer when we have many tools
  const allKeys = Object.keys(tools)

  if (allKeys.length >= threshold) {
    const deferred: Record<string, typeof tools[string]> = {}
    const indexEntries: IndexEntry[] = []

    // Partition: core stays, deferred gets removed but indexed
    for (const [key, t] of Object.entries(tools)) {
      // Check if tool should be deferred
      const registryItem = /* lookup from registry results */
      const isMcp = key.startsWith("mcp_") || key.includes("__")
      const shouldDefer = registryItem?.shouldDefer || isMcp

      if (shouldDefer) {
        deferred[key] = t
        indexEntries.push({
          id: key,
          hint: registryItem?.searchHint || t.description?.slice(0, 80) || key,
          description: t.description || "",
          parameters: t.inputSchema,
          execute: t.execute,
        })
        delete tools[key]
      }
    }

    // Register index for ToolSearchTool to use
    setIndex(indexEntries)

    // Add ToolSearchTool itself (always available)
    const searchDef = await ToolSearchTool.init()
    const searchSchema = ProviderTransform.schema(input.model, z.toJSONSchema(searchDef.parameters))
    tools["tool_search"] = tool({
      id: "tool_search",
      description: searchDef.description,
      inputSchema: jsonSchema(searchSchema),
      execute(args, options) {
        return Effect.runPromise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            const result = yield* Effect.promise(() => searchDef.execute(args, ctx))

            // KEY: After search returns matches, add those tools BACK
            // to the tools dict so they're callable on the next turn
            const matches = getIndex().filter(e =>
              result.metadata.matches?.includes(e.id)
            )
            for (const match of matches) {
              if (tools[match.id]) continue  // already loaded
              // Re-add the deferred tool as callable
              tools[match.id] = deferred[match.id]
            }

            return result
          }),
        )
      },
    })
  }
}
```

> IMPORTANT: The `tools` dict in `resolveTools` is passed to `LLM.stream` which
> passes it to `streamText`. The AI SDK resolves tools on EACH step of the
> tool-call loop. So adding tools to the dict mid-conversation works — the next
> step will see the newly added tools.

#### 1.5 Inject ToolIndex into system prompt

```typescript
// src/session/prompt.ts — inside runLoop, around line 1501-1507
// Where system prompt is built:

const [skills, env, instructions, modelMsgs] =
  yield *
  Effect.all([
    Effect.promise(() => SystemPrompt.skills(agent)),
    Effect.promise(() => SystemPrompt.environment(model)),
    instruction.system().pipe(Effect.orDie),
    Effect.promise(() => MessageV2.toModelMessages(msgs, model)),
  ])

// NEW: Add deferred tools index
const deferredIndex = getIndex()
const deferredSection =
  deferredIndex.length > 0
    ? `<deferred-tools>\nThe following tools are available but not loaded. Use tool_search to load them:\n${deferredIndex
        .map((t) => `- ${t.id}: ${t.hint}`)
        .join("\n")}\n</deferred-tools>`
    : ""

const system = [...env, ...(skills ? [skills] : []), ...instructions, deferredSection].filter(Boolean)
```

#### 1.6 Feature flag

```typescript
// src/flag/flag.ts — add
export const OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS = !!process.env.OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS
```

---

### Phase 2: Native Mode (Future)

Native mode requires one of:

- AI SDK adding `defer_loading` support to `tool()` helper
- Custom middleware that intercepts tool definitions before they hit the wire
- Custom provider wrapper that adds `defer_loading` to the JSON payload

This is tracked separately and not blocking Phase 1.

---

## Tool Lifecycle in Hybrid Mode

```
Turn 1:
  System: "Available deferred: lsp, websearch, codesearch, mcp_slack..."
  Tools:  [bash, read, write, edit, grep, glob, task, skill, tool_search]
  User:   "Find all TypeScript errors in the project"

Turn 2:
  Model calls: tool_search({ query: "select:lsp" })
  → ToolSearchTool executes, finds "lsp" in index
  → Adds lsp back to tools dict
  → Returns: "- lsp: Language server diagnostics"

Turn 3:
  Tools now: [bash, read, write, edit, grep, glob, task, skill, tool_search, lsp]
  Model calls: lsp({ action: "diagnostics", ... })
  → LSP tool executes normally
```

---

## Session State Considerations

### Per-session tool index

The `setIndex()` / `getIndex()` approach uses module-level state. This is wrong
for concurrent sessions. Instead:

```typescript
// Store discovered tools per session
// Option A: Pass through Tool.Context
// Option B: Store in Session metadata
// Option C: Use a WeakMap keyed by session abort signal
```

**Recommended**: Use the `tools` dict reference that's already scoped per
`resolveTools` call. The deferred dict is a closure variable — no global state needed.

### Compaction

When the session compacts, tool_search results are in the message history.
After compaction, the model loses context about which tools were discovered.
The deferred tools should be re-added to the tools dict based on:

1. Scanning message history for past tool_search results
2. OR keeping a `Set<string>` of discovered tool IDs on the session

### Retry / Resume

When a session resumes, `resolveTools` runs again. The deferred tools won't
be in the tools dict. Need to scan message history for prior tool_search calls
and pre-load those tools.

---

## Testing Strategy

### Unit Tests (src/tool/search.test.ts)

- `search("select:lsp")` → exact match
- `search("select:lsp,websearch")` → multi-select
- `search("language server")` → keyword match
- `search("nonexistent")` → empty result
- `search("+mcp slack")` → required term

### Integration Tests

- Verify core tools sent without deferred when < threshold
- Verify deferred tools removed from tools dict when >= threshold
- Verify ToolSearchTool added when hybrid mode active
- Verify tool_search call loads tool back into dict
- Verify loaded tool is callable on next step

### E2E Tests

- Full conversation: user asks → model searches → model uses loaded tool

---

## Provider Support Matrix

| Provider      | Models     | Mode   | Notes                       |
| ------------- | ---------- | ------ | --------------------------- |
| **Anthropic** | All Claude | Hybrid | Works with function calling |
| **OpenAI**    | All GPT    | Hybrid | Works with function calling |
| **DeepSeek**  | R1, V3     | Hybrid | Function calling documented |
| **Qwen**      | 3+, 2.5    | Hybrid | OpenAI-compatible API       |
| **Llama**     | 4, 3       | Hybrid | Depends on serving platform |
| **Ollama**    | Various    | Hybrid | Varies by model             |
| **vLLM**      | Various    | Hybrid | OpenAI-compatible           |
| **Google**    | Gemini     | Hybrid | Works with function calling |
| **xAI**       | Grok       | Hybrid | Works with function calling |

---

## Files to Modify

| File                        | Change                                              | Priority |
| --------------------------- | --------------------------------------------------- | -------- |
| `src/tool/tool.ts`          | Add `shouldDefer`, `searchHint` to `Def` and `Info` | P0       |
| `src/tool/search.ts`        | **NEW** — ToolSearchTool + search logic             | P0       |
| `src/tool/registry.ts`      | Mark tools with `shouldDefer` + propagate to Info   | P0       |
| `src/session/prompt.ts`     | Modify `resolveTools` — partition + index + inject  | P0       |
| `src/flag/flag.ts`          | Add `OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS`          | P0       |
| `src/session/system.ts`     | (no change — index injected in prompt.ts)           | —        |
| `src/session/processor.ts`  | (no change — tool events work unchanged)            | —        |
| `src/session/llm.ts`        | (no change — tools dict passed through)             | —        |
| `src/provider/transform.ts` | (no change for Phase 1)                             | —        |

---

## Risk Assessment

| Risk                                       | Mitigation                                              |
| ------------------------------------------ | ------------------------------------------------------- |
| Model doesn't use tool_search              | System prompt instructs; fallback sends all             |
| Deferred tool not found after compaction   | Scan history for prior tool_search calls                |
| AI SDK doesn't re-read tools dict per step | Verify: `streamText` re-resolves `activeTools` per step |
| Too few tools to justify deferring         | Threshold check (default: 15 tools)                     |
| Concurrent sessions sharing global index   | Use closure-scoped state, not module globals            |

---

## Open Questions

1. **Threshold tuning**: What's the right number of tools to trigger deferring? (proposed: 15)
2. **MCP auto-defer**: Should ALL MCP tools always be deferred, or only when count > threshold?
3. **Tool re-discovery after compaction**: Scan history vs. persist discovered set on session?
4. **AI SDK `activeTools` behavior**: Does it re-read the tools dict on each step, or snapshot once?
