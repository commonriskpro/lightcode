# Gentle AI assets (OpenCode / SDD)

Upstream: [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) branch [`beta/token-optimization`](https://github.com/Gentleman-Programming/gentle-ai/tree/beta/token-optimization) (MIT).

This tree vendors:

- `AGENTS.md` — Agent Teams orchestrator instructions + Gentleman persona (from `internal/assets/generic/sdd-orchestrator.md` + `internal/assets/opencode/persona-gentleman.md`).
- `skills/` — SDD and shared skills (from `internal/assets/skills/`).
- `commands/` — SDD slash-command templates (from `internal/assets/opencode/commands/`).
- `plugins/background-agents.ts` — optional plugin (not wired by default; enable in `opencode.jsonc` `plugin` if desired).

Integration with this fork: default profile uses `initial_tool_tier: full` and `experimental.tool_router` with `apply_after_first_assistant: false` so the offline router selects tools from the **first** user message; `inject_prompt` adds intent + tool ids to the system prompt. Optional alternate profile: `minimal` + `apply_after_first_assistant: true` for a cheaper first turn. `fork.opencode.env` aligns env flags. `sdd-orchestrator` is restricted to coordination (`task` → `sdd-*` only, no inline edit). Use **tab** in the TUI to pick `sdd-orchestrator`, or set `"default_agent": "sdd-orchestrator"` in `.opencode/opencode.jsonc` to use SDD by default.

**Workspace root:** `skills.paths` is `gentle-ai/skills` relative to the project directory. Open the **repository root** as the workspace so that path resolves. Other folders: add a symlink to `gentle-ai` or copy `gentle-ai/skills` into that project.
