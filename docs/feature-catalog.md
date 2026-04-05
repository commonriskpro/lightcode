# LightCode Feature Catalog

> Code-verified. Every claim is tied to a source file. Last updated: 2026-04-05.

---

## Table of Contents

1. [Memory System](#1-memory-system)
2. [Prompt Caching (BP1–BP4)](#2-prompt-caching-bp1bp4)
3. [Session Compaction](#3-session-compaction)
4. [Fork Subagent](#4-fork-subagent)
5. [Tool System](#5-tool-system)
6. [Agents](#6-agents)
7. [TUI Commands](#7-tui-commands)
8. [Experimental Features (`/features`)](#8-experimental-features-features)
9. [Provider Support](#9-provider-support)
10. [Configuration Reference](#10-configuration-reference)

---

## 1. Memory System

LightCode has a native SQLite-backed memory system that persists context across and within sessions.

### Layer 1 — Cross-Session Recall

At session start (step 1 only), `Memory.buildContext()` loads native cross-session context from `lightcode.db`:

- **Semantic recall**: `SemanticRecall.search()` against `memory_artifacts` using the first user message as the query, with `recent()` fallback when FTS returns nothing
- **Working memory**: `WorkingMemory.getForScopes()` across `thread > agent > project`

Injected as:

- `system[2]` → `<memory-recall>`
- `system[3]` → `<working-memory>`

- Source: `src/session/prompt.ts`, `src/memory/provider.ts`, `src/memory/semantic-recall.ts`, `src/memory/working-memory.ts`

### Layer 2 — Intra-Session Observer

Background LLM extracts structured facts from the conversation every **6k tokens** (buffered) and activates asynchronously once the message threshold is reached. If OM falls behind, the main loop applies **backpressure** instead of running a duplicate synchronous observer path.

**OMBuf thresholds:**

| Signal     | Condition           | Action                  |
| ---------- | ------------------- | ----------------------- |
| `idle`     | < 6k new tokens     | no-op                   |
| `buffer`   | crossed 6k boundary | fork observer pipeline  |
| `activate` | ≥ 30k cumulative    | fork observer pipeline  |
| `block`    | ≥ `blockAfter`      | wait for OM to catch up |

Observations stored in `ObservationTable` (SQLite, session-scoped). Injected at `system[1]` each turn as `<local-observations>...</local-observations>`.

- Default model: `google/gemini-2.5-flash`
- Opt-out: `experimental.observer: false`
- Source: `src/session/om/buffer.ts`, `src/session/om/observer.ts`, `src/session/prompt.ts:1515-1569`

### Layer 3 — Reflector

When `observation_tokens` exceeds **40,000**, the Reflector condenses observations into reflections via a separate LLM call. Original observations are never cleared.

- `system[2]` injects `reflections ?? observations` — reflections take priority
- Uses same model as Observer (`observer_model`)
- Failure modes: silent early return, no throw
- Source: `src/session/om/reflector.ts`, `src/session/system.ts:79-83`

### Layer 4 — AutoDream (Cross-Session Consolidation)

When a session goes idle, a sandboxed `dream` agent reads local observations + compaction summaries and writes a project-scoped artifact into native memory.

- Trigger: `SessionStatus.Event.Idle` → `AutoDream.idle(sid)`
- Persistence: `AutoDream.persistConsolidation()` → `Memory.indexArtifact()` → `memory_artifacts`
- Flag check: skips if `experimental.autodream === false`
- Model fallback: `cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"`
- Manual trigger: `/dream [focus]`
- Source: `src/dream/index.ts`, `src/dream/daemon.ts`

### Memory Pipeline Summary

```
system[0]  BP2 1h    Agent prompt + env + instructions
system[1]  BP3 5min  Local observations or reflections (every turn)
system[2]  uncached  Semantic recall (step 1 only, session-frozen)
system[3]  uncached  Working memory (step 1 only, session-frozen)
system[last] uncached Volatile: date + model identity
```

---

## 2. Prompt Caching (BP1–BP4)

Four deterministic cache breakpoints applied before every Anthropic API call.

| BP  | Location                             | TTL  | Source                              |
| --- | ------------------------------------ | ---- | ----------------------------------- |
| BP1 | Last tool definition                 | 1h   | `src/session/llm.ts:286-296`        |
| BP2 | `system[0]` (agent prompt + env)     | 1h   | `src/provider/transform.ts:237-252` |
| BP3 | `system[1]` (recall or observations) | 5min | `src/provider/transform.ts:237-252` |
| BP4 | Penultimate conversation message     | 5min | `src/provider/transform.ts:237-252` |

**Tool sort for cache stability:** tools are sorted alphabetically before every call so the tool list hash is deterministic across sessions, MCP reconnections, and deferred tool loading.

- Source: `src/session/llm.ts:277-284`

---

## 3. Session Compaction

When context approaches the model's limit, LightCode compacts the session in two stages.

### Cut-Point Compaction (preferred)

Finds the most recent "safe cut point" in the message history — a boundary where discarding older messages preserves the minimum verbatim tail (`verbatim_keep`, default 20k tokens). No LLM call needed.

- Source: `src/session/cut-point.ts`, `src/session/compaction.ts:294-318`

### Iterative Summary Compaction (fallback)

If cut-point can't satisfy the overflow constraint, fires an LLM call to produce a structured summary. If a previous summary already exists, sends an `UPDATE` prompt instead of a full re-summarization.

- Summary template: role, goal, progress, key decisions, environment, next steps
- Source: `src/session/compaction.ts:113-197`

### Overflow Detection

`SessionCompaction.isOverflow()` checks `tokens > model.contextLength * threshold`. Prune runs after every turn to clean orphaned compaction rows.

- Source: `src/session/compaction.ts:87-89`, `src/session/prompt.ts:1618-1846`

### `/compact` command

Manual trigger via TUI. Also aliased as `/summarize`.

---

## 4. Fork Subagent

When `session.create()` is called with a `parentID`, the child session **inherits the parent's cached system prompt** — skipping the cold-start cache miss.

- Enables ~90% cache hit on first subagent turn (parent's BP2/BP3 already warm)
- Used internally by the `task` tool when spawning subtask sessions
- Source: `src/session/session.ts` (parentID propagation)

---

## 5. Tool System

### Built-In Tools

| Tool          | Description                                                       |
| ------------- | ----------------------------------------------------------------- |
| `read`        | Read file contents                                                |
| `write`       | Write file contents                                               |
| `edit`        | Targeted string replacement in files                              |
| `multiedit`   | Multiple edits in one call                                        |
| `bash`        | Execute shell commands                                            |
| `glob`        | File pattern matching                                             |
| `grep`        | Regex content search via ripgrep                                  |
| `ls`          | Directory listing                                                 |
| `task`        | Spawn a subagent session (fork or fresh)                          |
| `webfetch`    | Fetch URL content as markdown or text                             |
| `websearch`   | Web search via Exa (requires `OPENCODE_ENABLE_EXA`)               |
| `codesearch`  | Live framework/library docs via Context7 MCP                      |
| `todo`        | Read task list                                                    |
| `todowrite`   | Write task list                                                   |
| `skill`       | Load a specialized skill from `~/.config/lightcode/skills/`       |
| `plan`        | Enter/exit plan mode (read-only planning pass)                    |
| `question`    | Ask user a clarifying question                                    |
| `batch`       | Run multiple tool calls in parallel (experimental)                |
| `apply_patch` | Apply unified diff patches                                        |
| `lsp`         | LSP diagnostics and hover (env: `OPENCODE_EXPERIMENTAL_LSP_TOOL`) |
| `annotate`    | Open webpage in browser, pick DOM elements, capture visual state  |

### Visual Annotate Tool (`annotate`)

Two modes:

- **`picker`**: injects an interactive overlay into the live browser via CDP. Click elements to select them, get CSS selectors, XPath, box model, accessibility tree, computed styles. Max 200 elements.
- **`etch`**: captures before/after DOM snapshots for style diffs and mutation tracking. Selectors resolved once at start for consistent diff.

Requires Chromium (managed via Puppeteer/CDP — NOT Playwright). Browser instances are reused within a session. Source: `src/tool/annotate.ts`, `src/tool/etch.ts`, `src/tool/browser.ts`

### Deferred Tools (experimental)

Tools not in the "primary" set are excluded from the initial tool list and replaced with a `tool_search` stub. The agent calls `tool_search` to load a tool on demand — reducing context size for sessions that don't need every tool.

Threshold: 15 tools (configurable via `OPENCODE_DEFERRED_TOOLS_THRESHOLD`).

- Source: `src/tool/search.ts`

### Batched LSP Diagnostics (End-of-Step)

LSP diagnostics are deferred to end-of-step rather than blocking inline per tool call. Previously each `edit`/`write`/`apply_patch` blocked 150ms–3s per file waiting for LSP. Now:

1. Tools call `LSP.touchFile(path, false)` — fire-and-forget, no wait
2. Processor accumulates edited files in `ctx.editedFiles: Set<string>`
3. At `finish-step`, one batched `touchFile(file, true)` + `LSP.diagnostics()` for all files

8-file refactor: from ~24s of diagnostic blocking → single pass at step end.

- Source: `src/session/processor.ts:317-335`, `src/tool/edit.ts:145`

---

## 6. Agents

Built-in agents available via `/agents`:

| Agent        | Description                                                                           | Tools                            |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------------- |
| `build`      | Default agent. Executes tools based on configured permissions.                        | All permitted tools              |
| `plan`       | Plan mode — all edit tools disallowed. Reasoning only.                                | Read-only tools                  |
| `general`    | General-purpose for research and multi-step tasks. Can spawn parallel subtasks.       | All + `task`                     |
| `explore`    | Fast codebase exploration. Accepts thoroughness hint: quick / medium / very thorough. | Read tools + `task`              |
| `compaction` | Internal — generates session summaries during compaction. Not user-facing.            | None (no tools)                  |
| `title`      | Internal — generates session titles. Not user-facing.                                 | None                             |
| `summary`    | Internal — generates compaction summaries. Not user-facing.                           | None                             |
| `dream`      | Background memory consolidation. Produces native consolidation summaries.             | No edit/write/task in agent flow |

Custom agents can be defined in `lightcode.jsonc` under the `agents` key.

- Source: `src/agent/agent.ts:110-267`

---

## 7. TUI Commands

All accessible via the command palette (`/` prefix) or keybinds.

### Session

| Command       | Aliases                | Description                               |
| ------------- | ---------------------- | ----------------------------------------- |
| `/sessions`   | `/resume`, `/continue` | Switch or resume a session                |
| `/new`        | `/clear`               | Start a new session                       |
| `/rename`     |                        | Rename current session                    |
| `/share`      |                        | Share session (generates public URL)      |
| `/unshare`    |                        | Remove session share                      |
| `/fork`       |                        | Fork session from a specific message      |
| `/timeline`   |                        | Jump to a message in the session timeline |
| `/compact`    | `/summarize`           | Manually trigger session compaction       |
| `/undo`       |                        | Revert to previous user message           |
| `/redo`       |                        | Re-apply a reverted message               |
| `/copy`       |                        | Copy full session transcript to clipboard |
| `/export`     |                        | Export session transcript to a file       |
| `/timestamps` | `/toggle-timestamps`   | Toggle message timestamps                 |
| `/thinking`   | `/toggle-thinking`     | Toggle model thinking visibility          |

### Agent / Model

| Command     | Description                           |
| ----------- | ------------------------------------- |
| `/models`   | Switch active model                   |
| `/agents`   | Switch active agent                   |
| `/variants` | Switch model variant (when available) |
| `/mcps`     | Enable/disable MCP servers            |
| `/connect`  | Connect a provider (OAuth or API key) |

### Memory

| Command       | Aliases | Description                                            |
| ------------- | ------- | ------------------------------------------------------ |
| `/memory`     | `/mem`  | View Observer state: observations, reflections, tokens |
| `/dream`      |         | Trigger AutoDream consolidation manually               |
| `/dreammodel` |         | Configure the model used by AutoDream                  |

### System

| Command     | Description                                      |
| ----------- | ------------------------------------------------ |
| `/features` | Toggle experimental features, configure models   |
| `/status`   | View LSP servers, MCP connections, provider info |
| `/themes`   | Switch TUI color theme                           |
| `/help`     | Show keybind reference                           |
| `/exit`     | Exit (`/quit`, `/q`)                             |

---

## 8. Experimental Features (`/features`)

Accessible via `/features`. Space to toggle, Enter to configure model (where available).

| Feature            |   Toggle    | Model Picker | Default | Notes                                                                 |
| ------------------ | :---------: | :----------: | ------- | --------------------------------------------------------------------- |
| Deferred Tools     |     ✅      |      —       | off     | Also togglable via `OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS`             |
| Batch Tool         |     ✅      |      —       | off     | Run multiple tools in parallel                                        |
| Continue on Deny   |     ✅      |      —       | off     | Keep agent loop running when tool call denied                         |
| Markdown Rendering | ❌ env only |      —       | on      | `OPENCODE_EXPERIMENTAL_MARKDOWN`                                      |
| OpenTelemetry      |     ✅      |      —       | off     | AI SDK span tracing                                                   |
| AutoDream          |     ✅      |      ✅      | off     | Native background consolidation into `memory_artifacts`               |
| Observer Memory    |     ✅      |      ✅      | off     | Native observational memory; default model: `google/gemini-2.5-flash` |

Features that are **env only** (LSP Tool, Plan Mode, Workspaces) are not shown in `/features` — they must be set via environment variable and cannot be toggled at runtime.

---

## 9. Provider Support

Configured via `/connect` or `lightcode.jsonc`. Supported provider types:

| Provider              | Auth method               |
| --------------------- | ------------------------- |
| Anthropic             | API key / OAuth           |
| OpenAI                | API key / OAuth (Copilot) |
| Google (Gemini)       | API key / OAuth           |
| AWS Bedrock           | IAM credentials           |
| OpenRouter            | API key                   |
| Any OpenAI-compatible | API key + base URL        |

Prompt caching (BP1–BP4) applies to Anthropic and Bedrock. Other providers get cache headers where supported.

---

## 10. Configuration Reference

Config file: `~/.config/lightcode/lightcode.jsonc` (or `OPENCODE_CONFIG_DIR`).

### Memory-related

```jsonc
{
  "experimental": {
    "autodream": true, // Enable AutoDream on session idle
    "autodream_model": "google/gemini-2.5-flash", // Model for AutoDream
    "observer": true, // Enable intra-session Observer
    "observer_model": "google/gemini-2.5-flash", // Model for Observer + Reflector
  },
}
```

### Performance

```jsonc
{
  "experimental": {
    "deferred_tools": true, // Lazy-load tools to reduce context
    "batch_tool": true, // Parallel tool execution
  },
  "compaction": {
    "verbatim_keep": 20000, // Tokens to keep verbatim after cut-point (default: 20k)
  },
}
```

### Other toggles

```jsonc
{
  "experimental": {
    "continue_loop_on_deny": false, // Stop agent loop when tool denied
    "openTelemetry": false, // AI SDK telemetry spans
  },
}
```

### Key env vars

| Variable                               | Effect                                               |
| -------------------------------------- | ---------------------------------------------------- |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL`       | Enable LSP tool                                      |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE`      | Enable plan mode                                     |
| `OPENCODE_EXPERIMENTAL_WORKSPACES`     | Enable multi-workspace support                       |
| `OPENCODE_EXPERIMENTAL_MARKDOWN`       | Markdown rendering (default on)                      |
| `OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS` | Deferred tool loading                                |
| `OPENCODE_DEFERRED_TOOLS_THRESHOLD`    | Tool count threshold for deferred mode (default: 15) |
| `OPENCODE_ENABLE_EXA`                  | Enable Exa web search                                |

---

---

## 11. Performance Features

### Tool Concurrency Safety

Unsafe tools (write, bash, task, edit, apply_patch, todowrite, annotate, batch) are serialized via a promise chain — only one executes at a time. Safe tools (read, glob, grep, webfetch, websearch, codesearch, skill, lsp, tool_search, invalid) run concurrently with everything.

Prevents races on `edit A + bash rm A` or two `bash` commands with side effects.

- Classification via `concurrent: true` flag, set by `safe()` helper in `src/tool/registry.ts:152`
- Serialization: promise-chain in `src/session/prompt.ts:421-430`

### Native Deferred Tools

For supported models, LightCode sends `defer_loading: true` via `providerOptions` instead of using the client-side `tool_search` tool. The provider handles tool discovery natively.

| Mode   | How                                                            | When                                          |
| ------ | -------------------------------------------------------------- | --------------------------------------------- |
| Native | All tools sent with `deferLoading: true` on deferred ones      | Anthropic sonnet-4/opus-4, OpenAI gpt-5/o3/o4 |
| Hybrid | Only core tools sent; client-side `tool_search` loads deferred | All other models                              |

Detection: `ProviderTransform.supportsNativeDeferred(model)` — `src/provider/transform.ts:963`

### Cost Tracker

Token usage and estimated cost are tracked per-turn and displayed in multiple TUI locations:

| Location              | What it shows                                                          |
| --------------------- | ---------------------------------------------------------------------- |
| Sidebar context panel | Last-message token count + % of context limit + total session cost     |
| Subagent footer       | Cost per subagent task                                                 |
| Prompt input area     | `{context} · {cost}` per assistant message                             |
| **Sidebar footer**    | **⚠ Not yet implemented** — spec exists in `docs/cost-tracker-arch.md` |

Cost computation: `Session.getUsage()` called at `finish-step` via `processor.ts`. Handles cache tokens, reasoning tokens, pricing tiers, and Decimal.js precision.

## Related Docs

| Document                                                           | What it covers                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| [memory-architecture.md](memory-architecture.md)                   | Deep dive: OM state machine, DB schema, failure modes |
| [system-prompt-architecture.md](system-prompt-architecture.md)     | system[0-3] layout, cache breakpoints, assembly order |
| [autodream-engram-integration.md](autodream-engram-integration.md) | Engram vs AutoDream design rationale                  |
| [commands-tui-architecture.md](commands-tui-architecture.md)       | Full slash command system internals                   |
| [performance-features-spec.md](performance-features-spec.md)       | Tool concurrency, cache sorting, fork subagent        |
| [openspec/specs/memory/spec.md](../openspec/specs/memory/spec.md)  | Living memory system specification                    |
