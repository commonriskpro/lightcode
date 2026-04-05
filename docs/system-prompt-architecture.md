# LightCode System Prompt Architecture

## Overview

The system prompt is built in two stages and sent as 3–4 system messages to the LLM.

## Stage 1: `prompt.ts` — builds the `system[]` array

```typescript
const system = [
  ...env, // [1] Environment info
  ...(skills ? [skills] : []), // [2] Skills catalog
  ...instructions, // [3] AGENTS.md / CLAUDE.md / config instructions
  ...(deferredSection ? [deferredSection] : []), // [4] Deferred tools index
]
// + STRUCTURED_OUTPUT_SYSTEM_PROMPT if format.type === "json_schema"
```

**File:** `src/session/prompt.ts`, lines 1588-1602

## Stage 2: `llm.ts` — assembles final system with agent prompt

```typescript
const system = [
  [
    agent.prompt || SystemPrompt.provider(model), // [A] Agent prompt OR provider prompt
    ...input.system, // [B] The array from stage 1
    input.user.system, // [C] System from last user message (rare)
  ]
    .filter((x) => x)
    .join("\n"),
]
// Then Plugin.trigger("experimental.chat.system.transform") can modify it
// If header unchanged after plugin, splits into 2 parts for prompt caching
// Gap D+C: observations always at system[1] (BP3), recall at system[2] (uncached)
// Sentinel "<!-- ctx -->" inserted at system[1] when no observations exist yet
// Volatile always last, never cached
```

**File:** `src/session/llm.ts`, lines 103-134

## Content of Each Part

### [A] Agent Prompt or Provider Prompt

If the agent has a `prompt` field defined → uses that directly.

If not → `SystemPrompt.provider(model)` returns the single unified LightCode prompt:

| Prompt File            | Used For                   |
| ---------------------- | -------------------------- |
| `prompt/lightcode.txt` | All models (single prompt) |

There are no model-specific prompt files. LightCode uses one prompt for all providers.

**File:** `src/session/system.ts`, lines 16-18

### [1] Environment (`SystemPrompt.environment`)

Generated dynamically each turn:

```
You are powered by the model named claude-sonnet-4-6. The exact model ID is anthropic/claude-sonnet-4-6
Here is some useful information about the environment you are running in:
<env>
  Working directory: /Users/dev/lightcodev2
  Workspace root folder: /Users/dev/lightcodev2
  Is directory a git repo: yes
  Platform: darwin
  Today's date: Sat Apr 04 2026
</env>
<directories>

</directories>
```

**File:** `src/session/system.ts`, lines 36-61

### [2] Skills (`SystemPrompt.skills`)

Lists all available skills with verbose descriptions. Only included if the `skill` tool is not disabled by permissions.

```
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <name>typescript</name>
    <description>TypeScript strict patterns and best practices. Trigger: When writing TypeScript code.</description>
    <location>file:///Users/saturno/.config/Claude/skills/typescript/SKILL.md</location>
  </skill>
  <skill>
    <name>react-19</name>
    <description>React 19 patterns with React Compiler. Trigger: When writing React components.</description>
    <location>file:///Users/saturno/.config/Claude/skills/react-19/SKILL.md</location>
  </skill>
  ...
</available_skills>
```

**File:** `src/session/system.ts`, lines 63-75

### [3] Instructions (`Instruction.system`)

Searches and concatenates instruction files in order:

1. **Project-level** — first match of `AGENTS.md` or `CLAUDE.md` walking UP from working directory to worktree root
2. **Global** — first match of:
   - `$OPENCODE_CONFIG_DIR/AGENTS.md` (if set)
   - `~/.config/lightcode/AGENTS.md`
   - `~/.claude/CLAUDE.md` (unless `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`)
3. **Config URLs** — any `instructions: ["https://..."]` entries in lightcode.jsonc

Each file is formatted as:

```
Instructions from: /path/to/AGENTS.md
<full file content>
```

**File:** `src/session/instruction.ts`, lines 164-178

**Search files:** `AGENTS.md`, `CLAUDE.md` (unless disabled), `CONTEXT.md` (deprecated)

**File:** `src/session/instruction.ts`, lines 19-23

### [4] Deferred Tools Index

Only included when deferred tools are active:

```
<deferred-tools>
The following tools are available but not loaded. Use tool_search to load them:
- websearch: Web search via Exa
- webfetch: Fetch URL content as markdown or text
- codesearch: Search code via Context7
- todo: Create and manage todo lists
- apply_patch: Apply unified diff patches
</deferred-tools>
```

**File:** `src/tool/search.ts`, `ToolSearch.fmt()`, lines 61-69

### [C] User System (optional)

If the last user message has a `system` field, it gets appended. This is rare — typically used by programmatic API callers.

## Plugin Hook

After assembly, plugins can modify the system array:

```typescript
Plugin.trigger("experimental.chat.system.transform", { sessionID, model }, { system })
```

