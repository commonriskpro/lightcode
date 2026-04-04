# AutoDream + Engram — Specification

## Requirements

### REQ-1: `/dream` Slash Command

The system MUST provide a `/dream` slash command that triggers memory consolidation manually.

- **REQ-1.1**: The command MUST spawn a `dream` agent as a subtask
- **REQ-1.2**: The command MUST work regardless of whether AutoDream is enabled
- **REQ-1.3**: The command MUST respect the `Flock("autodream")` lock (skip if another dream is running)
- **REQ-1.4**: The command MUST accept an optional `$ARGUMENTS` parameter for focus hints (e.g., `/dream auth system`)

### REQ-2: Dream Agent Definition

The system MUST define a `dream` agent with restricted capabilities.

- **REQ-2.1**: The agent MUST be a `subagent` mode agent (not primary)
- **REQ-2.2**: The agent MUST have a dedicated consolidation system prompt
- **REQ-2.3**: The agent MUST be hidden from agent listing (`hidden: true`)
- **REQ-2.4**: The agent MUST use a small/cheap model when available (via `Provider.getSmallModel()`)

### REQ-3: Dream Agent Permissions (Sandbox)

The dream agent MUST operate in a restricted sandbox.

- **REQ-3.1**: MUST allow: `read`, `glob`, `grep` (read-only codebase access)
- **REQ-3.2**: MUST allow: all Engram MCP tools (`mem_save`, `mem_search`, `mem_context`, `mem_update`, `mem_get_observation`, `mem_session_summary`)
- **REQ-3.3**: MUST deny: `edit`, `write`, `apply_patch` (no code modifications)
- **REQ-3.4**: MUST deny: `task` (no subagent spawning)
- **REQ-3.5**: MUST deny: `bash` (no shell execution)
- **REQ-3.6**: MUST deny: `skill` (no skill loading)
- **REQ-3.7**: SHOULD allow: `webfetch` for reference verification (deferred, loaded on demand)

### REQ-4: Consolidation Prompt

The dream agent MUST receive a structured consolidation prompt.

- **REQ-4.1**: Phase 1 (Orient): MUST call `mem_context(limit: 50)` to understand current memory state
- **REQ-4.2**: Phase 2 (Gather): MUST call `mem_search` with project-relevant terms to find duplicates, contradictions, and gaps
- **REQ-4.3**: Phase 3 (Consolidate): MUST call `mem_update` to merge duplicates and `mem_save` with `topic_key` for high-level summaries
- **REQ-4.4**: Phase 4 (Prune): MUST call `mem_update` to correct obsolete information
- **REQ-4.5**: The prompt MUST include word budget guidance (max ~500 words per observation)
- **REQ-4.6**: The prompt MUST instruct the agent to convert relative dates to absolute dates
- **REQ-4.7**: The prompt MUST instruct the agent to preserve `topic_key` relationships when merging

### REQ-5: AutoDream Gate System (Phase 2)

The automatic trigger MUST pass all gates before spawning a dream agent.

- **REQ-5.1**: Feature gate: `experimental.autodream === true` in config OR `OPENCODE_EXPERIMENTAL_AUTODREAM` env var
- **REQ-5.2**: Engram gate: Engram MCP client MUST be connected and healthy
- **REQ-5.3**: Time gate: `>= minHours` since last consolidation (default: 24 hours)
- **REQ-5.4**: Session gate: `>= minSessions` sessions completed since last consolidation (default: 5)
- **REQ-5.5**: Scan throttle: `>= 10 minutes` since last gate evaluation to prevent expensive checks every turn
- **REQ-5.6**: Lock gate: `Flock("autodream")` MUST be acquirable (no other dream running)
- **REQ-5.7**: Gates MUST be evaluated cheapest-first: feature → engram → time → throttle → sessions → lock

### REQ-6: AutoDream Trigger (Phase 2)

The system MUST trigger dream evaluation when a session becomes idle.

- **REQ-6.1**: MUST subscribe to `SessionStatus.Event.Idle` on the bus
- **REQ-6.2**: MUST fire-and-forget (non-blocking, best-effort)
- **REQ-6.3**: MUST only trigger for root sessions (not subagent sessions — check `session.parentID`)
- **REQ-6.4**: MUST NOT trigger when running in bare/headless mode

### REQ-7: Lock Mechanism (Phase 2)

The system MUST prevent concurrent dream executions.

- **REQ-7.1**: MUST use `Flock.acquire("autodream")` for cross-process safety
- **REQ-7.2**: MUST track last consolidation timestamp in `Global.Path.state/autodream.json`
- **REQ-7.3**: On dream completion: MUST update timestamp to `Date.now()`
- **REQ-7.4**: On dream failure/kill: MUST NOT update timestamp (allows retry)
- **REQ-7.5**: Timestamp file format: `{ lastConsolidatedAt: number, lastSessionCount: number }`

### REQ-8: TUI Integration (Phase 2)

The system SHOULD show dream status in the TUI.

- **REQ-8.1**: SHOULD show "dreaming..." indicator in the footer while dream is running
- **REQ-8.2**: SHOULD show brief completion summary when dream finishes
- **REQ-8.3**: MUST NOT block user input while dreaming

### REQ-9: Configuration

The system MUST be configurable.

- **REQ-9.1**: `experimental.autodream`: boolean (default: false) — enable AutoDream
- **REQ-9.2**: MUST be togglable via `/features` dialog
- **REQ-9.3**: `OPENCODE_EXPERIMENTAL_AUTODREAM` env var as override
- **REQ-9.4**: `OPENCODE_AUTODREAM_MIN_HOURS` env var (default: 24)
- **REQ-9.5**: `OPENCODE_AUTODREAM_MIN_SESSIONS` env var (default: 5)

