# LightCode — Fork Proposal

> A performance-focused, memory-augmented fork of [OpenCode](https://github.com/anomalyco/opencode).

---

## 1. Executive Summary

**LightCode** is a fork of OpenCode that adds performance optimizations, intelligent memory consolidation, and a streamlined system prompt architecture — all while maintaining full upstream compatibility. The fork targets power users and agentic workflows where latency, token cost, and cross-session knowledge retention are critical.

### Key Differentiators

| Area                | OpenCode (upstream)               | LightCode (this fork)                                        |
| ------------------- | --------------------------------- | ------------------------------------------------------------ |
| Tool execution      | Sequential per step               | Multi-step streaming + concurrency safety                    |
| Prompt caching      | Non-deterministic tool order      | Alphabetical sort for stable cache hits                      |
| Subagent context    | Fresh session (full cache miss)   | Fork mode (inherits parent context, 90% cache hit)           |
| LSP diagnostics     | Per-tool blocking (150ms-3s each) | Batched at end-of-step (single pass)                         |
| Deferred tools      | Client-side only (tool_search)    | Native provider support (Anthropic/OpenAI) + hybrid fallback |
| System prompt       | 8 provider-specific prompts       | Single compact prompt (40% token reduction)                  |
| Memory              | Passive (AGENTS.md protocol)      | Active (AutoDream background consolidation via Engram)       |
| Reactive compaction | Error flash + no loop guard       | Silent recovery + MAX_COMPACTS guard                         |
| Filesystem          | `~/.opencode/` paths              | `~/.lightcode/` paths (coexists with OpenCode)               |

---

## 2. Motivation

OpenCode is an excellent open-source AI coding agent. However, several areas have room for improvement in real-world agentic workflows:

1. **Latency**: Each tool call that modifies files blocks for LSP diagnostics (150ms-3s per file per LSP client). A refactor touching 8 files can waste 24 seconds on diagnostics that are guaranteed to have transient errors.

2. **Token cost**: Subagents start from scratch — full system prompt rebuild, full tool resolution, zero context sharing. With Anthropic's prompt caching, this is a direct cost multiplier.

3. **Knowledge loss**: Engram is passive storage. The model saves reactively based on protocol instructions, but there's no second pass to catch what was missed, no deduplication, no cross-session synthesis.

4. **Tool ordering instability**: MCP tools, deferred tools, and plugin tools can arrive in different orders between API calls, causing prompt cache misses on tool definitions (3,000-6,000 tokens).

5. **Provider-specific bloat**: 8 separate system prompts for different providers, duplicating the same core instructions with minor variations.

---

## 3. Architecture Overview

LightCode is a monorepo built with **Bun**, **TypeScript**, **Effect-TS**, and **SolidJS** (for the TUI). The core package (`packages/opencode`) contains the agent runtime, tool system, session management, and HTTP/WebSocket server.

```
lightcodev2/
├── packages/
│   ├── opencode/        # Core: agent runtime, tools, session, server
│   │   └── src/
│   │       ├── agent/       # Agent definitions (build, plan, explore, dream)
│   │       ├── cli/         # CLI + TUI (SolidJS + opentui)
│   │       ├── lsp/         # LSP client/server management
│   │       ├── provider/    # 30+ AI provider integrations
│   │       ├── session/     # Session lifecycle, LLM streaming, compaction
│   │       ├── tool/        # 25+ built-in tools
│   │       └── ...
│   ├── app/             # Shared web UI (SolidJS)
│   ├── desktop/         # Native desktop app (Tauri)
│   ├── sdk/             # JavaScript SDK
│   └── ...
├── docs/                # Technical specs and architecture docs
├── specs/               # API specifications
└── infra/               # Infrastructure (SST)
```

### Core Technology Stack

| Layer         | Technology           | Purpose                                           |
| ------------- | -------------------- | ------------------------------------------------- |
| Runtime       | Bun 1.3+             | Fast JS runtime, native SQLite, bundler           |
| Type system   | TypeScript 5.8       | Strict mode, branded types                        |
| Effect system | Effect-TS 4.0        | Dependency injection, error handling, concurrency |
| AI SDK        | Vercel AI SDK 6.0    | Multi-provider LLM streaming                      |
| Database      | SQLite (Drizzle ORM) | Session storage, sync events                      |
| TUI           | SolidJS + opentui    | Reactive terminal UI                              |
| HTTP          | Hono                 | API server                                        |
| Desktop       | Tauri                | Native app wrapper                                |

---

## 4. Implemented Features

### 4.1 Multi-Step Streaming Tool Execution

**Problem**: The outer loop re-gathers messages, re-resolves tools, and starts a new model call after every step — adding 200-500ms per iteration.

**Solution**: Enable the AI SDK's multi-step mode (`stopWhen: [stepCountIs(N), hasNoToolCalls()]`). The SDK automatically feeds tool results back to the model without returning to the outer loop.

**Impact**: Eliminates per-step overhead. A 5-step agent session that previously required 5 outer loop iterations now completes in 1-2.

**Files**: `src/session/llm.ts`, `src/session/processor.ts`, `src/session/prompt.ts`

---

### 4.2 Tool Concurrency Safety

**Problem**: The AI SDK runs all tool calls via `Promise.all` — no distinction between read-only and write tools. Two `edit` calls to overlapping files, or `edit` + `bash` touching the same path, can race.

**Solution**: Classify tools as `concurrent: true` (safe) or `concurrent: false` (unsafe, default). Safe tools (read, glob, grep, webfetch, lsp, skill) run in parallel. Unsafe tools (edit, write, bash, task) go through a semaphore.

**Classification**:

| Safe (parallel)                          | Unsafe (sequential)             |
| ---------------------------------------- | ------------------------------- |
| `read`, `glob`, `grep`                   | `edit`, `write`, `apply_patch`  |
| `webfetch`, `websearch`, `codesearch`    | `bash`                          |
| `lsp`, `skill`, `invalid`, `tool_search` | `task`, `question`, `todowrite` |

**Files**: `src/tool/tool.ts`, `src/session/prompt.ts`, all tool definition files

---

### 4.3 Prompt Cache Stability Sorting

**Problem**: Tool order changes between API calls cause prompt cache misses on tool definitions (3,000-6,000 tokens).

**Solution**: Sort the final tools dict alphabetically before passing to `streamText`. Single line change. Deterministic regardless of MCP reconnections, deferred tool loading, or plugin load order.

**Impact**: Cache hit on the tool definition prefix. For Anthropic models: 90% discount on cached input tokens.

**Files**: `src/session/llm.ts`

---

### 4.4 Fork Subagent (Prompt Cache Sharing)

**Problem**: Subagents start from scratch — full system prompt rebuild, full tool resolution, zero context sharing. Each subagent call pays the full input cost.

**Solution**: When the `task` tool spawns a subagent, inherit the parent's system prompt, tool set, and conversation history. The forked subagent's API call prefix is IDENTICAL to the parent's.

**Savings estimate**: For a typical session with 3 subagent calls, **30,000-180,000 tokens saved**.

**Guards**:

- Fork-within-fork prevention (downgrade to regular subagent)
- Model mismatch detection (fall back if child uses different model)
- Context limit awareness

**Files**: `src/tool/task.ts`, `src/session/prompt.ts`, `src/session/llm.ts`

---

### 4.5 Batched LSP Diagnostics (End-of-Step)

**Problem**: Each `edit`/`write`/`apply_patch` triggers `LSP.touchFile(path, true)` + `LSP.diagnostics()` inline. 150ms debounce + 3s hard timeout PER FILE PER LSP CLIENT.

**Before**:

```
edit A → touchFile(A,true) → wait → diagnostics → output+diag
edit B → touchFile(B,true) → wait → diagnostics → output+diag
edit C → touchFile(C,true) → wait → diagnostics → output+diag
finish-step
```

**After**:

```
edit A → touchFile(A,false) → output (no diag)
edit B → touchFile(B,false) → output (no diag)
edit C → touchFile(C,false) → output (no diag)
finish-step → touchFile(A,B,C,true) → diagnostics → emit diag part
```

**Impact**: 8-file refactor goes from ~24s diagnostic blocking to ~3s (single batch).

**Files**: `src/tool/edit.ts`, `src/tool/write.ts`, `src/tool/apply_patch.ts`, `src/session/processor.ts`

---

### 4.6 Native Deferred Tools

**Problem**: Client-side `tool_search` works for all providers but doesn't leverage native provider capabilities.

**Solution**: Auto-detect models that support native deferred loading (Anthropic sonnet-4+, OpenAI gpt-5+). Send all tools with `defer_loading: true` — the provider handles search natively. Fall back to hybrid mode for other providers.

**Mode selection**:

```
Model → supportsNativeDeferred(model)
         ├── "anthropic" → NATIVE MODE (all tools sent, provider handles defer_loading)
         ├── "openai"    → NATIVE MODE
         └── false       → HYBRID MODE (client-side tool_search, existing behavior)
```

**Files**: `src/provider/transform.ts`, `src/session/prompt.ts`, `src/session/llm.ts`

---

### 4.7 Compact System Prompt

**Problem**: 8 provider-specific prompt files (anthropic.txt, gpt.txt, beast.txt, gemini.txt, kimi.txt, codex.txt, trinity.txt, default.txt) duplicating core instructions with minor variations.

**Solution**: Single `lightcode.txt` prompt file used for all providers. ~40% token reduction. All models receive the same instructions — behavioral differences are handled by the model's own capabilities, not by prompt engineering.

**Files**: `src/session/prompt/lightcode.txt`, `src/session/system.ts`

---

### 4.8 Reactive Compaction (Hardened)

**Problem**: When the LLM API returns "prompt too long", the system recovers but flashes an error UI and has no loop guard.

**Changes**:

1. **Remove error flash**: Skip `Session.Event.Error` publish on recoverable overflow
2. **Loop guard**: `MAX_COMPACTS = 3` prevents infinite compact loops
3. **Orphan cleanup**: Remove empty assistant messages left by overflow before compaction

**Files**: `src/session/processor.ts`, `src/session/prompt.ts`

---

### 4.9 AutoDream — Background Memory Consolidation

**Problem**: Engram is passive storage. Knowledge is lost, duplicates pile up, stale data persists, and there's no cross-session synthesis.

**Solution**: A `dream` agent that runs automatically when sessions go idle:

1. Reviews past session knowledge stored in Engram
2. Consolidates duplicates via `mem_update`
3. Prunes obsolete observations
4. Creates cross-session connections
5. Generates high-level summaries via `mem_save`

**Phases**:

| Phase                     | Trigger                   | Status      |
| ------------------------- | ------------------------- | ----------- |
| Phase 1: `/dream` command | Manual slash command      | Implemented |
| Phase 2: AutoDream        | Automatic on session idle | Implemented |
| Phase 3: extractMemories  | Per-turn extraction       | Future      |

**Gates**: Feature flag → 24h time threshold → 10min throttle → 5 session count → Flock lock

**Safety**: Sandboxed (read-only + Engram MCP tools only). Cheap model (haiku-class). Word budget. Single-instance via Flock.

**TUI**: Animated cloud indicator in footer during dreaming.

**Files**: `src/agent/agent.ts`, `src/cli/cmd/tui/` (multiple), `src/session/` (multiple)

---

### 4.10 Fork Branding (Filesystem Coexistence)

**Problem**: Running both OpenCode and LightCode would cause config/data collisions.

**Solution**: Rebrand all filesystem paths from `.opencode/` → `.lightcode/`, `opencode.json` → `lightcode.json`, etc. Both tools can coexist on the same machine.

**Files**: `src/global/index.ts`, `src/config/config.ts`, `src/config/paths.ts`

---

## 5. Feature Toggle System

All new features can be controlled via config or environment variables:

| Feature                 | Config Key                      | Env Variable                           | Default       |
| ----------------------- | ------------------------------- | -------------------------------------- | ------------- |
| Multi-step streaming    | `experimental.multi_step`       | `OPENCODE_EXPERIMENTAL_MULTI_STEP`     | `true`        |
| Tool concurrency        | `experimental.tool_concurrency` | —                                      | `true`        |
| Cache stability sort    | —                               | —                                      | Always on     |
| Fork subagent           | `experimental.fork_subagent`    | `OPENCODE_EXPERIMENTAL_FORK_SUBAGENT`  | `true`        |
| Batched LSP diagnostics | —                               | —                                      | Always on     |
| Native deferred tools   | `experimental.deferred_tools`   | `OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS` | Auto-detected |
| AutoDream               | `experimental.autodream`        | `OPENCODE_EXPERIMENTAL_AUTODREAM`      | `false`       |

---

## 6. Performance Impact Summary

| Optimization            | Metric                | Improvement                                        |
| ----------------------- | --------------------- | -------------------------------------------------- |
| Multi-step streaming    | Latency per tool loop | -200-500ms per eliminated outer loop iteration     |
| Tool concurrency safety | Throughput            | Read-only tools no longer blocked by writes        |
| Cache stability sorting | Token cost            | Cache hit on 3,000-6,000 token tool prefix         |
| Fork subagent           | Token cost            | 30,000-180,000 tokens saved per 3-subagent session |
| Batched LSP diagnostics | Latency per step      | 8-file refactor: ~24s → ~3s diagnostic time        |
| Native deferred tools   | Latency + quality     | Provider-native search, no client-side roundtrip   |
| Compact system prompt   | Token cost            | ~40% reduction in system prompt tokens             |
| Reactive compaction     | Reliability           | No more error flash, no infinite loops             |

---

## 7. Upstream Compatibility

LightCode tracks the `dev` branch of [anomalyco/opencode](https://github.com/anomalyco/opencode). All changes are additive or configuration-gated:

- **No breaking changes** to the API surface, SDK, or plugin system
- **Feature flags** allow disabling all new behavior
- **Filesystem isolation** via `~/.lightcode/` paths prevents conflicts
- **Merge strategy**: Periodic rebase onto upstream `dev`, resolving conflicts in fork-specific files

---

## 8. Testing

51 unit tests covering all new features:

- Tool concurrency classification and semaphore behavior
- Prompt cache stability sorting (deterministic order)
- Fork subagent context inheritance and guards
- Batched LSP diagnostics accumulation and emission
- Native deferred tool detection and mode selection
- Reactive compaction loop guard and orphan cleanup
- Multi-step token accumulation
- AutoDream agent definition and gate system

Test command: `bun test` from `packages/opencode`.

---

## 9. Roadmap

### Completed

- [x] Multi-step streaming tool execution
- [x] Tool concurrency safety classification
- [x] Prompt cache stability sorting
- [x] Fork subagent (prompt cache sharing)
- [x] Batched LSP diagnostics
- [x] Native deferred tools (Anthropic + OpenAI)
- [x] Compact system prompt (single file)
- [x] Reactive compaction hardening
- [x] AutoDream (background memory consolidation)
- [x] Fork branding (filesystem coexistence)
- [x] Deferred tools ungating (websearch, codesearch)
- [x] Feature toggle system

### Planned

- [ ] extractMemories (per-turn current-session extraction)
- [ ] Pre-flight token estimation (proactive overflow prevention)
- [ ] "Compacting..." status in TUI
- [ ] AutoDream Phase 3 (session-aware extraction)
- [ ] Upstream contribution of non-fork-specific improvements

---

## 10. License

MIT License — same as upstream OpenCode.

LightCode is a fork of [OpenCode](https://github.com/anomalyco/opencode) by [Anomaly](https://anomaly.co). This project is **not** built by the OpenCode team and is **not** affiliated with them in any way.
