# LightCode — Quickstart Guide

Get LightCode running in under 5 minutes.

---

## Prerequisites

| Requirement | Minimum               | Check                                         |
| ----------- | --------------------- | --------------------------------------------- |
| **Bun**     | 1.3+                  | `bun --version`                               |
| **Git**     | Any                   | `git --version`                               |
| **API key** | At least one provider | See [Provider Setup](#3-configure-a-provider) |

Don't have Bun? Install it:

```bash
curl -fsSL https://bun.sh/install | bash
```

---

## 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/lightcodev2.git
cd lightcodev2
bun install
```

## 2. Run LightCode

```bash
# Start the TUI in the current directory
bun dev

# Start against a specific project
bun dev /path/to/your/project
```

That's it. LightCode is running.

## 3. Configure a Provider

LightCode needs at least one AI provider. Set an API key as an environment variable or configure it in the config file.

### Option A: Environment Variable (fastest)

```bash
# Anthropic (recommended)
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI
export OPENAI_API_KEY="sk-..."

# Google
export GOOGLE_GENERATIVE_AI_API_KEY="..."

# Or any of 30+ supported providers
```

Then run `bun dev` and LightCode auto-detects the provider.

### Option B: Config File

Create `~/.config/lightcode/config.jsonc`:

```jsonc
{
  "provider": {
    "anthropic": {
      "api_key": "sk-ant-...",
    },
  },
}
```

### Option C: OAuth Login

Some providers support OAuth login directly from the TUI. Run `bun dev` and use the `/connect` command.

## 4. Verify It Works

Once the TUI is running:

1. Type a message and press `Enter` — the model should respond
2. Press `Tab` to switch between `build` (full access) and `plan` (read-only) agents
3. Type `/help` to see all available commands
4. Type `/models` to see available models and switch between them

---

## 5. Enable LightCode Features

All performance features are **on by default**. AutoDream (background memory) is opt-in.

### Enable AutoDream (persistent memory consolidation)

AutoDream consolidates memory automatically when sessions go idle. It writes to LightCode's native memory store.

```jsonc
// ~/.config/lightcode/config.jsonc
{
  "experimental": {
    "autodream": true,
    "autodream_model": "google/gemini-2.5-flash", // Model for consolidation
  },
}
```

Or trigger manually: type `/dream` in the TUI.

### Toggle features via config

```jsonc
// ~/.config/lightcode/config.jsonc
{
  "experimental": {
    "multi_step": true, // Multi-step streaming (default: true)
    "fork_subagent": true, // Same-model subagent launch uses durable fork mode (default: true)
    "deferred_tools": true, // Deferred tools (default: auto-detected)
    "autodream": false, // Background memory (default: false)
  },
}
```

---

## 6. Common Workflows

### Interactive coding session

```bash
bun dev /path/to/project
```

Type your request naturally. LightCode has access to all the same tools as OpenCode: file editing, bash commands, grep, glob, web search, etc.

### Headless API server

```bash
bun dev serve --port 4096
```

Start the server without the TUI. Useful for:

- Web UI (`bun run --cwd packages/app dev`)
- Desktop app (`bun run --cwd packages/desktop tauri dev`)
- Custom clients via the HTTP/WebSocket API

### Non-interactive (pipe mode)

```bash
echo "Explain the main function" | bun dev run
```

### Build a standalone binary

```bash
./packages/opencode/script/build.ts --single
```

The binary is at `./packages/opencode/dist/opencode-<platform>/bin/opencode`.

---

## 7. Key Commands

| Command     | What it does                            |
| ----------- | --------------------------------------- |
| `Tab`       | Switch between build/plan agents        |
| `/models`   | Switch AI model                         |
| `/compact`  | Summarize conversation (reduce context) |
| `/dream`    | Trigger memory consolidation            |
| `/sessions` | Browse previous sessions                |
| `/help`     | Show all keybinds and commands          |
| `/themes`   | Change TUI theme                        |
| `Ctrl+C`    | Cancel current operation                |
| `Ctrl+D`    | Exit                                    |

---

## 8. Project Configuration

Add project-specific instructions by creating an `AGENTS.md` in your project root:

```markdown
# Project Instructions

- This is a TypeScript project using Bun
- Run tests with `bun test`
- Follow conventional commits
- Prefer functional patterns over classes
```

LightCode reads this file automatically and includes it in every prompt.

---

## 9. Filesystem Paths

LightCode uses separate paths from OpenCode so both can coexist:

| Purpose        | Path                               |
| -------------- | ---------------------------------- |
| Config         | `~/.config/lightcode/`             |
| Data           | `~/.local/share/lightcode/`        |
| Cache          | `~/.cache/lightcode/`              |
| State          | `~/.local/state/lightcode/`        |
| Project config | `.lightcode/` or `lightcode.jsonc` |

---

## Troubleshooting

### "No providers configured"

Set at least one API key. See [Configure a Provider](#3-configure-a-provider).

### "bun: command not found"

Install Bun: `curl -fsSL https://bun.sh/install | bash`, then restart your shell.

### Tests fail from repo root

Tests **cannot** run from the repo root. Run from the package directory:

```bash
# Correct
bun test --cwd packages/opencode

# Wrong — will fail
bun test
```

### Port already in use

The default API server port is 4096. Change it:

```bash
bun dev serve --port 8080
```

### TypeScript errors after pulling changes

```bash
bun install
bun turbo typecheck
```

---

## Next Steps

- **[README](../README.md)** — Full feature overview
- **[Fork Proposal](PROPOSAL.md)** — Complete technical proposal with architecture details
- **[CONTRIBUTING](../CONTRIBUTING.md)** — How to contribute
- **[AGENTS.md](../AGENTS.md)** — Code style guide