### REQ-10: Engram Binary Resolution

The system MUST automatically resolve the Engram binary without user configuration.

- **REQ-10.1**: MUST check if an MCP client named "engram" is already connected (user-configured). If so, use it.
- **REQ-10.2**: MUST check if `engram` exists in the system PATH via `which("engram")`. If found, auto-register as MCP server in-memory.
- **REQ-10.3**: MUST check if `engram` exists in `~/.cache/lightcode/bin/`. If found, auto-register as MCP server in-memory.
- **REQ-10.4**: If not found anywhere, MUST auto-download from `https://github.com/Gentleman-Programming/engram/releases/` to `~/.cache/lightcode/bin/engram`.
- **REQ-10.5**: MUST support platforms: `arm64-darwin`, `x64-darwin`, `arm64-linux`, `x64-linux`.
- **REQ-10.6**: Auto-registered MCP server MUST NOT modify `lightcode.jsonc` (in-memory only via `MCP.add()`).
- **REQ-10.7**: User-configured engram in `lightcode.jsonc` MUST take priority over auto-detection.
- **REQ-10.8**: Download MUST be memoized via `lazy()` — run once per process lifetime.
- **REQ-10.9**: MCP registration MUST use `--tools=agent` profile (11 tools, excludes admin tools).
- **REQ-10.10**: Version MUST be pinned as a constant. Updated manually on new engram releases.
- **REQ-10.11**: If download fails (offline, GitHub unavailable), `/dream` MUST return actionable error. AutoDream MUST skip silently.

---

## Scenarios

### SCN-1: Manual Dream via `/dream`

**Given** a user with Engram MCP configured and an active session
**When** the user types `/dream`
**Then** a `dream` subtask agent spawns, calls `mem_context` → `mem_search` → `mem_update`/`mem_save`, and returns a consolidation summary

### SCN-2: Manual Dream with Focus

**Given** a user with Engram MCP configured
**When** the user types `/dream auth system`
**Then** the dream agent focuses its `mem_search` queries on auth-related observations

### SCN-3: Manual Dream Without Engram

**Given** a user WITHOUT Engram MCP configured
**When** the user types `/dream`
**Then** the command returns an error: "Engram MCP server not configured. Add engram to your MCP servers in lightcode.jsonc"

### SCN-4: AutoDream Triggers After Idle (Phase 2)

**Given** AutoDream is enabled, last consolidation was >24h ago, >=5 sessions since then
**When** the current session becomes idle (user stops typing, model finishes responding)
**Then** all gates pass, lock is acquired, dream agent spawns in background, "dreaming..." shows in footer

### SCN-5: AutoDream Skips — Too Recent (Phase 2)

**Given** AutoDream is enabled, last consolidation was 2h ago
**When** session becomes idle
**Then** time gate fails, no dream spawned, no user-visible effect

### SCN-6: AutoDream Skips — Not Enough Sessions (Phase 2)

**Given** AutoDream is enabled, last consolidation was 30h ago, only 2 sessions since then
**When** session becomes idle
**Then** session gate fails, no dream spawned

### SCN-7: AutoDream Skips — Already Running (Phase 2)

**Given** AutoDream is enabled, all gates pass, but another LightCode instance is already dreaming
**When** session becomes idle
**Then** lock gate fails (`Flock` already held), no dream spawned

### SCN-8: AutoDream Skips — No Engram (Phase 2)

**Given** AutoDream is enabled but Engram MCP server is not configured
**When** session becomes idle
**Then** engram gate fails, no dream spawned, no error shown (silent skip)

### SCN-9: Dream Killed Mid-Execution (Phase 2)

**Given** AutoDream is running
**When** user closes LightCode or the process is killed
**Then** lock is released (Flock handles this via dispose), timestamp is NOT updated, next idle will retry

### SCN-10: Dream Consolidates Duplicates

**Given** Engram has 3 observations about "JWT auth" with overlapping content
**When** dream agent runs
**Then** observations are merged into 1 using `mem_update` on the most complete one, preserving `topic_key: "architecture/auth"`

### SCN-11: Dream Prunes Obsolete Info

**Given** Engram has an observation "Chose express-session for auth" but a later one says "Switched from sessions to JWT"
**When** dream agent runs
**Then** the obsolete observation is updated via `mem_update` to note it was superseded, or merged into the newer observation's history

### SCN-12: Engram Found in PATH (Homebrew)

**Given** user installed engram via `brew install engram` (`/opt/homebrew/bin/engram` exists)
**And** no engram MCP entry in `lightcode.jsonc`
**When** `/dream` is executed or AutoDream triggers
**Then** `which("engram")` succeeds, MCP server auto-registered in-memory with `--tools=agent`, dream proceeds

### SCN-13: Engram Auto-Downloaded

**Given** user has NOT installed engram (`which("engram")` fails)
**And** no cached binary in `~/.cache/lightcode/bin/engram`
**When** `/dream` is executed
**Then** engram binary downloaded from GitHub Releases, extracted to cache, MCP server auto-registered, dream proceeds

### SCN-14: Engram Already Configured by User

**Given** user has `"engram": { "type": "local", "command": ["engram", "mcp"] }` in `lightcode.jsonc`
**When** `/dream` is executed
**Then** existing MCP client is used as-is, no download or auto-registration happens

### SCN-15: Engram Download Fails (Offline)

**Given** user has no engram installed and is offline
**When** `/dream` is executed
**Then** error message: "Engram not available. Install with: brew install engram"

### SCN-16: Engram Download Fails (AutoDream)

**Given** user has no engram installed and is offline
**When** AutoDream triggers on session idle
**Then** engram gate fails silently, no dream spawned, no error shown to user
