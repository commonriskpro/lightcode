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

| Feature                 | OpenCode                          | LightCode                                           |
| ----------------------- | --------------------------------- | --------------------------------------------------- |
| **Tool execution**      | Sequential per step               | Multi-step streaming + concurrency safety           |
| **Prompt caching**      | Non-deterministic tool order      | Alphabetical sort → stable cache hits               |
| **Subagent context**    | Fresh session (full cache miss)   | Fork mode → inherits parent context (90% cache hit) |
| **LSP diagnostics**     | Per-tool blocking (150ms-3s each) | Batched at end-of-step (single pass)                |
| **Deferred tools**      | Client-side only                  | Native Anthropic/OpenAI support + hybrid fallback   |
| **System prompt**       | 8 provider-specific prompts       | 1 compact prompt (40% fewer tokens)                 |
| **Memory**              | Passive (protocol in AGENTS.md)   | Active (AutoDream background consolidation)         |
| **Reactive compaction** | Error flash + no loop guard       | Silent recovery + guard against infinite loops      |
| **Filesystem**          | `~/.opencode/`                    | `~/.lightcode/` (runs alongside OpenCode)           |

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

The AI SDK now handles multiple tool-use steps internally instead of returning to the outer loop after every step. This eliminates 200-500ms of per-step overhead (message re-gathering, tool re-resolution, context reconstruction).

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

### Prompt Cache Stability

Tools are sorted alphabetically before being sent to the API. This makes the tool definition prefix deterministic across sessions, MCP reconnections, and deferred tool loading — maximizing prompt cache hits.

For Anthropic models with 15+ tools: **3,000-6,000 tokens** of tool definitions cached at a 90% discount.

### Fork Subagent

When the `task` tool spawns a subagent, it inherits the parent's:

- System prompt (same text = same cache hash)
- Tool set (no re-resolution)
- Conversation history (full context)

The result: the child's API call prefix is **identical** to the parent's. With 3 subagent calls per session: **30,000-180,000 tokens saved**.

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

### AutoDream — Background Memory Consolidation

When sessions go idle, a sandboxed `dream` agent:

1. Reviews knowledge stored in [Engram](https://github.com/nicobailon/engram) (persistent memory via MCP)
2. Deduplicates observations
3. Prunes stale data
4. Creates cross-session summaries

Trigger manually with `/dream` or enable automatic mode via config:

```jsonc
// ~/.config/lightcode/config.jsonc
{
  "experimental": {
    "autodream": true,
  },
}
```

**Safety**: Read-only + Engram MCP tools only. Cheap model (haiku-class). Single-instance via Flock. Gated by time threshold, session count, and throttle.

### Reactive Compaction (Hardened)

When the LLM returns "prompt too long":

- **No error flash** — the overflow is handled silently
- **Loop guard** — max 3 compaction attempts before stopping
- **Orphan cleanup** — empty assistant messages are removed before compacting

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

All new features can be controlled:

```jsonc
{
  "experimental": {
    "multi_step": true, // Multi-step streaming (default: true)
    "fork_subagent": true, // Fork subagent caching (default: true)
    "deferred_tools": true, // Deferred tools (default: auto-detected)
    "autodream": false, // Background memory (default: false)
  },
}
```

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
├── docs/              # Documentation site
├── storybook/         # Component storybook
├── enterprise/        # Enterprise features
├── containers/        # Container images
├── extensions/        # IDE extensions
├── function/          # Serverless functions
├── identity/          # Auth/identity
├── script/            # Build scripts
└── slack/             # Slack integration
```

### Key Directories in `packages/opencode/src/`

| Directory      | Purpose                                                           |
| -------------- | ----------------------------------------------------------------- |
| `agent/`       | Agent definitions (build, plan, explore, dream, compaction)       |
| `cli/cmd/tui/` | TUI application (SolidJS + opentui)                               |
| `lsp/`         | LSP client/server management                                      |
| `provider/`    | 30+ AI provider integrations                                      |
| `session/`     | Session lifecycle, LLM streaming, compaction, prompting           |
| `tool/`        | 25+ built-in tools (bash, edit, read, write, grep, glob, task...) |
| `config/`      | Configuration loading and schema                                  |
| `mcp/`         | Model Context Protocol client management                          |
| `plugin/`      | Plugin system with GitHub Copilot, Codex, GitLab integrations     |
| `permission/`  | Permission system (ask/allow/deny with pattern matching)          |
| `snapshot/`    | Git-based snapshot tracking for undo/redo                         |

## Documentation

- **[Quickstart Guide](docs/QUICKSTART.md)** — Get running in under 5 minutes
- **[Fork Proposal](docs/PROPOSAL.md)** — Complete technical proposal with all features
- **[Architecture](fork-arch-v2.md)** — Full directory and file inventory
- **[Performance Features](docs/performance-features-spec.md)** — Tool concurrency, cache sorting, fork subagent
- **[Streaming Tool Execution](docs/streaming-tool-execution-arch.md)** — Multi-step architecture
- **[Batched LSP Diagnostics](docs/batched-lsp-diagnostics-spec.md)** — End-of-step diagnostics
- **[Native Deferred Tools](docs/native-deferred-tools-spec.md)** — Provider-native tool deferral
- **[Reactive Compaction](docs/reactive-compact-arch.md)** — Overflow recovery hardening
- **[AutoDream](docs/autodream-proposal.md)** — Background memory consolidation
- **[System Prompt Architecture](docs/system-prompt-architecture.md)** — How the system prompt is built
- **[Commands & TUI](docs/commands-tui-architecture.md)** — Slash commands and dialog patterns

## Agents

LightCode includes the same built-in agents as OpenCode, plus additions:

| Agent       | Access             | Purpose                                         |
| ----------- | ------------------ | ----------------------------------------------- |
| **build**   | Full               | Default agent for development work              |
| **plan**    | Read-only          | Analysis and code exploration                   |
| **general** | Full               | Complex searches and multistep tasks (subagent) |
| **dream**   | Engram + read-only | Background memory consolidation                 |

Switch between `build` and `plan` with the `Tab` key.

## Upstream Sync

LightCode tracks the `dev` branch of OpenCode. All changes are additive or behind feature flags:

- No breaking changes to API, SDK, or plugin system
- Filesystem isolation (`~/.lightcode/`) prevents conflicts
- Periodic rebase onto upstream `dev`

## Contributing

Follow the same guidelines as upstream OpenCode — see [CONTRIBUTING.md](CONTRIBUTING.md).

**For fork-specific changes**: Open an issue first describing the problem and proposed approach.

**Style guide**: See [AGENTS.md](AGENTS.md) for code conventions (single-word names, no destructuring, early returns, Bun APIs).

## License

MIT — same as upstream [OpenCode](https://github.com/anomalyco/opencode).

---

**LightCode** is a community fork of [OpenCode](https://github.com/anomalyco/opencode) by [Anomaly](https://anomaly.co). This project is not built by the OpenCode team and is not affiliated with them in any way.
