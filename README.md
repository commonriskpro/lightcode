<p align="center">
  <h1 align="center">LightCode</h1>
  <p align="center"><strong>A performance-focused, memory-augmented fork of <a href="https://github.com/anomalyco/opencode">OpenCode</a>.</strong></p>
</p>

<p align="center">
  <a href="https://github.com/anomalyco/opencode"><img alt="Upstream" src="https://img.shields.io/badge/upstream-OpenCode-blue?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" /></a>
</p>

---

> **Note**: LightCode is a community fork. It is **not** built by the OpenCode team and is **not** affiliated with them. See the [upstream project](https://github.com/anomalyco/opencode) for the official version.

## What is LightCode?

LightCode is OpenCode with performance optimizations, intelligent memory, and a streamlined architecture. It targets power users and agentic workflows where latency, token cost, and cross-session knowledge retention matter.

**Everything in OpenCode works in LightCode.** Same providers, same tools, same plugins, same TUI. LightCode adds a layer of optimizations on top.

## What's Different?

| Feature                  | OpenCode                            | LightCode                                           |
| ------------------------ | ----------------------------------- | --------------------------------------------------- |
| **Tool execution**       | Sequential per step                 | Multi-step streaming + concurrency safety           |
| **Prompt caching**       | Non-deterministic tool order        | Alphabetical sort → stable cache hits (BP1–BP4)     |
| **Subagent context**     | Fresh session (full cache miss)     | Fork mode → inherits parent context (90% cache hit) |
| **LSP diagnostics**      | Per-tool blocking (150ms–3s each)   | Batched at end-of-step (single pass)                |
| **Deferred tools**       | Client-side only                    | Native Anthropic/OpenAI support + hybrid fallback   |
| **System prompt**        | 8 provider-specific prompts         | 1 compact prompt (~40% fewer tokens)                |
| **Intra-session memory** | None (context grows until overflow) | Proactive Observer — compresses every 30k tokens    |
| **Cross-session memory** | None (each session starts blind)    | Engram recall injected at session start             |
| **Memory consolidation** | Passive (manual `mem_save`)         | AutoDream — automatic background consolidation      |
| **Reactive compaction**  | Error flash + no loop guard         | Silent recovery + guard against infinite loops      |
| **Filesystem**           | `~/.opencode/`                      | `~/.lightcode/` (runs alongside OpenCode)           |

## Installation

### From Source

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/lightcodev2.git
cd lightcodev2

# Install dependencies
bun install

# Run in development mode
bun dev

# Run against a specific directory
bun dev /path/to/your/project
```

### Requirements

- **Bun 1.3+** — [install](https://bun.sh)
- An API key for at least one provider (Anthropic, OpenAI, Google, etc.)

### Build a Standalone Binary

```bash
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/bin/opencode
```

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
| **BP3**    | `system[1]` — Engram recall      | 5min | Cross-session context from Engram                      |
| **BP4**    | Penultimate conversation message | 5min | Always a cache READ on the next turn                   |

Tools are sorted alphabetically before every call — deterministic order across sessions, MCP reconnections, and deferred tool loading. For Anthropic models with 15+ tools: **3,000–6,000 tokens** cached at 90% discount.

### System Prompt Layout

```
system[0]  — BP2 (1h)    Agent prompt                          ← never changes mid-session
system[1]  — BP3 (5min)  Engram recall <engram-recall>…        ← cross-session context
system[2]  — BP3 (5min)  Local observations <local-obs>…       ← intra-session compression
system[3]  — not cached  Volatile: date + model identity
```

### Fork Subagent

When the `task` tool spawns a subagent, it inherits the parent's system prompt, tool set, and conversation history. The child's API call prefix is **identical** to the parent's. With 3 subagent calls per session: **30,000–180,000 tokens saved**.

Guards prevent fork-within-fork (exponential context explosion) and model mismatch.

### Batched LSP Diagnostics

Instead of blocking for LSP diagnostics after every file edit, LightCode:

1. Notifies the LSP server fire-and-forget during tool execution
2. Collects all edited file paths during the step
3. Runs **one** batched diagnostic pass at the end of the step

An 8-file refactor: **~24s → ~3s** of diagnostic time.

### Native Deferred Tools

Models that support native tool deferral (Anthropic sonnet-4+, OpenAI gpt-5+) get all tools sent with `defer_loading: true`. The provider handles tool search natively — no client-side `tool_search` roundtrip needed.

Other models fall back to the existing hybrid mode automatically.

### Compact System Prompt

A single `lightcode.txt` replaces 8 provider-specific prompt files. All models receive the same core instructions. ~40% reduction in system prompt tokens.

---

## Memory System

LightCode has a **3-layer memory system** that gives the agent continuous context across and within sessions.

### Layer 1 — Cross-Session Recall (via Engram)

At the start of each session (step 1), `SystemPrompt.recall()` fetches recent project context from [Engram](https://github.com/nicobailon/engram) (persistent memory via MCP). The result is injected at `system[1]` (BP3, 5min cache) so the agent knows what happened in past sessions — architectual decisions, established patterns, bugs fixed, preferences.

Engram must be installed and registered as an MCP server. LightCode handles this automatically:

```jsonc
// No config needed — auto-installed on first use
// Manual install: brew install gentleman-programming/tap/engram
```

### Layer 2 — Intra-Session Observer

A background Observer LLM fires at a **30k unobserved token threshold** during active sessions. It compresses message history into a dense observation log stored in a local `ObservationTable` (SQLite). This prevents context rot without blocking the user.

```
Turn N (< 6k tokens):   idle — nothing happens
Turn N (6k intervals):  background buffer pre-compute (non-blocking fiber)
Turn N (30k tokens):    activate buffer → Observer LLM → ObservationTable
Turn N (> 36k tokens):  force-sync (blocking — prevents runaway growth)
```

Observations use a priority system from the prompt:

- 🔴 User assertions (hard facts): "the app uses PostgreSQL", "I work at Acme"
- 🟡 User requests (not facts): "Can you help me refactor auth?"

The observation log is injected at `system[2]` each turn. Configure the Observer model:

```jsonc
{
  "experimental": {
    "observer_model": "google/gemini-2.5-flash",
  },
}
```

### Layer 3 — AutoDream (Memory Consolidation)

When sessions go idle, a sandboxed `dream` agent consolidates memory. It reads both local observations (Layer 2) and compaction summaries, then calls `mem_save` on Engram with structured observations under the project's topic namespace.

The dream agent:

1. **Reads** local ObservationTable observations + compaction summaries
2. **Searches** Engram for related existing observations (`mem_search`)
3. **Saves or updates** observations using `topic_key` convention: `project/{name}/session-insight/{topic}`
4. **Deduplicates** — `mem_update` if a matching topic exists, `mem_save` otherwise

Trigger manually with `/dream [focus]` or enable automatic mode:

```jsonc
{
  "experimental": {
    "autodream": true,
    "autodream_model": "anthropic/claude-haiku-4-5",
  },
}
```

**Safety**: Read-only file access + Engram MCP tools only. Single-instance. Gated by session idle event.

### Memory Pipeline

```
Active session
  Every turn → OMBuffer.check(tokens)
    → 6k:  fork Observer (background, non-blocking)
    → 30k: activate → ObservationTable (system[2] next turn)
    → 36k: force-sync (blocking)

Session goes idle
  → AutoDream fires
      reads ObservationTable + summary messages
      → dream agent → Engram mem_save

Next session starts
  → SystemPrompt.recall(pid)
      → Engram mem_context(limit: 30)
      → injected at system[1]
```

---

## Configuration

LightCode uses the same configuration format as OpenCode, with the paths changed to `~/.config/lightcode/`:

```
~/.config/lightcode/
├── config.jsonc       # Main configuration
├── AGENTS.md          # Global instructions
└── tui.json           # TUI theme and settings
```

Project-level config works the same — `AGENTS.md` or `lightcode.jsonc` in your project root.

### Feature Toggles

```jsonc
{
  "experimental": {
    "multi_step": true, // Multi-step streaming (default: true)
    "fork_subagent": true, // Fork subagent caching (default: true)
    "deferred_tools": true, // Deferred tools (default: auto-detected)
    "autodream": false, // Background memory consolidation (default: false)
    "autodream_model": "anthropic/claude-haiku-4-5", // Model for AutoDream
    "observer_model": "google/gemini-2.5-flash", // Model for intra-session Observer
  },
}
```

If `observer_model` is not set, the Observer is disabled gracefully — sessions continue normally without intra-session compression.

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
├── util/              # Shared utilities
└── ...
```

### Key Directories in `packages/opencode/src/`

| Directory      | Purpose                                                               |
| -------------- | --------------------------------------------------------------------- |
| `agent/`       | Agent definitions (build, plan, explore, dream, compaction, observer) |
| `session/om/`  | Observational Memory: buffer state machine, Observer LLM, CRUD        |
| `session/`     | Session lifecycle, LLM streaming, compaction, prompting               |
| `dream/`       | AutoDream consolidation agent + Engram auto-install                   |
| `cli/cmd/tui/` | TUI application (SolidJS + opentui)                                   |
| `lsp/`         | LSP client/server management                                          |
| `provider/`    | 30+ AI provider integrations                                          |
| `tool/`        | 25+ built-in tools (bash, edit, read, write, grep, glob, task…)       |
| `config/`      | Configuration loading and schema                                      |
| `mcp/`         | Model Context Protocol client management                              |
| `plugin/`      | Plugin system with GitHub Copilot, Codex, GitLab integrations         |
| `permission/`  | Permission system (ask/allow/deny with pattern matching)              |
| `snapshot/`    | Git-based snapshot tracking for undo/redo                             |

---

## Agents

LightCode includes the same built-in agents as OpenCode, plus additions:

| Agent          | Access             | Purpose                                         |
| -------------- | ------------------ | ----------------------------------------------- |
| **build**      | Full               | Default agent for development work              |
| **plan**       | Read-only          | Analysis and code exploration                   |
| **general**    | Full               | Complex searches and multistep tasks (subagent) |
| **dream**      | Engram + read-only | Background memory consolidation                 |
| **compaction** | Read-only          | Summarizes history on context overflow          |

Switch between `build` and `plan` with the `Tab` key.

---

## Documentation

- **[Quickstart Guide](docs/QUICKSTART.md)** — Get running in under 5 minutes
- **[Fork Proposal](docs/PROPOSAL.md)** — Complete technical proposal with all features
- **[System Prompt Architecture](docs/system-prompt-architecture.md)** — system[0–3] layout, cache breakpoints, memory injection
- **[Mastra OM Architecture](docs/mastra-om-arch.md)** — Deep dive into the Observational Memory design (Mastra-inspired)
- **[AutoDream + Engram Integration](docs/autodream-engram-integration.md)** — Memory pipeline design rationale
- **[Performance Features](docs/performance-features-spec.md)** — Tool concurrency, cache sorting, fork subagent
- **[Streaming Tool Execution](docs/streaming-tool-execution-arch.md)** — Multi-step architecture
- **[Batched LSP Diagnostics](docs/batched-lsp-diagnostics-spec.md)** — End-of-step diagnostics
- **[Native Deferred Tools](docs/native-deferred-tools-spec.md)** — Provider-native tool deferral
- **[Reactive Compaction](docs/reactive-compact-arch.md)** — Overflow recovery hardening
- **[Commands & TUI](docs/commands-tui-architecture.md)** — Slash commands and dialog patterns
- **[Memory Spec](openspec/specs/memory/spec.md)** — Living specification for the memory system

---

## Upstream Sync

LightCode tracks the `dev` branch of OpenCode. All changes are additive or behind feature flags:

- No breaking changes to API, SDK, or plugin system
- Filesystem isolation (`~/.lightcode/`) prevents conflicts
- Periodic rebase onto upstream `dev`

---

## Contributing

Follow the same guidelines as upstream OpenCode — see [CONTRIBUTING.md](CONTRIBUTING.md).

**For fork-specific changes**: Open an issue first describing the problem and proposed approach.

**Style guide**: See [AGENTS.md](AGENTS.md) for code conventions (single-word names, no destructuring, early returns, Bun APIs).

---

## License

MIT — same as upstream [OpenCode](https://github.com/anomalyco/opencode).

---

**LightCode** is a community fork of [OpenCode](https://github.com/anomalyco/opencode) by [Anomaly](https://anomaly.co). This project is not built by the OpenCode team and is not affiliated with them in any way.
