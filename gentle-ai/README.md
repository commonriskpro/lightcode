# Gentle AI assets (OpenCode / SDD)

Upstream: [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) branch [`beta/token-optimization`](https://github.com/Gentleman-Programming/gentle-ai/tree/beta/token-optimization) (MIT).

This tree vendors:

- `AGENTS.md` — Agent Teams orchestrator instructions + Gentleman persona (from `internal/assets/generic/sdd-orchestrator.md` + `internal/assets/opencode/persona-gentleman.md`).
- `skills/` — SDD and shared skills (from `internal/assets/skills/`).
- `commands/` — SDD slash-command templates (from `internal/assets/opencode/commands/`).
- `lib/skill-registry.ts` — Builds **`.atl/skill-registry.md`** (scan global + project skill dirs, project conventions). Used by the CLI script and by **`plugins/skill-registry-plugin.ts`**.
- `script/skill-registry.ts` — CLI entry: run from repo root with `bun run skill-registry` (see parent `package.json`).
- `plugins/skill-registry-plugin.ts` — Injects the registry into the **`sdd-orchestrator`** system prompt **once per session** (see fork README).
- `plugins/background-agents.ts` — Async delegation (`delegate`, `delegation_read`, `delegation_list`); optional unless listed under `plugin` in `opencode.jsonc`.

**Fork default wiring:** the parent repo’s `.opencode/opencode.jsonc` registers **both** `skill-registry-plugin.ts` and `background-agents.ts`, and grants **`sdd-orchestrator`** `delegate` / `delegation_*` permissions. Adjust or remove `plugin` entries if you want a slimmer setup.

Integration with this fork: default profile uses `initial_tool_tier: minimal` and `experimental.tool_router` with `apply_after_first_assistant: true` in the checked-in JSONC (see root README for the full pipeline). `fork.opencode.env` aligns env flags. `sdd-orchestrator` keeps `task` → `sdd-*` for phase delegation; use **tab** in the TUI to pick `sdd-orchestrator`, or set `"default_agent": "sdd-orchestrator"` in `.opencode/opencode.jsonc`.

**MCP in parent repo:** `.opencode/opencode.jsonc` registers **`mcp.engram`** (`engram mcp`) and **`mcp.context7`** (`npx -y @upstash/context7-mcp`). See `docs/engram-opencode.md` and `docs/context7-opencode.md`.

**Workspace root:** `skills.paths` is `gentle-ai/skills` relative to the project directory. Open the **repository root** as the workspace so that path resolves. Other folders: add a symlink to `gentle-ai` or copy `gentle-ai/skills` into that project.

**Parity map (intended usage vs fork):** [docs/gentle-ai-parity-map.md](../docs/gentle-ai-parity-map.md).
