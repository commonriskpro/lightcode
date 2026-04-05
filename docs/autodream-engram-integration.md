# AutoDream + Engram Integration — Design Rationale

## What Is Each Thing

### Engram

A **memory database** (SQLite + FTS5) exposed as MCP server. Think of it as a **hard drive with search**:

- `mem_save` — store a structured observation
- `mem_search` — full-text search
- `mem_context` — recent observations
- `mem_session_summary` — session close summary
- `mem_update` — modify existing observation
- `topic_key` upserts — deduplication by topic

Engram **does NOT think**. It does not consolidate, deduplicate, or connect ideas. It only stores and retrieves. It is **passive storage**.

Who fills Engram today? The model in each session, following the protocol in AGENTS.md ("after each bugfix/decision/discovery, call `mem_save`"). It requires the model to DECIDE to save.

### AutoDream

A **background agent that THINKS about memory**. Think of it as a **librarian organizing shelves while the store is closed**:

- Reviews past session transcripts
- Detects knowledge being lost
- Merges duplicate observations
- Removes obsolete data
- Creates cross-session connections
- Maintains an updated index

AutoDream **has NO storage of its own**. In Claude Code it writes to `.md` files. It needs a backend.

### They Are NOT The Same

They are complementary. Two distinct layers:

```
┌─────────────────────────────────────────┐
│          INTELLIGENCE LAYER             │
│                                         │
│  AutoDream (agent that thinks)          │
│  - Consolidates knowledge               │
│  - Deduplicates observations            │
│  - Connects themes cross-session        │
│  - Prunes obsolete information          │
│  - Generates high-level summaries       │
└──────────────────┬──────────────────────┘
                   │ reads/writes via
                   ▼
┌─────────────────────────────────────────┐
│          STORAGE LAYER                  │
│                                         │
│  Engram (database + search)             │
│  - mem_save / mem_update                │
│  - mem_search (FTS5)                    │
│  - mem_context                          │
│  - topic_key upserts                    │
│  - SQLite persistence                   │
└─────────────────────────────────────────┘
```

**Engram is the library. AutoDream is the librarian.**

---

## Current State in LightCode

The memory system is implemented across two phases:

### Phase 1 — Cross-session recall (shipped)

- `SystemPrompt.recall(pid)` in `system.ts` fetches recent Engram context at session start (step === 1)
- Result injected at `system[1]` (BP3 5min cache) so the agent knows past session context
- AutoDream wired to session idle events — reads compaction summaries + last N messages → `mem_save` to Engram
- `dream/prompt.txt` includes `### Session Observations` section with `topic_key` convention

### Phase 2 — Intra-session observation (shipped)

- Background Observer LLM fires at 30k unobserved tokens via `Effect.forkIn(scope)` in `runLoop`
- Pre-computes observation chunks every 6k tokens (buffered, non-blocking)
- Results stored in local `ObservationTable` (SQLite, session-scoped)
- Observations injected at `system[2]` each turn (dense, fact-level with 🔴🟡 priority)
- AutoDream's `summaries()` reads ObservationTable first for high-quality cross-session signal

### Phase 3 — Reflector / condensation (shipped)

- When `observation_tokens` exceeds `40_000`, `Reflector.run(sid)` fires after each Observer pass
- LLM condenses `observations` → `reflections`; original `observations` are preserved (never cleared)
- `system[2]` injects `rec.reflections ?? rec.observations` — reflections take priority when available

### Remaining gaps

1. **ObservationTable is session-local** — once session ends, signal depends on AutoDream picking it up
2. **No semantic search** — Engram recall uses `mem_context` (recency), not vector similarity or FTS

---

## The Integration: AutoDream + Engram

Instead of AutoDream writing to `.md` files (like Claude Code), it uses Engram as backend:

| AutoDream in Claude Code                      | AutoDream + Engram in LightCode                   |
| --------------------------------------------- | ------------------------------------------------- |
| `grep -rn "term" *.jsonl` to read transcripts | `mem_search("term")` + `mem_context()`            |
| `FileWrite memory/topic.md` to save           | `mem_save(title, content, topic_key)`             |
| `FileEdit memory/topic.md` to update          | `mem_update(id, content)`                         |
| `ls memory/` to orient                        | `mem_context(limit: 50)`                          |
| MEMORY.md as manual 200-line index            | **Not needed** — FTS5 search IS the index         |
| Phase 4 (prune/index) expensive               | **Eliminated** — `topic_key` upserts handle dedup |

### Why This Is Better Than Claude Code's Approach

- **No .md files to maintain** — less IO, fewer tokens on pruning
- **FTS5 search > grep over JSONL** — orders of magnitude faster
- **`topic_key` upserts > editing files** — dedup by design
- **No MEMORY.md index** — full-text search replaces manual index

---

## What AutoDream Would Do With Engram

Every 24h (or N sessions), a background agent:

### Phase 1 — Orient

`mem_context(limit: 50)` — see what's recent, understand current state of knowledge

### Phase 2 — Gather

`mem_search` by key project topics — find orphaned, duplicate, or contradictory observations

### Phase 3 — Consolidate

- `mem_update` to merge duplicates into single observations
- `mem_save` with `topic_key` for high-level observations (e.g., "the auth system evolved from sessions → JWT → OAuth across 3 sessions")
- Delete contradicted facts via `mem_update`

### Phase 4 — Prune (Simplified)

