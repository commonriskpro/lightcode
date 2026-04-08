# AutoDream + Engram — Technical Design

> **⚠️ SUPERSEDED (2026-04-05):** This document describes the original Engram-backed AutoDream design. The current implementation uses LightCode's native SQLite memory store. AutoDream now writes directly to `memory_artifacts` via `Memory.indexArtifact()` without requiring Engram. This design doc is retained for historical reference only. See `docs/LIGHTCODE_MEMORY_PRODUCTION_DESIGN.md` for the current architecture.

---

## Architecture Overview

```
                         ┌──────────────────┐
                         │   User Session    │
                         │  (model + tools)  │
                         └────────┬─────────┘
                                  │ session goes idle
                                  ▼
                         ┌──────────────────┐
                         │  SessionStatus    │
                         │  Event.Idle       │
                         │  (bus event)      │
                         └────────┬─────────┘
                                  │ subscribe
                                  ▼
┌─────────────────────────────────────────────────────────┐
│                    AutoDream Service                     │
│                                                         │
│  Gate 1: Feature flag ──→ skip if disabled              │
│  Gate 2: Engram MCP   ──→ skip if not connected         │
│  Gate 3: Time (24h)   ──→ skip if too recent            │
│  Gate 4: Throttle     ──→ skip if checked <10min ago    │
│  Gate 5: Sessions (5) ──→ skip if not enough            │
│  Gate 6: Flock lock   ──→ skip if another dream running │
│                                                         │
│  All pass → spawn dream agent (fire-and-forget)         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │    Dream Agent      │
              │  (subagent session) │
              │                     │
              │  Tools allowed:     │
              │  - read, glob, grep │
              │  - engram_mem_*     │
              │                     │
              │  Tools denied:      │
              │  - edit, write,     │
              │    bash, task,      │
              │    skill, patch     │
              └──────────┬──────────┘
                         │ reads/writes
                         ▼
              ┌─────────────────────┐
              │   Engram MCP        │
              │   (SQLite + FTS5)   │
              │                     │
              │   mem_context       │
              │   mem_search        │
              │   mem_save          │
              │   mem_update        │
              │   mem_get_observation│
              └─────────────────────┘
```

---

## File Plan

### New Files

| File                             | Purpose                                                |
| -------------------------------- | ------------------------------------------------------ |
| `src/dream/index.ts`             | AutoDream namespace: gate system, trigger, lifecycle   |
| `src/dream/engram.ts`            | Engram binary resolution: PATH → cache → auto-download |
| `src/dream/prompt.txt`           | Consolidation system prompt for the dream agent        |
| `src/command/template/dream.txt` | `/dream` command template                              |

### Modified Files

| File                                           | Change                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/agent/agent.ts`                           | Add `dream` agent definition                                                                             |
| `src/command/index.ts`                         | Register `/dream` command in `Default` enum + `init()`                                                   |
| `src/config/config.ts`                         | Add `autodream` to `experimental` schema                                                                 |
| `src/flag/flag.ts`                             | Add `OPENCODE_EXPERIMENTAL_AUTODREAM`, `OPENCODE_AUTODREAM_MIN_HOURS`, `OPENCODE_AUTODREAM_MIN_SESSIONS` |
| `src/cli/cmd/tui/component/dialog-feature.tsx` | Add `autodream` toggle to `/features` dialog                                                             |

### SDK Regeneration

After adding `autodream` to config schema: `./packages/sdk/js/script/build.ts`

---

## Engram Binary Resolution (`src/dream/engram.ts`)

### Overview

Engram is a Go binary (single-file, zero dependencies) that runs as an MCP server via `engram mcp --tools=agent`. LightCode needs it for AutoDream. The resolution strategy follows the same pattern as `src/file/ripgrep.ts` (which auto-downloads ripgrep if not found).

### Resolution Chain

```
ensureEngram()
  │
  ├─ 1. MCP client "engram" already connected?
  │     → User configured it manually in lightcode.jsonc
  │     → return true (use as-is)
  │
  ├─ 2. which("engram") finds binary in PATH?
  │     → Installed via Homebrew or manually
  │     → Auto-register via MCP.add("engram", config)
  │     → return true
  │
  ├─ 3. ~/.cache/lightcode/bin/engram exists?
  │     → Previously downloaded by LightCode
  │     → Auto-register via MCP.add("engram", config)
  │     → return true
  │
  └─ 4. Not found anywhere:
        ├─ Detect platform (arm64-darwin, x64-linux, etc.)
        ├─ fetch() from GitHub Releases
        ├─ Extract tar.gz → ~/.cache/lightcode/bin/engram
        ├─ chmod 755
        ├─ Auto-register via MCP.add("engram", config)
        └─ return true
