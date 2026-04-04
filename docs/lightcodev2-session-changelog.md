# LightCode v2 Session Changelog — April 4, 2026

Complete record of all changes, integrations, architectural decisions, and bugs fixed in this session.

---

## 1. Deferred Tools — write, task, skill moved to lazy-load

### What Changed

Moved `write`, `task`, and `skill` from core (always-loaded) to deferred tools in the tool registry.

### Files Modified

- `packages/opencode/src/tool/registry.ts` — `defer(write, ...)`, `defer(task, ...)`, `defer(skill, ...)`
- `packages/opencode/src/session/prompt/lightcode.txt` — split into "Core Tools" and "Additional Tools" sections

### Why

Each tool definition is ~200-400 tokens in the schema. 3 tools = ~600-1200 fewer tokens per prompt. These tools are used moderately (write) or rarely (task, skill).

### Core tools remaining always-loaded (7)

`invalid`, `question`, `bash`, `read`, `glob`, `grep`, `edit`

### Key Insight

`registry.named.task` and `registry.named.read` are used DIRECTLY for subtask execution in `prompt.ts` — they bypass the resolved tools dict entirely, so deferring `task` from the dict doesn't break subtask handling.

---

## 2. AutoDream + Engram — Background Memory Consolidation

### Architecture

```
┌─────────────────────────────────────────┐
│          INTELLIGENCE LAYER             │
│                                         │
│  AutoDream (dream agent)                │
│  - 4-phase consolidation prompt         │
│  - Orient → Gather → Consolidate → Report│
│  - Runs as background LLM session       │
└──────────────────┬──────────────────────┘
                   │ reads/writes via MCP
                   ▼
┌─────────────────────────────────────────┐
│          STORAGE LAYER                  │
│                                         │
│  Engram MCP Server (SQLite + FTS5)      │
│  - mem_save / mem_update                │
│  - mem_search (full-text)               │
│  - mem_context / mem_get_observation    │
│  - Auto-registered at runtime           │
└─────────────────────────────────────────┘
```

### Files Created

| File                                               | Purpose                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/dream/index.ts`                               | AutoDream namespace: run(), init(), spawn(), setSDK(), setModel(), dreaming() |
| `src/dream/engram.ts`                              | Engram binary resolution: PATH → cache → GitHub download → MCP auto-register  |
| `src/dream/prompt.txt`                             | 4-phase consolidation system prompt for the dream agent                       |
| `src/command/template/dream.txt`                   | Unused now (was for subtask command, now TUI command)                         |
| `src/cli/cmd/tui/component/dialog-dream-model.tsx` | Model selector dialog for /dreammodel                                         |

### Files Modified

| File                                                 | Change                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/agent/agent.ts`                                 | `dream` agent definition — hidden subagent, read+glob+grep only, model from config                            |
| `src/cli/cmd/tui/app.tsx`                            | `/dream` + `/dreammodel` TUI commands, SDK injection (setSDK, setRegistrar, setModel)                         |
| `src/config/config.ts`                               | `experimental.autodream` boolean + `autodream_model` string                                                   |
| `src/flag/flag.ts`                                   | `OPENCODE_EXPERIMENTAL_AUTODREAM`, `OPENCODE_AUTODREAM_MIN_HOURS` (24), `OPENCODE_AUTODREAM_MIN_SESSIONS` (5) |
| `src/project/bootstrap.ts`                           | `AutoDream.init()` called at startup                                                                          |
| `src/cli/cmd/tui/component/dialog-feature.tsx`       | AutoDream toggle in /features                                                                                 |
| `src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx` | Animated ☁ dream indicator (12-frame, 400ms)                                                                 |
| `packages/sdk/js/src/v2/gen/types.gen.ts`            | Regenerated with autodream + autodream_model fields                                                           |

### How `/dream` Works

