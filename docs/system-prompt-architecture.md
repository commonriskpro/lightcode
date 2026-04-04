# LightCode System Prompt Architecture

## Overview

The system prompt is built in two stages and sent as 1-2 system messages to the LLM.

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
```

**File:** `src/session/llm.ts`, lines 103-128

## Content of Each Part

### [A] Agent Prompt or Provider Prompt

If the agent has a `prompt` field defined → uses that directly.

If not → selects by model ID from built-in prompt files:

| Model Pattern       | Prompt File            | First Line                                   |
| ------------------- | ---------------------- | -------------------------------------------- |
| `claude`            | `prompt/anthropic.txt` | "You are OpenCode, the best coding agent..." |
| `gpt-4`, `o1`, `o3` | `prompt/beast.txt`     | Beast mode prompt                            |
| `gpt` (other)       | `prompt/gpt.txt`       | GPT-specific prompt                          |
| `gpt` + `codex`     | `prompt/codex.txt`     | Codex-specific prompt                        |
| `gemini-`           | `prompt/gemini.txt`    | Gemini-specific prompt                       |
| `kimi`              | `prompt/kimi.txt`      | Kimi-specific prompt                         |
| `trinity`           | `prompt/trinity.txt`   | Trinity-specific prompt                      |
| (default)           | `prompt/default.txt`   | Generic prompt                               |

**File:** `src/session/system.ts`, lines 20-34

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

## Full Example (assembled)

```
[System Message 1 — cached]:
You are OpenCode, the best coding agent on the planet.
You are an interactive CLI tool that helps users with software engineering tasks...
<tone and style rules>
<professional objectivity>
<task management>
<proactive tool use>
...

[System Message 2 — dynamic]:
You are powered by the model named claude-sonnet-4-6...
<env>
  Working directory: /Users/dev/lightcodev2
  ...
</env>
<directories>
</directories>

Skills provide specialized instructions and workflows...
<available_skills>
  <skill>
    <name>typescript</name>
    ...
  </skill>
</available_skills>

Instructions from: /Users/dev/lightcodev2/AGENTS.md
<AGENTS.md content>

Instructions from: /Users/saturno/.config/lightcode/AGENTS.md
<global AGENTS.md content>

<deferred-tools>
The following tools are available but not loaded. Use tool_search to load them:
- websearch: Web search via Exa
- webfetch: Fetch URL content as markdown or text
- codesearch: Search code via Context7
</deferred-tools>
```

## Related Files

| File                               | Purpose                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `src/session/prompt.ts:1588-1602`  | Stage 1: builds system array                               |
| `src/session/llm.ts:100-162`       | Stage 2: assembles with agent prompt, caching, wire format |
| `src/session/system.ts`            | `SystemPrompt.provider()`, `environment()`, `skills()`     |
| `src/session/instruction.ts`       | `Instruction.system()` — AGENTS.md/CLAUDE.md loading       |
| `src/session/prompt/anthropic.txt` | Claude provider prompt                                     |
| `src/session/prompt/beast.txt`     | GPT-4/o1/o3 provider prompt                                |
| `src/session/prompt/gpt.txt`       | GPT generic provider prompt                                |
| `src/session/prompt/gemini.txt`    | Gemini provider prompt                                     |
| `src/session/prompt/kimi.txt`      | Kimi provider prompt                                       |
| `src/session/prompt/default.txt`   | Default fallback prompt                                    |
| `src/tool/search.ts:61-69`         | `ToolSearch.fmt()` — deferred tools section                |