The `system` array is mutable — plugins modify it in place.

**File:** `src/session/llm.ts`, lines 118-122

## Prompt Caching Optimization

After plugin transform, if the first element (header/agent prompt) is unchanged, the system is split into exactly 2 parts for prompt caching:

```typescript
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

This ensures the agent prompt (which rarely changes) gets cached by the provider, while the dynamic parts (env, instructions, deferred index) are in the second chunk.

**File:** `src/session/llm.ts`, lines 124-128

After this split, memory segments and volatile content are inserted:

```typescript
// system[1] = observations (BP3 — cacheable, stable between Observer cycles)
// system[2] = recall (session-frozen, NOT cached — uncached by design)
// system[last] = volatile (NOT cached — changes per turn)
system.splice(1, 0, input.observations ?? "<!-- ctx -->")
if (input.recall) system.splice(2, 0, input.recall)
system.push(SystemPrompt.volatile(input.model))
```

**File:** `src/session/llm.ts`, lines 131-138

**Rationale (Gap D+C):** Observations at `system[1]` are stable between Observer cycles (~every 30k tokens), making BP3 effective. Recall is session-frozen and small — the cost of resending ~2k tokens uncached per turn is negligible. This is the inverse of the original design which put recall at BP3 and left observations uncached.

## Final Wire Format

Sent to `streamText` as system messages:

```typescript
const messages = [
  ...system.map((x) => ({ role: "system", content: x })),
  ...input.messages, // conversation history
]
```

Exception: OpenAI OAuth uses `options.instructions` instead of system messages.

**File:** `src/session/llm.ts`, lines 146-162

## Final `system[]` Layout (with memory features)

```
system[0]   — BP2 (1h cache)    Agent prompt + env + skills + instructions joined
system[1]   — BP3 (5min cache)  Local observations <local-observations>...</local-observations>
                                 OR sentinel "<!-- ctx -->" when no observations exist yet
system[2]   — NOT cached        Semantic recall <memory-recall>...</memory-recall> (optional, session-frozen)
system[3]   — NOT cached        Working memory <working-memory>...</working-memory> (optional, session-frozen)
system[last]— NOT cached        Volatile: model identity + today's date
```

`applyCaching()` in `transform.ts` places breakpoints only on `system[0]` (1h TTL) and `system[1]` (5min TTL). Slots [2], [3], and [last] receive no breakpoint — they are re-sent fresh every turn.

**BP3 stability guarantee:** `system[1]` is either the observations block (updated only when Observer activates, ~every 30k tokens) or the static sentinel `"<!-- ctx -->"`. It never changes mid-turn. This makes BP3 hit reliably between Observer cycles.

## Full Example (assembled)

```
[System Message 0 — BP2, 1h cache]:
<lightcode.txt content>
...
[joined with env + skills + instructions]

[System Message 1 — BP3, 5min cache]:
<local-observations>
## Observations

- 🔴 14:23 User is refactoring the session module
- 🔴 14:25 New ObservationTable added to session.sql.ts
- 🟡 14:30 User asked about Effect.forkIn pattern
</local-observations>

IMPORTANT: When responding, use the observations above as background context.
...

[System Message 2 — NOT cached]:
<memory-recall>
## Recent project context
- 🔴 Architecture uses Effect for all service layers
- 🔴 DB: snake_case columns, no string column names
- 🟡 Pending: migrate auth to JWT (mentioned 2026-04-01)
</memory-recall>

[System Message 3 — NOT cached]:
<working-memory>
### tech_stack (project)
TypeScript + SQLite

### current_goal (agent)
Finish auth refactor safely
</working-memory>

[System Message 4 — NOT cached]:
You are powered by the model named claude-sonnet-4-6. The exact model ID is anthropic/claude-sonnet-4-6
Today's date: Sat Apr 04 2026
```

## Related Files

| File                               | Purpose                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `src/session/prompt.ts:1588-1602`  | Stage 1: builds system array                                                  |
| `src/session/llm.ts:100-162`       | Stage 2: assembles with agent prompt, caching, wire format, recall+obs splice |
| `src/session/system.ts`            | `SystemPrompt.provider()`, `environment()`, `skills()`, `observations()`      |
| `src/memory/provider.ts`           | `Memory.buildContext()` — semantic recall + working memory assembly           |
| `src/session/instruction.ts`       | `Instruction.system()` — AGENTS.md/CLAUDE.md loading                          |
| `src/session/om/record.ts`         | `OM` namespace — ObservationTable CRUD                                        |
| `src/session/om/observer.ts`       | `Observer.run()` — background LLM call for intra-session compression          |
| `src/session/om/buffer.ts`         | `OMBuf` state machine — 6k/30k/36k token thresholds                           |
| `src/session/prompt/lightcode.txt` | Unified LightCode agent prompt (all models)                                   |
| `src/tool/search.ts:61-69`         | `ToolSearch.fmt()` — deferred tools section                                   |