```
User types /dream
  → TUI onSelect handler (non-blocking, fire-and-forget)
  → Toast: "Consolidation started in background…"
  → Engram.ensure() — resolves binary (PATH/cache/download), registers MCP via SDK
  → AutoDream.run()
    → sdk.session.create({ title: "AutoDream consolidation" })
    → sdk.session.promptAsync({ agent: "dream", model, parts: [consolidation prompt] })
    → Poll sdk.session.status() every 2s until session goes idle
    → _dreaming = true throughout → sidebar shows ☁ animation
  → Toast: "Dream consolidation completed"
  → Main agent continues working normally (non-blocking)
```

### How AutoDream Auto-Trigger Works

```
Session goes idle → Bus.publish(SessionStatus.Event.Idle)
  → AutoDream.init() subscriber fires
  → Check: configuredModel exists? (set via /dreammodel)
  → AutoDream.run() — same flow as manual /dream
```

### Engram Binary Resolution Chain

```
Engram.ensure()
  │
  ├─ 1. MCP client "engram" already connected? → use as-is
  ├─ 2. which("engram") in PATH?              → auto-register MCP via SDK
  ├─ 3. ~/.cache/lightcode/bin/engram exists?  → auto-register MCP via SDK
  └─ 4. Not found → download from GitHub Releases → extract → auto-register
```

Platform support: `arm64-darwin`, `x64-darwin`, `arm64-linux`, `x64-linux`
Version pinned: `1.11.0` (from `Gentleman-Programming/engram`)

### Model Configuration

```
/dreammodel → fuzzy-search model selector → saves to global config
Config: experimental.autodream_model = "provider/model"
Resolution: config autodream_model → agent.model → error
```

### Dream Agent Definition

```ts
dream: {
  name: "dream",
  mode: "subagent",
  hidden: true,
  permission: { "*": "deny", read: "allow", glob: "allow", grep: "allow" },
  model: from config autodream_model via Provider.parseModel(),
  prompt: PROMPT_DREAM (4-phase consolidation),
}
```

### TUI Indicator

12-frame animated cloud in sidebar footer (`feature-plugins/sidebar/footer.tsx`):

```
☁     dreaming
☁ ☁   dreaming.
☁   ☁  dreaming..
☁     ☁ dreaming…
✦ ☁   dreaming
✦ ☁ ✦ dreaming.
✦  ☁ ✦ dreaming..
```

Cycles at 400ms, uses `theme.accent` color. Visible during sessions above `• OpenCode 1.3.14`.

---

## 3. Critical Bug: InstanceState Context Error

### The Problem

ALL Effect-backed services in LightCode use `makeRuntime` with `InstanceState` (Effect `AsyncLocalStorage`). This context is ONLY available inside the Hono server's request handlers.

TUI code (SolidJS components, `onSelect` callbacks, `createEffect`) runs OUTSIDE this context. Any direct call to:

- `MCP.add()`, `MCP.status()`
- `Session.create()`, `Session.list()`
- `SessionPrompt.prompt()`
- `Config.get()`
- `Flock.acquire()`
- `Filesystem.*`

...fails with **"No context found for instance"**.

### The Fix

All service calls routed through SDK HTTP client (`sdk.client.*`) which goes through the Hono server that HAS the context.

Three injection points:

```ts
// In app.tsx, after useSDK()
Engram.setRegistrar(async (name, config) => {
  await sdk.client.mcp.add({ name, config })
})
AutoDream.setSDK(sdk.client as any)
createEffect(() => {
  AutoDream.setModel(sync.data.config?.experimental?.autodream_model)
})
```

### What Works Without InstanceState

- `Bus.subscribe()` — has its own separate runtime
- `Bun.file()` / `Bun.write()` — native Bun APIs, no Effect
- `which()` — pure synchronous function
- `Log.create()` — standalone logger

### What REQUIRES InstanceState (must go through SDK)

- Everything in `src/mcp/`
- Everything in `src/session/`
- Everything in `src/config/`
- Everything in `src/util/filesystem.ts`
- Everything in `src/util/flock.ts`

---

## 4. Documentation Created