```

### Platform Map

Source: Gentleman-Programming/homebrew-tap `Formula/engram.rb`

```ts
const VERSION = "1.11.0"
const REPO = "Gentleman-Programming/engram"

const PLATFORM = {
  "arm64-darwin": "darwin_arm64",
  "x64-darwin": "darwin_amd64",
  "arm64-linux": "linux_arm64",
  "x64-linux": "linux_amd64",
} as const
```

Download URL pattern:

```
https://github.com/{REPO}/releases/download/v{VERSION}/engram_{VERSION}_{platform}.tar.gz
```

### Auto-Register MCP (in-memory, not written to config)

Uses `MCP.add()` (line 589 of `src/mcp/index.ts`) which creates and stores a client dynamically:

```ts
await MCP.add("engram", {
  type: "local",
  command: [binPath, "mcp", "--tools=agent"],
})
```

This is in-memory only. Does NOT modify `lightcode.jsonc`. If the user already has engram configured manually, their config takes priority (step 1 of the chain).

### Lazy Initialization

Uses the same `lazy()` pattern as ripgrep — the download/detection runs once, memoized:

```ts
const state = lazy(async () => {
  // 1. Check existing MCP client
  // 2. which("engram")
  // 3. Check cache
  // 4. Download
  return { bin: resolvedPath }
})
```

### When `ensureEngram()` Is Called

| Call Site              | When                              | Blocking?                           |
| ---------------------- | --------------------------------- | ----------------------------------- |
| `AutoDream.execute()`  | Gate 2 (after feature flag check) | No (fire-and-forget, skip if fails) |
| `/dream` command       | Before spawning dream agent       | Yes (user expects it to work)       |
| App startup (optional) | Background pre-warm               | No (best-effort)                    |

### UX Scenarios

| Scenario                                  | What Happens                                                      | User Action Required                         |
| ----------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| User has engram via Homebrew              | `which("engram")` succeeds → auto-register MCP                    | None                                         |
| User configured engram in lightcode.jsonc | MCP client already exists → use as-is                             | None                                         |
| User has no engram at all                 | Auto-download from GitHub → cache → auto-register                 | None                                         |
| User is offline, no engram installed      | Download fails → `/dream` returns error, AutoDream skips silently | `brew install engram` or connect to internet |
| Cache cleared (CACHE_VERSION bump)        | Re-downloads on next use                                          | None                                         |

### Version Pinning

Version is pinned as a constant (`VERSION = "1.11.0"`). Updated manually when a new engram release is needed. The `CACHE_VERSION` in `global/index.ts` controls cache invalidation — bumping it clears `~/.cache/lightcode/bin/` and forces re-download.

### Existing Patterns Used

| Pattern                               | Source                                   | How We Use It                   |
| ------------------------------------- | ---------------------------------------- | ------------------------------- |
| `which()` for PATH detection          | `src/util/which.ts` (used by ripgrep.ts) | Find system-installed engram    |
| `lazy()` for memoized init            | `src/util/lazy.ts` (used by ripgrep.ts)  | Run detection/download once     |
| `Global.Path.bin` for cached binaries | `src/global/index.ts`                    | Store downloaded engram         |
| `fetch()` + tar extract               | `src/file/ripgrep.ts` lines 148-203      | Download + extract tar.gz       |
| `MCP.add(name, config)`               | `src/mcp/index.ts` line 589              | Dynamic MCP server registration |
| `Filesystem.write/exists`             | `src/util/filesystem.ts`                 | File operations                 |
| `Process.spawn` for tar extraction    | `src/util/process.ts`                    | Extract tar.gz archive          |

---

## Component Design

### 1. `src/dream/index.ts` — AutoDream Namespace

```ts
export namespace AutoDream {
  // State
  interface DreamState {
    lastConsolidatedAt: number // epoch ms
    lastSessionCount: number
  }

  // State file: ~/.local/state/lightcode/autodream.json
  const statePath = path.join(Global.Path.state, "autodream.json")

  // Read/write state
  function readState(): Promise<DreamState>
  function writeState(state: DreamState): Promise<void>

