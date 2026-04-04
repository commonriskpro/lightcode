# AutoDream + Engram — Change Proposal

## Intent

Add automatic background memory consolidation to LightCode. When sessions go idle, a sandboxed dream agent reviews past session knowledge stored in Engram, consolidates duplicates, prunes obsolete observations, creates cross-session connections, and generates high-level summaries — all without user intervention.

## Problem

Today, Engram is passive storage. The model in each session calls `mem_save` reactively based on the AGENTS.md protocol. This has gaps:

1. **Knowledge loss**: If the model forgets to save, information is lost permanently
2. **Noise accumulation**: Duplicate observations pile up across sessions (same topic_key helps but isn't enforced)
3. **Stale data**: Reverted decisions and outdated configs persist forever
4. **No cross-session synthesis**: Each session saves in isolation — nobody connects "we chose JWT in session A" with "we added refresh tokens in session B" into "auth system evolution"
5. **No safety net**: There's no second pass to catch what the reactive protocol missed

## Scope

### In Scope

- `/dream` slash command (Phase 1 — manual trigger)
- AutoDream background agent (Phase 2 — automatic trigger on session idle)
- Engram as sole backend (mem_save, mem_search, mem_update, mem_context)
- **Automatic Engram binary resolution**: PATH detection → cache check → auto-download from GitHub Releases
- **In-memory MCP auto-registration** via `MCP.add()` (no config file modification)
- Feature flag: `OPENCODE_EXPERIMENTAL_AUTODREAM` env + `experimental.autodream` config
- Lock mechanism via `Flock.acquire("autodream")` to prevent concurrent dreams
- Gate system: time threshold (24h), session count (5), scan throttle (10min)
- Sandboxed tool permissions (read-only + Engram MCP tools only)
- TUI footer indicator ("dreaming...")
- `dream` agent definition with restricted permissions

### Out of Scope

- extractMemories (per-turn current-session extraction — separate feature)
- Writing to files (CLAUDE.md, memory/\*.md) — Engram replaces file-based memory
- Remote/cloud dream execution
- Dream transcript recording (skipTranscript: true)
- Custom dream prompts (hardcoded consolidation prompt)

## Approach

### Phase 1 — `/dream` command (manual)

Register a `/dream` slash command that spawns a `dream` agent as a subtask. The dream agent:

1. Calls `mem_context` to orient
2. Calls `mem_search` to find duplicates, contradictions, stale observations
3. Calls `mem_update` to merge/clean
4. Calls `mem_save` with `topic_key` for high-level cross-session summaries
5. Returns a summary of what was consolidated

### Phase 2 — AutoDream (automatic)

Subscribe to `SessionStatus.Event.Idle`. When fired:

1. Check gates (feature flag → time → throttle → sessions → lock)
2. Acquire `Flock("autodream")`
3. Spawn dream agent as fire-and-forget background task
4. Show "dreaming..." in TUI footer
5. On completion: release lock, update timestamp
6. On failure/kill: release lock, rollback timestamp

### Phase 3 — extractMemories (future, not this change)

Per-turn extraction from current session messages to catch things the protocol missed.

## Risks

| Risk                                                 | Mitigation                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dream agent hallucinates and corrupts memory         | Sandboxed: can only call Engram MCP tools + read-only file tools. Review output in first iterations.                                                            |
| Dream agent uses too many tokens                     | Use small/cheap model (haiku-class). Word budget in prompt. Gate system prevents running too often.                                                             |
| Concurrent dreams corrupt Engram                     | `Flock.acquire("autodream")` ensures single-instance. Engram SQLite is single-writer safe.                                                                      |
| Dream runs during active session, stealing resources | Fire-and-forget only on idle. If session resumes, dream continues but at lower priority (no resource contention since it's a separate API call).                |
| Engram binary not installed                          | Auto-download from GitHub Releases to `~/.cache/lightcode/bin/`. Falls back to actionable error message if offline.                                             |
| Engram binary version drift                          | Version pinned as constant. Auto-downloaded binary is always the pinned version. Homebrew users may have newer/older — acceptable since MCP protocol is stable. |
| Auto-download fails (offline, GitHub down)           | `/dream` shows error with install instructions. AutoDream skips silently. No crash, no retry loop.                                                              |
| MCP auto-registration conflicts with user config     | User-configured engram in `lightcode.jsonc` always takes priority (checked first in resolution chain).                                                          |

## Rollback Plan

Feature is behind `experimental.autodream` config flag (default: false) and `OPENCODE_EXPERIMENTAL_AUTODREAM` env var. Disable either to turn off completely. The `/dream` command can be removed from the command registry. No data mutations outside Engram (which has its own backup/restore).