| Document                               | Content                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/claude-code-architecture.md`     | Complete architecture of Claude Code's agent/task system (7 task types, 50+ tools, permission model, coordinator mode) with comparison table vs Gentle-AI vs LightCode |
| `docs/autodream-architecture.md`       | Claude Code's AutoDream internals: trigger mechanism, gate system, lock, consolidation prompt, tool sandbox, lifecycle                                                 |
| `docs/autodream-engram-integration.md` | Design rationale: why Engram + AutoDream are complementary (library vs librarian analogy), comparison matrix, implementation path                                      |
| `docs/autodream-proposal.md`           | Change proposal: intent, scope, approach (3 phases), risks + mitigation, rollback plan                                                                                 |
| `docs/autodream-spec.md`               | 10 requirements (REQ-1 to REQ-10) with sub-items, 16 scenarios (SCN-1 to SCN-16)                                                                                       |
| `docs/autodream-design.md`             | Technical design: architecture diagram, file plan, component pseudocode, gate system, data flow, testing strategy, Engram binary resolution section                    |

---

## 5. Commits (chronological)

| Hash      | Message                                                                |
| --------- | ---------------------------------------------------------------------- |
| `9245c1d` | feat: add autodream memory consolidation with engram integration       |
| `a9303dd` | feat: add autodream phase 2 — auto-trigger on session idle             |
| `ff24b58` | feat: add /dreammodel command for configurable autodream model         |
| `50912ca` | feat: wire autodream to spawn background LLM sessions                  |
| `cbbea7e` | feat: /dream as non-blocking TUI command + animated footer indicator   |
| `b825c71` | feat: animated cloud dream indicator in footer                         |
| `eb9153b` | fix: improve engram diagnostics — verbose logging + retry on failure   |
| `cecce87` | fix: use SDK HTTP endpoint for engram MCP registration                 |
| `c49b0d5` | fix: route all autodream calls through SDK HTTP to avoid InstanceState |
| `2567c04` | fix: eliminate ALL direct Effect service calls from AutoDream          |
| `d1ba154` | fix: move dream indicator to sidebar footer (visible during sessions)  |
| `39e5866` | fix: poll session status to keep dreaming indicator alive              |
| `01ab0d5` | docs: complete session changelog with all integrations and learnings   |
| `f0bd72e` | chore: remove orphaned footer.tsx and dream.txt files                  |
| `db5d52e` | docs: performance features spec                                        |
| `797f614` | feat: tool concurrency safety, cache stability sorting, fork subagent  |

---

## 8. Known Issues / Next Steps

### Engram MCP not available to main agent

The engram MCP server registers dynamically when `/dream` runs, but the main agent session that's already active doesn't pick up new MCP tools mid-session. Solutions:

1. **Config-based**: Add engram to `lightcode.jsonc` MCP section manually — available from session start
2. **Startup registration**: Run `Engram.ensure()` during app boot (timing issue: SDK not available yet)
3. **Session refresh**: Force tool re-resolution after MCP servers change

### Missing features

- **Phase 3: extractMemories** — per-turn memory extraction from current session (catches things the protocol missed)
- **Flock locking** — removed due to InstanceState; need SDK-based or Bun-native locking
- **Cost Tracker** — spec exists in `docs/cost-tracker-arch.md`, single file change, entire pipeline exists
- **Reactive Compact** — spec exists in `docs/reactive-compact-arch.md`, ~30 lines of changes

### From Gentle-AI (still to port)

- **SDD Workflow** — 10 SKILL.md + orchestrator + 9 commands + 2 overlays
- **Judgment Day** — parallel adversarial review (1 SKILL.md)
- **Strict TDD Module** — RED→GREEN→TRIANGULATE→REFACTOR (1 markdown)
- **Per-phase model routing** — config mapping phase → provider/model
- **Skill Registry + Resolver** — auto-detect skills by context

### From Claude Code (remaining)

- **StreamingToolExecutor** — start tool execution before full message streamed (AI SDK handles internally, lower priority)
- **Coordinator mode** — parallel worker orchestration (high complexity, low priority for CLI)

### Config for always-on Engram

Users should add to `~/.config/lightcode/lightcode.jsonc`:

```jsonc
{
  "mcp": {
    "engram": {
      "type": "local",
      "command": ["engram", "mcp", "--tools=agent"],
    },
  },
}
```

This makes Engram available to ALL agents from session start, not just the dream agent.