  // Gate checks (cheapest first)
  function isEnabled(): Promise<boolean> // config + env var
  function hasEngram(): Promise<boolean> // MCP client check
  function isTimeReady(state: DreamState): boolean // 24h threshold
  function isThrottled(): boolean // 10min scan throttle
  function hasEnoughSessions(state: DreamState): Promise<number> // count sessions since last
  async function tryAcquireLock(): Promise<Flock.Lease | null>

  // Entry points
  export function init(): () => void // returns unsubscribe
  export async function run(focus?: string): Promise<void> // manual trigger
  export async function execute(): Promise<void> // auto trigger (gate-checked)
}
```

**Key decisions:**

- **State file over lock mtime**: Unlike Claude Code's lock-mtime trick, we use a separate JSON file at `Global.Path.state/autodream.json`. Cleaner, explicit, and we already have `Flock` for locking.
- **`init()` returns unsubscribe**: Called at app startup, subscribes to `SessionStatus.Event.Idle`, returns cleanup function.
- **`run()` is the manual path**: Called by `/dream` command. Skips time/session/throttle gates but still checks engram + lock.
- **`execute()` is the auto path**: Called by idle listener. Full gate chain.

### 2. Dream Agent Definition

Added to `agents` record in `agent.ts`:

```ts
dream: {
  name: "dream",
  description: "Background memory consolidation agent",
  mode: "subagent",
  native: true,
  hidden: true,
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
      // Engram MCP tools pass through as MCP tools (not in permission system)
    }),
    user,
  ),
  options: {},
  prompt: PROMPT_DREAM,
},
```

**Why `hidden: true`**: The dream agent should never appear in agent selection. It's infrastructure.

**Why no `model` override**: Uses `Provider.getSmallModel()` at spawn time. Falls back to session model if no small model available.

### 3. Dream Execution Flow

```ts
async function spawnDream(focus?: string): Promise<void> {
  // 1. Verify engram MCP client exists
  const clients = await MCP.clients()
  const engram = findEngramClient(clients) // check for "engram" in client names
  if (!engram) throw new Error("Engram MCP not configured")

  // 2. Get model (prefer small/cheap)
  const model = (await Provider.getSmallModel(defaultProviderID)) ?? (await Provider.defaultModel())

  // 3. Create child session
  const session = await Session.create({
    title: "AutoDream consolidation",
    permission: [
      { permission: "edit", action: "deny", pattern: "*" },
      { permission: "write", action: "deny", pattern: "*" },
      { permission: "bash", action: "deny", pattern: "*" },
      { permission: "task", action: "deny", pattern: "*" },
      { permission: "skill", action: "deny", pattern: "*" },
      { permission: "apply_patch", action: "deny", pattern: "*" },
    ],
  })

  // 4. Build prompt
  const prompt = buildDreamPrompt(focus)

  // 5. Execute
  await SessionPrompt.prompt({
    sessionID: session.id,
    model: { providerID: model.providerID, modelID: model.modelID },
    agent: "dream",
    parts: [{ type: "text", text: prompt }],
  })

  // 6. Update state
  await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })
}
```

### 4. Gate System Implementation

```ts
// Closure state for throttle
let lastCheck = 0
const THROTTLE_MS = 10 * 60 * 1000 // 10 minutes