- `mem_update` to correct obsolete info
- No MEMORY.md index maintenance needed
- No file-level pruning needed
- `topic_key` upserts handle deduplication automatically

---

## Comparison Matrix

| Capability                | Engram Only (today)     | AutoDream Only               | AutoDream + Engram                  |
| ------------------------- | ----------------------- | ---------------------------- | ----------------------------------- |
| Storage                   | ✅ SQLite + FTS5        | ❌ Loose .md files           | ✅ SQLite + FTS5                    |
| Search                    | ✅ Full-text search     | ❌ grep over files           | ✅ Full-text search                 |
| Auto-save                 | ⚠️ Model-dependent      | ❌ Only consolidates         | ✅ Model saves + dream consolidates |
| Deduplication             | ⚠️ Manual via topic_key | ✅ Dream merges              | ✅ Both                             |
| Obsolete pruning          | ❌ Nobody does it       | ✅ Dream cleans              | ✅ Dream cleans via mem_update      |
| Cross-session connections | ❌ Sessions isolated    | ✅ Dream connects            | ✅ Dream connects                   |
| Safety net                | ❌ Lost if not saved    | ✅ Dream reviews transcripts | ✅ Double safety net                |

---

## Trigger Mechanism (from Claude Code, adapted)

### When It Fires

After every assistant turn end (fire-and-forget, non-blocking).

### Gate Order (cheapest first, all must pass)

| #   | Gate          | Check                                          | Default                              |
| --- | ------------- | ---------------------------------------------- | ------------------------------------ |
| 1   | Engram gate   | `Engram.ensure()` — binary found or downloaded | Auto-download if needed              |
| 2   | Feature gate  | `cfg.experimental?.autodream !== false`        | Enabled unless explicitly `false`    |
| 3   | SDK gate      | internal `sdk` reference is initialized        | Always true when app is running      |
| 4   | Time gate     | `>= minHours since last consolidation`         | 24 hours                             |
| 5   | Scan throttle | `>= 10min since last check`                    | Prevents expensive checks every turn |
| 6   | Session gate  | `>= minSessions since last consolidation`      | 5 sessions                           |
| 7   | Lock          | Not held by another process                    | Flock-based lock                     |

### Lock Design

Uses LightCode's existing `Flock.acquire("autodream")` with `timeoutMs: 0` for non-blocking attempt. State (lastConsolidatedAt, lastSessionCount) persisted in `~/.local/state/lightcode/autodream.json`.

---

## Tool Sandbox for Dream Agent

| Tool                       | Permission                                  |
| -------------------------- | ------------------------------------------- |
| Engram MCP tools (`mem_*`) | ✅ Allowed — primary interface              |
| `read`                     | ✅ Allowed — read codebase for verification |
| `grep`                     | ✅ Allowed — search codebase                |
| `glob`                     | ✅ Allowed — find files                     |
| `bash`                     | ⚠️ Read-only only (ls, find, cat, stat)     |
| `edit`                     | ❌ Denied — dream doesn't edit code         |
| `write`                    | ❌ Denied — dream doesn't write code        |
| `task`                     | ❌ Denied — dream doesn't spawn subagents   |

---

## Engram Binary Resolution

Engram is a Go binary distributed via Homebrew and GitHub Releases. LightCode resolves it automatically:

```
ensureEngram()
  │
  ├─ 1. MCP client "engram" already connected? → use as-is
  ├─ 2. which("engram") in PATH?              → auto-register MCP
  ├─ 3. ~/.cache/lightcode/bin/engram exists?  → auto-register MCP
  └─ 4. Not found → download from GitHub Releases → extract → auto-register MCP
```

### Platform Support

| Platform       | Asset name                             |
| -------------- | -------------------------------------- |
| `arm64-darwin` | `engram_{VERSION}_darwin_arm64.tar.gz` |
| `x64-darwin`   | `engram_{VERSION}_darwin_amd64.tar.gz` |
| `arm64-linux`  | `engram_{VERSION}_linux_arm64.tar.gz`  |
| `x64-linux`    | `engram_{VERSION}_linux_amd64.tar.gz`  |

Source: `https://github.com/Gentleman-Programming/engram/releases/download/v{VERSION}/`

### MCP Auto-Registration

Uses `MCP.add("engram", { type: "local", command: [binPath, "mcp", "--tools=agent"] })` — in-memory only, does NOT modify `lightcode.jsonc`. User-configured engram always takes priority.

### Version Pinning

Version is a constant (`VERSION = "1.11.0"`). Updated manually on new engram releases. Cache cleared when `CACHE_VERSION` bumps in `global/index.ts`.

---

## Implementation Path

### Phase 1 — Minimal (command-based)

- `/dream` command that runs consolidation as a subagent
- `src/dream/engram.ts` — Engram binary resolution (PATH → cache → download)
- Uses Engram MCP tools as backend
- User triggers manually
- Validates the consolidation prompt works with Engram

### Phase 2 — Automatic (background)

- AutoDream fires on session idle with gate system
- Engram gate uses same `ensureEngram()` from Phase 1
- Forked agent with sandbox permissions
- Lock mechanism for cross-process safety
- "dreaming" indicator in TUI footer

### Phase 3 — extractMemories sibling

- Per-turn memory extraction from current session
- Catches things the model forgot to `mem_save`
- Complements the Engram protocol (belt AND suspenders)
