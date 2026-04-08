<p align="center">
  <h1 align="center">LightCode</h1>
  <p align="center"><strong>A performance-focused, memory-augmented AI coding agent.</strong></p>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode"><img alt="Built on OpenCode" src="https://img.shields.io/badge/built%20on-OpenCode-blue?style=flat-square" /></a>
</p>

---

## What is LightCode?

LightCode is an AI coding agent built on top of [OpenCode](https://github.com/anomalyco/opencode). It extends the core with a multi-layer memory system, deterministic prompt caching, and performance optimizations that target long sessions, large codebases, and agentic workflows where latency and token cost matter.

> **Credit**: LightCode is built on OpenCode by [Anomaly](https://anomaly.co). The core agent runtime, tool system, TUI, and provider integrations come from that project. LightCode's additions are the memory system, caching improvements, and performance features documented below.

## What LightCode Adds

| Feature                  | OpenCode                            | LightCode                                                         |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------- |
| **Tool execution**       | Sequential per step                 | Multi-step streaming + concurrency safety                         |
| **Prompt caching**       | Non-deterministic tool order        | Alphabetical sort → stable cache hits (BP1–BP4)                   |
| **Subagent context**     | Fresh session (full cache miss)     | Fork mode → inherits parent context (90% cache hit)               |
| **LSP diagnostics**      | Per-tool blocking (150ms–3s each)   | Batched at end-of-step (single pass)                              |
| **Deferred tools**       | Client-side only                    | Native Anthropic/OpenAI support + hybrid fallback                 |
| **System prompt**        | 8 provider-specific prompts         | 1 compact prompt (~40% fewer tokens)                              |
| **Intra-session memory** | None (context grows until overflow) | Proactive Observer — compresses every 30k tokens                  |
| **Cross-session memory** | None (each session starts blind)    | Native recall: libSQL FTS5 + vector search + working memory       |
| **Memory consolidation** | None                                | AutoDream — native background consolidation into libSQL artifacts |
| **Reactive compaction**  | Error flash + no loop guard         | Silent recovery + guard against infinite loops                    |
| **Filesystem**           | `~/.opencode/`                      | `~/.lightcode/`                                                   |

## Installation

### From Source

```bash
git clone https://github.com/commonriskpro/lightcode.git
cd lightcode
bun install
bun dev
```

### Requirements

- **Bun 1.3+** — [install](https://bun.sh)
- An API key for at least one provider (Anthropic, OpenAI, Google, etc.)

### Build a Standalone Binary

```bash
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/bin/opencode
```

The compiled binary depends on an adjacent `node_modules/` sidecar with the libSQL native bindings. Move or extract the whole `bin/` directory together, not just the executable.

---

## Features in Detail

### Multi-Step Streaming Tool Execution

The AI SDK handles multiple tool-use steps internally instead of returning to the outer loop after every step. This eliminates 200–500ms of per-step overhead (message re-gathering, tool re-resolution, context reconstruction).

```
Before: model → tools → [outer loop] → model → tools → [outer loop] → model → done
After:  model → tools → model → tools → model → done (SDK handles internally)
```

### Tool Concurrency Safety

Tools are classified as **safe** (read-only) or **unsafe** (writes/side effects). Safe tools run in parallel. Unsafe tools go through a semaphore.

| Safe (parallel)                       | Unsafe (sequential)            |
| ------------------------------------- | ------------------------------ |
| `read`, `glob`, `grep`                | `edit`, `write`, `apply_patch` |
| `webfetch`, `websearch`, `codesearch` | `bash`, `task`                 |
| `lsp`, `skill`                        | `question`, `todowrite`        |

### Prompt Cache Stability (BP1–BP4)

Four deterministic cache breakpoints applied before every API call:

| Breakpoint | Location                         | TTL  | What gets cached                                       |
| ---------- | -------------------------------- | ---- | ------------------------------------------------------ |
| **BP1**    | Last tool definition             | 1h   | Tool definitions (alphabetically sorted for stability) |
| **BP2**    | `system[0]` — agent prompt       | 1h   | Agent prompt — only changes on agent switch            |
| **BP3**    | `system[1]` — observations       | 5min | Local observational memory / reflections               |
| **BP4**    | Penultimate conversation message | 5min | Always a cache READ on the next turn                   |

Tools are sorted alphabetically before every call — deterministic order across sessions, MCP reconnections, and deferred tool loading. For Anthropic models with 15+ tools: **3,000–6,000 tokens** cached at 90% discount.

### System Prompt Layout

```
system[0]    — BP2 (1h)      Agent prompt                          ← never changes mid-session
system[1]    — BP3 (5min)    Local observations                    ← intra-session compression
system[2]    — not cached    <memory-recall>                       ← cross-session/project memory
system[3]    — not cached    <working-memory>                      ← durable thread/agent/project state
system[last] — not cached    Volatile: date + model identity
```

### Fork Subagent

When the `task` tool spawns a subagent, it inherits the parent's system prompt, tool set, and conversation history. The child's API call prefix is **identical** to the parent's. With 3 subagent calls per session: **30,000–180,000 tokens saved**.

### Batched LSP Diagnostics

Instead of blocking for LSP diagnostics after every file edit, LightCode:

1. Notifies the LSP server fire-and-forget during tool execution
2. Collects all edited file paths during the step
3. Runs **one** batched diagnostic pass at the end of the step

An 8-file refactor: **~24s → ~3s** of diagnostic time.

### Native Deferred Tools

Models that support native tool deferral (Anthropic sonnet-4+, OpenAI gpt-5+) get all tools sent with `defer_loading: true`. The provider handles tool search natively — no client-side `tool_search` roundtrip needed.

---

## Memory System

LightCode has a **native libSQL-backed memory system** that gives the agent continuous context across and within sessions.

### Layer 1 — Cross-Session Recall (Native)

At the start of each session (step 1), `Memory.buildContext()` loads cross-session context from LightCode's native memory store (`lightcode.db`). It runs hybrid recall against `memory_artifacts` using the first user message as the query, combining FTS5 with libSQL native vector search, then loads working memory across `thread`, `agent`, and `project` scopes.

The result is injected as:

- `system[2]` → `<memory-recall>`
- `system[3]` → `<working-memory>`

No external process is required.

### Layer 2 — Intra-Session Observer

A background Observer LLM fires at a **30k unobserved token threshold** during active sessions. It compresses message history into a dense observation log stored in a local `ObservationTable` inside the same libSQL database. This prevents context rot without blocking the user.

```
Turn N (< 6k tokens):   idle — nothing happens
Turn N (6k intervals):  background buffer pre-compute (non-blocking fiber)
Turn N (30k tokens):    activate buffer → Observer LLM → ObservationTable
Turn N (> 36k tokens):  force-sync (blocking — prevents runaway growth)
```

Observations use a priority system:

- 🔴 User assertions (hard facts): "the app uses PostgreSQL", "I work at Acme"
- 🟡 User requests (not facts): "Can you help me refactor auth?"

The observation log is injected at `system[2]` each turn.

### Layer 3 — AutoDream (Memory Consolidation)

When sessions go idle, a sandboxed `dream` agent consolidates memory. It reads local observations (Layer 2) and compaction summaries, then writes a project-scoped artifact into LightCode's native memory store.

The dream agent:

1. **Reads** local ObservationTable observations + compaction summaries
2. **Synthesizes** a high-signal consolidation summary
3. **Persists** it via `Memory.indexArtifact()` into `memory_artifacts`
4. **Deduplicates** with `topic_key` conventions in the native DB

Trigger manually with `/dream [focus]` or enable automatic mode via `/features`.

**Safety**: Native daemon path, single-instance, gated by session idle event.

### Memory Pipeline

```
Active session
  Every turn → OMBuf.check(tokens)
    → 6k:  fork Observer (background, non-blocking)
    → 30k: activate → ObservationTable (system[1] next turn)
    → 36k: force-sync (blocking)

Session goes idle
  → AutoDream fires
      reads ObservationTable + summary messages
      → dream agent → Memory.indexArtifact() → memory_artifacts (lightcode.db)

Next session starts (step 1)
  → Memory.buildContext({ semanticQuery: firstUserMessage })
      → HybridBackend.search() (FTS5 + embeddings via RRF) → system[2]
      → WorkingMemory.getForScopes()                        → system[3]
```

---

## Configuration

Config lives at `~/.config/lightcode/`:

```
~/.config/lightcode/
├── config.jsonc       # Main configuration
├── AGENTS.md          # Global instructions
└── tui.json           # TUI theme and settings
```

Project-level config: `AGENTS.md` or `lightcode.jsonc` in your project root.

### Feature Toggles

All memory features are toggleable from the TUI via `/features` (space to toggle, enter to configure model):

```jsonc
{
  "experimental": {
    "autodream": false, // Background memory consolidation
    "autodream_model": "anthropic/claude-haiku-4-5", // Model for AutoDream
    "observer": true, // Intra-session Observer (default: on)
    "observer_model": "opencode/qwen3.6-plus-free", // Model for Observer (default)
    "deferred_tools": true, // Deferred tool loading
  },
}
```

---

## Development

```bash
# Start dev server
bun dev

# Start headless API server
bun dev serve

# Start web UI (requires server running)
bun run --cwd packages/app dev

# Start desktop app
bun run --cwd packages/desktop tauri dev

# Run tests (from package directory, NOT root)
bun test --cwd packages/opencode

# Type check
bun turbo typecheck

# Generate DB migration after schema changes
bun run --cwd packages/opencode db generate --name <slug>
```

### Project Structure

```
packages/
├── opencode/          # Core: agent runtime, tools, session, server
├── app/               # Shared web UI components (SolidJS)
├── desktop/           # Native desktop app (Tauri)
├── desktop-electron/  # Electron desktop app
├── sdk/               # JavaScript SDK
├── plugin/            # Plugin system (@opencode-ai/plugin)
├── console/           # Console app
├── web/               # Landing page
├── ui/                # Shared UI primitives
└── util/              # Shared utilities
```

### Key Directories in `packages/opencode/src/`

| Directory      | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `agent/`       | Agent definitions (build, plan, explore, dream, compaction)     |
| `session/om/`  | Observational Memory: buffer state machine, Observer LLM, CRUD  |
| `session/`     | Session lifecycle, LLM streaming, compaction, prompting         |
| `dream/`       | AutoDream consolidation agent + native daemon flow              |
| `cli/cmd/tui/` | TUI application (SolidJS + opentui)                             |
| `lsp/`         | LSP client/server management                                    |
| `provider/`    | 30+ AI provider integrations                                    |
| `tool/`        | 25+ built-in tools (bash, edit, read, write, grep, glob, task…) |
| `config/`      | Configuration loading and schema                                |
| `mcp/`         | Model Context Protocol client management                        |
| `plugin/`      | Plugin system with GitHub Copilot, Codex, GitLab integrations   |
| `permission/`  | Permission system (ask/allow/deny with pattern matching)        |
| `snapshot/`    | Git-based snapshot tracking for undo/redo                       |

---

## Agents

| Agent          | Access    | Purpose                                                      |
| -------------- | --------- | ------------------------------------------------------------ |
| **build**      | Full      | Default agent for development work                           |
| **plan**       | Read-only | Analysis and code exploration                                |
| **general**    | Full      | Complex searches and multistep tasks (subagent)              |
| **dream**      | Read-only | Background memory consolidation into native memory artifacts |
| **compaction** | Read-only | Summarizes history on context overflow                       |

Switch between `build` and `plan` with the `Tab` key.

---

## Documentation

- **[System Prompt Architecture](docs/system-prompt-architecture.md)** — system layout, cache breakpoints, memory injection
- **[Feature Catalog](docs/feature-catalog.md)** — code-verified feature reference
- **[Production Memory Spec](docs/LIGHTCODE_MEMORY_PRODUCTION_SPEC.md)** — current native memory architecture and readiness scope
- **[Production Memory Validation](docs/LIGHTCODE_MEMORY_PRODUCTION_VALIDATION.md)** — current readiness verdict and verified test results
- **[Mastra OM Architecture](docs/mastra-om-arch.md)** — Observational Memory design (Mastra-inspired)
- **[AutoDream Integration Rationale](docs/autodream-engram-integration.md)** — historical rationale from the older Engram-backed phase
- **[Performance Features](docs/performance-features-spec.md)** — Tool concurrency, cache sorting, fork subagent
- **[Streaming Tool Execution](docs/streaming-tool-execution-arch.md)** — Multi-step architecture
- **[Batched LSP Diagnostics](docs/batched-lsp-diagnostics-spec.md)** — End-of-step diagnostics
- **[Native Deferred Tools](docs/native-deferred-tools-spec.md)** — Provider-native tool deferral
- **[Reactive Compaction](docs/reactive-compact-arch.md)** — Overflow recovery hardening
- **[Commands & TUI](docs/commands-tui-architecture.md)** — Slash commands and dialog patterns
- **[Memory Spec](openspec/specs/memory/spec.md)** — Historical spec from the older Engram-backed phase

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

**Style guide**: [AGENTS.md](AGENTS.md) — single-word names, no destructuring, early returns, Bun APIs.

---

## License

MIT. Built on [OpenCode](https://github.com/anomalyco/opencode) by [Anomaly](https://anomaly.co) — MIT licensed.