async function execute(): Promise<void> {
  // Gate 1: Feature flag
  const cfg = await Config.get()
  const enabled = cfg.experimental?.autodream === true || Flag.OPENCODE_EXPERIMENTAL_AUTODREAM
  if (!enabled) return

  // Gate 2: Engram available
  if (!(await hasEngram())) return

  // Gate 3: Time threshold
  const state = await readState()
  const minHours = Flag.OPENCODE_AUTODREAM_MIN_HOURS || 24
  if (Date.now() - state.lastConsolidatedAt < minHours * 60 * 60 * 1000) return

  // Gate 4: Scan throttle
  if (Date.now() - lastCheck < THROTTLE_MS) return
  lastCheck = Date.now()

  // Gate 5: Session count
  const count = await countSessionsSince(state.lastConsolidatedAt)
  const minSessions = Flag.OPENCODE_AUTODREAM_MIN_SESSIONS || 5
  if (count < minSessions) return

  // Gate 6: Lock
  let lock: Flock.Lease | undefined
  try {
    lock = await Flock.acquire("autodream", {
      timeoutMs: 0, // non-blocking: fail immediately if locked
    })
  } catch {
    return // another dream is running
  }

  // All gates passed — spawn dream
  try {
    await spawnDream()
  } finally {
    await lock.release()
  }
}
```

**Non-blocking lock**: `timeoutMs: 0` makes `Flock.acquire` fail immediately if the lock is held, instead of waiting. This is critical for fire-and-forget behavior.

### 5. Session Counting

```ts
async function countSessionsSince(since: number): Promise<number> {
  let count = 0
  for await (const session of Session.list({ roots: true })) {
    if (session.time.created > since) count++
    if (count >= Flag.OPENCODE_AUTODREAM_MIN_SESSIONS) break // early exit
  }
  return count
}
```

**Why `roots: true`**: Only count top-level sessions, not subagent child sessions.

**Early exit**: Stop counting once we hit the threshold. No need to count all sessions.

### 6. Engram Client Detection

```ts
async function hasEngram(): Promise<boolean> {
  try {
    const clients = await MCP.clients()
    return Object.keys(clients).some((name) => name.toLowerCase().includes("engram"))
  } catch {
    return false
  }
}
```

### 7. `/dream` Command

**Template file** (`src/command/template/dream.txt`):

```
Consolidate and organize persistent memory using Engram.

Review all stored observations, find duplicates, merge related topics,
prune obsolete information, and create cross-session summaries.

$ARGUMENTS
```

**Registration** in `command/index.ts`:

```ts
export const Default = {
  INIT: "init",
  REVIEW: "review",
  DREAM: "dream",
} as const

// In init():
commands[Default.DREAM] = {
  name: Default.DREAM,
  description: "consolidate and organize persistent memory",
  source: "command",
  agent: "dream",
  subtask: true,
  get template() {
    return PROMPT_DREAM
  },
  hints: hints(PROMPT_DREAM),
}
```

**Why `subtask: true`**: The dream runs as a subtask so the parent session continues normally. The user sees a tool-call block with progress, not a full agent takeover.

### 8. Consolidation System Prompt

```
You are a memory consolidation agent. Your job is to review, organize, and
improve the persistent memory stored in Engram.

## Available Tools
You have access to Engram MCP tools (mem_context, mem_search, mem_save,
mem_update, mem_get_observation) and read-only file tools (read, glob, grep).

You CANNOT edit code, run commands, or spawn subagents.

## Workflow

### Phase 1 — Orient
1. Call mem_context(limit: 50) to see recent observations
2. Note: total count, topic distribution, date range, any obvious gaps

### Phase 2 — Gather Signal
Search for issues in the memory:
1. Call mem_search for the project name and key architectural terms
2. Look for:
   - Duplicate observations (same topic, overlapping content)
   - Contradictions (decision A says X, decision B says not-X)
   - Stale info (references to files/patterns that no longer exist — verify with grep/glob)
   - Orphaned observations (no topic_key, generic titles)
   - Missing connections (related observations not linked by topic_key)

### Phase 3 — Consolidate
For each issue found:
- **Duplicates**: Call mem_update on the BEST observation to merge content from both.
  Use mem_get_observation(id) to read full content before merging.
  The weaker duplicate can be updated with a note pointing to the canonical one.
- **Contradictions**: Verify against codebase using read/grep. Update the WRONG one
  to note it was superseded. Keep chronological history.
- **Stale info**: Update with "[STALE]" prefix and explanation of what changed.
- **Orphaned observations**: Update with proper topic_key using mem_update.
- **Cross-session patterns**: Create NEW high-level observations using mem_save
  with topic_key. Example: 3 separate bugfix observations about auth → one
  "architecture/auth-evolution" observation summarizing the journey.

### Phase 4 — Report
Summarize what you did:
- How many observations reviewed
- How many merged/updated/created
- Key themes discovered
- Any observations that need human review

## Rules
- NEVER delete or destroy information. Update with context, don't erase.
- ALWAYS use mem_get_observation(id) to read FULL content before updating.
- ALWAYS preserve topic_key relationships when merging.
- Convert relative dates ("yesterday", "last week") to absolute dates.
- Keep each observation under 500 words. Split if necessary.
- If a focus topic was provided, prioritize it but don't ignore everything else.
```

### 9. Config Schema Changes

In `config.ts` experimental object:

```ts
autodream: z.boolean().optional().describe(
  "Enable automatic memory consolidation via Engram after sessions"
),
```

### 10. Flag Changes

In `flag.ts`:

```ts
export const OPENCODE_EXPERIMENTAL_AUTODREAM = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_AUTODREAM")

export const OPENCODE_AUTODREAM_MIN_HOURS = parseInt(process.env.OPENCODE_AUTODREAM_MIN_HOURS || "24", 10)

export const OPENCODE_AUTODREAM_MIN_SESSIONS = parseInt(process.env.OPENCODE_AUTODREAM_MIN_SESSIONS || "5", 10)
```

### 11. Init Site

The AutoDream init hook should be called where the app boots. Looking at the codebase, the server/TUI startup is the right place. The `init()` function:

1. Subscribes to `SessionStatus.Event.Idle` via `Bus.subscribe`
2. On each idle event, calls `void execute()` (fire-and-forget)
3. Returns an unsubscribe function for cleanup

```ts
export function init(): () => void {
  const unsub = Bus.subscribe(SessionStatus.Event.Idle, (event) => {
    // Only trigger for root sessions
    Session.get(event.properties.sessionID).then((session) => {
      if (session.parentID) return // skip subagent sessions
      void execute()
    })
  })
  return unsub
}
```

---

## Data Flow

### Manual `/dream` Flow

```
User types "/dream auth"
  → Command.get("dream") → template with "auth" as $ARGUMENTS
  → SessionPrompt.command() → resolves agent "dream", subtask: true
  → Creates SubtaskPart → handleSubtask()
  → Session.create(childSession) with deny permissions
  → SessionPrompt.prompt() with dream agent + consolidation prompt
  → Dream agent calls mem_context → mem_search → mem_update/mem_save
  → Returns summary as tool result in parent session
```

### AutoDream Flow (Phase 2)

```
Session goes idle
  → SessionStatus.set("idle") → Bus.publish(Event.Idle)
  → AutoDream.execute() (fire-and-forget)
  → Gates: feature ✓ → engram ✓ → time ✓ → throttle ✓ → sessions ✓ → lock ✓
  → Flock.acquire("autodream")
  → spawnDream()
  → Session.create(dreamSession, no parentID)
  → SessionPrompt.prompt() with dream agent
  → Dream agent works...
  → writeState({ lastConsolidatedAt: Date.now() })
  → Flock.release()
```

---

## Testing Strategy

### Unit Tests

| Test                        | What it validates                                                          |
| --------------------------- | -------------------------------------------------------------------------- |
| `test/dream/gates.test.ts`  | Each gate independently: feature flag, time, throttle, session count, lock |
| `test/dream/state.test.ts`  | State read/write to autodream.json                                         |
| `test/dream/engram.test.ts` | Engram client detection from MCP clients                                   |

### Integration Tests

| Test                    | What it validates                                         |
| ----------------------- | --------------------------------------------------------- |
| Manual `/dream` command | Full flow: command → subtask → dream agent → engram calls |
| Gate system end-to-end  | All gates passing/failing correctly with mock state       |

### What NOT to Test

- The consolidation prompt quality (LLM-dependent, validate manually)
- Engram MCP tool internals (tested by Engram itself)
- Flock locking internals (already tested by flock.test.ts)

---

## Phase Breakdown

### Phase 1 — `/dream` Command (this change)

Files to create/modify:

1. `src/dream/index.ts` — AutoDream namespace (run function only, no auto-trigger)
2. `src/dream/engram.ts` — Engram binary resolution (PATH → cache → download → MCP.add)
3. `src/dream/prompt.txt` — Consolidation prompt
4. `src/command/template/dream.txt` — Command template
5. `src/command/index.ts` — Register `/dream`
6. `src/agent/agent.ts` — Add `dream` agent
7. `src/config/config.ts` — Add `autodream` to experimental
8. `src/flag/flag.ts` — Add flags
9. `packages/sdk/js/script/build.ts` — Regenerate SDK types

### Phase 2 — AutoDream Background (next change)

Files to create/modify:

1. `src/dream/index.ts` — Add gate system, init(), execute(), idle subscription
2. `src/cli/cmd/tui/component/dialog-feature.tsx` — Add toggle
3. Init site (server or TUI boot) — Call `AutoDream.init()`
4. TUI footer — Show "dreaming..." indicator

### Phase 3 — extractMemories (future)

Per-turn memory extraction. Separate change, shares dream agent infrastructure.
