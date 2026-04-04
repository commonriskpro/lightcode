# OpenCode vs Claude Code - Architectural Comparison

## Overview

This document provides a detailed comparison between OpenCode and Claude Code architectures, highlighting features, tools, patterns, and potential improvements for the OpenCode fork.

---

## 1. Tool System Comparison

### 1.1 Built-in Tools

| Feature           | OpenCode                            | Claude Code                                                        |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------ |
| **Core Tools**    | bash, read, edit, write, grep, glob | bash, read, edit, write, grep, glob                                |
| **Web Tools**     | webfetch, websearch, codesearch     | webfetch, websearch                                                |
| **Task/Delegate** | task (subagent delegation)          | agent (AgentTool)                                                  |
| **Skills**        | skill (SKILL.md based)              | skill (SKILL.md based)                                             |
| **Planning**      | plan (plan mode)                    | enter_plan, exit_plan                                              |
| **Todo**          | todowrite                           | task_create/get/update/list                                        |
| **Batch**         | batch (parallel execution)          | -                                                                  |
| **LSP**           | lsp (experimental)                  | lsp (native)                                                       |
| **Question**      | question (ask user)                 | ask_user_question                                                  |
| **Patch**         | apply_patch                         | file_edit (diff-based)                                             |
| **Extra Tools**   | -                                   | notebook_edit, config, tungsten, web_browser, workflow, cron_tools |

**OpenCode Advantages:**

- `batch` tool for parallel tool execution
- `apply_patch` for structured GPT-style patches
- `codesearch` for semantic code search

**Claude Code Advantages:**

- More granular task tools (create, get, update, list)
- Native LSP support
- Workflow scripts
- Cron job scheduling
- Notebook editing
- Web browser tool
- Team management tools (swarm/multi-agent)

### 1.2 Tool Registration & Discovery

| Feature                 | OpenCode                                 | Claude Code                     |
| ----------------------- | ---------------------------------------- | ------------------------------- |
| **Registration**        | ToolRegistry with Effect/Service pattern | tools.ts with getAllBaseTools() |
| **Custom Tools**        | {tool,tools}/ directories via Glob       | Plugins via manifest.json       |
| **MCP Integration**     | MCP.tools() from MCP service             | MCPConnectionManager            |
| **Conditional Loading** | Feature flags in code                    | Feature flags + bundle/env      |
| **Model Filtering**     | Per-model tool filtering (GPT vs others) | Tool permission context         |

**OpenCode Pattern:**

```typescript
// Effect-based service pattern
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const matches = Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir })
    for (const match of matches) {
      const mod = await import(match)
      custom.push(fromPlugin(id, def))
    }
  }),
)
```

**Claude Code Pattern:**

```typescript
// Static array with conditional inclusion
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ...(isTodoV2Enabled() ? [TaskCreateTool, TaskGetTool, ...] : []),
    // Feature-flagged tools
    ...(Feature('WEB_BROWSER_TOOL') ? [WebBrowserTool] : []),
  ]
}
```

### 1.3 Tool Definition Structure

**OpenCode:**

```typescript
Tool.Info = {
  id: string
  init: (ctx?) => Promise<{
    description: string
    parameters: ZodSchema
    execute: (args, ctx) => Promise<ToolResult>
    formatValidationError?: (e) => string
  }>
}
```

**Claude Code:**

```typescript
Tool<Input, Output, P> = {
  call: (args, context, canUseTool, parentMessage, onProgress) => Promise<ToolResult>
  description: (input, options) => Promise<string>
  prompt: (options) => Promise<string>
  inputSchema: Input // Zod
  outputSchema?: ZodType
  name: string
  shouldDefer?: boolean // Tool deferral
  alwaysLoad?: boolean
  isConcurrencySafe: (input) => boolean
  isDestructive?: (input) => boolean
  validateInput?: (input, context) => Promise<ValidationResult>
  checkPermissions?: (input, context) => Promise<PermissionResult>
  renderToolUseMessage: (input, options) => ReactNode
  renderToolResultMessage: (content, progress, options) => ReactNode
}
```

**Claude Code Advantages:**

- Richer tool interface with validation hooks
- React rendering for tool messages
- Concurrency safety indicators
- Destructive tool detection
- Tool deferral mechanism

---

## 2. Intent Routing & Tool Selection

### 2.1 Routing Architecture

| Feature                   | OpenCode                          | Claude Code       |
| ------------------------- | --------------------------------- | ----------------- |
| **Offline Routing**       | ✅ Full implementation            | ❌ Not present    |
| **Intent Classification** | ✅ Xenova embeddings + prototypes | ❌ Not present    |
| **Keyword Rules**         | ✅ 18+ regex patterns             | ❌ Not present    |
| **Tool Deferral**         | ❌ Not present                    | ✅ ToolSearchTool |
| **Auto Selection**        | ✅ Token budget aware             | ❌ Not present    |

### 2.2 OpenCode's Tool Router (Advanced)

OpenCode has a sophisticated offline router with multiple modes:

```typescript
// Configuration options
experimental: {
  tool_router: {
    enabled: true,
    mode: "hybrid", // "rules" | "hybrid"
    local_intent_embed: true,
    local_embed: true,
    exact_match: {
      dynamic_ratio: true,
      per_tool_min: true,
      calibration: true,
      redundancy: true,
      two_pass: true,
    },
    exposure_mode: "per_turn_subset" | "memory_only_unlocked" | ...
  }
}
```

**Key Features:**

- **Intent Embeddings**: Uses Xenova paraphrase-multilingual-MiniLM-L12-v2
- **22 Intent Prototypes**: edit/refactor, create/implement, delete/remove, etc.
- **Exact Match Post-processing**: dynamic_ratio, intent_gating, per_tool_min, calibration
- **Tool Exposure Memory**: Tracks unlocked tools across conversation
- **Sticky Tools**: Persists tools between turns
- **Fallback Expansion**: Recovers from empty selections

### 2.3 Claude Code's Tool Deferral

Claude Code uses a different approach - tool deferral:

```typescript
// Tool can declare deferral
shouldDefer?: boolean  // Don't send schema to LLM
alwaysLoad?: boolean   // Always send

// If tool is deferred:
// 1. API returns error with defer_loading hint
// 2. Model calls ToolSearch with query="select:tool"
// 3. ToolSearch loads deferred tool schema
// 4. Model retries with schema present
```

**Comparison:**

- **OpenCode**: Filters tools BEFORE sending to LLM (offline routing)
- **Claude Code**: Sends all tools, defers loading of unused schemas (online)

---

## 3. Hook System Comparison

### 3.1 Hook Types

| Hook Type              | OpenCode                             | Claude Code |
| ---------------------- | ------------------------------------ | ----------- |
| **Pre-Tool**           | tool.execute.before                  | PreToolUse  |
| **Post-Tool**          | tool.execute.after                   | PostToolUse |
| **Chat Params**        | chat.params                          | -           |
| **Chat Headers**       | chat.headers                         | -           |
| **Tool Definition**    | tool.definition                      | -           |
| **Command**            | command.execute.before               | -           |
| **Shell Env**          | shell.env                            | -           |
| **System Transform**   | experimental.chat.system.transform   | -           |
| **Messages Transform** | experimental.chat.messages.transform | -           |
| **Event Bus**          | event                                | -           |

### 3.2 Claude Code Hook System (More Advanced)

Claude Code has a more comprehensive hook system:

```typescript
// Hook types
HookCommand =
  | { type: 'command', command: string, if?: string, ... }
  | { type: 'prompt', prompt: string, model?: string, ... }
  | { type: 'agent', prompt: string, model?: string, ... }
  | { type: 'http', url: string, headers?: {...}, ... }

// Hook events
- PreToolUse
- PostToolUse
- Notify
- Start
- Stop
- MessageCreate
- AgentStart
- AgentStop

// Session hooks (ephemeral)
addSessionHook(sessionId, event, matcher, hook, callback)
addFunctionHook(sessionId, event, matcher, callback)
```

**Hook Execution Flow (Claude Code):**

1. getMatchingHooks() - Find hooks by tool name
2. Evaluate 'if' conditions
3. Execute hooks in parallel
4. Aggregate permission behaviors (deny > ask > allow)
5. Process results (message, hook_permission_result, hook_updated_input)

### 3.3 OpenCode Hook System

```typescript
// Current implementation
Plugin.trigger("tool.execute.before", { tool, sessionID, callID }, { args })
Plugin.trigger("tool.execute.after", { tool, sessionID, callID, args }, result)
Plugin.trigger("experimental.chat.messages.transform", {}, { messages })
```

**OpenCode Advantages:**

- Effect-based service architecture
- Type-safe hook triggers

**Claude Code Advantages:**

- More hook types (command, prompt, agent, http, callback)
- Session-scoped ephemeral hooks
- Hook chaining with passthrough
- JSON-based hook configuration (hooks.json)

---

## 4. Session/Prompt Architecture

### 4.1 Context Building

| Feature                 | OpenCode            | Claude Code           |
| ----------------------- | ------------------- | --------------------- |
| **System Prompt Cache** | ✅ 1-hour TTL       | ✅ Cached             |
| **Instruction Modes**   | full/deferred/index | default/custom/append |
| **Memory Mechanics**    | SessionSummary      | sessionMemory         |
| **Context Compaction**  | SessionCompaction   | compact_boundary      |

### 4.2 Context Tier System

**OpenCode** has a unique 3-tier system:

- **conversation**: Chit-chat detection, minimal prompt (~50 tokens)
- **minimal**: No tool match, base tools only
- **full**: Normal operation with matched tools

**Claude Code** uses:

- **Tool Deferral**: Schema loading on demand
- **Memory**: SessionMemory service for conversation summarization
- **Compact Boundaries**: System messages marking compaction points

### 4.3 Token Accounting

**OpenCode:** Detailed logging to JSONL

```typescript
// Logged to {data}/debug/tokens/{sessionID}.jsonl
{
  step: 1,
  contextTier: "full",
  system: { tokens: 1500, instructionMode: "full" },
  messages: { total: 10, user: 3, assistant: 7 },
  userText: { tokens: 500, partCount: 2 },
  toolResults: { tokens: 2000, partCount: 5 },
  toolDefs: { tokens: 800, count: 12 }
}
```

**Claude Code:** Token budget tracking via tokenBudget.ts

---

## 5. Agent/Task System

### 5.1 Agent Types

| Agent         | OpenCode                      | Claude Code |
| ------------- | ----------------------------- | ----------- |
| **Primary**   | build, plan, sdd-orchestrator | default     |
| **Subagents** | explore, sdd-\*, judgment-day | agent tool  |
| **Special**   | compaction, title, summary    | -           |

### 5.2 SDD Workflow (OpenCode Unique)

OpenCode has a sophisticated SDD (Spec-Driven Development) workflow:

```
sdd-orchestrator → sdd-explore → sdd-propose → sdd-spec
    → sdd-design → sdd-tasks → sdd-apply → sdd-verify → sdd-archive
```

Each phase returns:

- status
- executive_summary
- artifacts
- next_recommended

### 5.3 Claude Code Agent Swarms

Claude Code has multi-agent coordination:

```typescript
// Team management
TeamCreateTool // Create agent swarm
TeamDeleteTool // Delete swarm
ListPeersTool // List connected peers
SendMessageTool // Inter-agent messaging
```

---

## 6. Features Comparison

### 6.1 Unique OpenCode Features

| Feature                         | Description                             |
| ------------------------------- | --------------------------------------- |
| **Offline Tool Router**         | Intent-based tool filtering without LLM |
| **Tool Exposure Memory**        | Tracks unlocked tools across turns      |
| **Exact Match Post-processing** | dynamic_ratio, calibration, redundancy  |
| **Auto Tool Selection**         | Token budget-aware tool selection       |
| **SDD Workflow**                | Spec-driven development orchestration   |
| **Batch Tool**                  | Parallel tool execution                 |
| **Apply Patch**                 | Structured GPT-style diffs              |
| **Code Search**                 | Semantic codebase search                |

### 6.2 Unique Claude Code Features

| Feature                | Description                      |
| ---------------------- | -------------------------------- |
| **Tool Deferral**      | Lazy loading of tool schemas     |
| **Tool Search**        | Discover and load deferred tools |
| **Agent Swarms**       | Multi-agent coordination         |
| **Workflow Scripts**   | Predefined automation scripts    |
| **Cron Jobs**          | Scheduled task execution         |
| **Web Browser**        | Browser automation tool          |
| **REPL Mode**          | Interactive shell integration    |
| **Context Inspection** | Debug context state              |
| **Voice Mode**         | Voice input support              |

---

## 7. Potential Improvements for OpenCode

### 7.1 High Priority

| Improvement             | Source      | Description                         |
| ----------------------- | ----------- | ----------------------------------- |
| **Tool Deferral**       | Claude Code | Add shouldDefer/alwaysLoad to tools |
| **Rich Tool Interface** | Claude Code | Add validation hooks, rendering     |
| **Session Hooks**       | Claude Code | Add ephemeral session hooks         |
| **HTTP Hooks**          | Claude Code | Add http hook type                  |
| **Cron Tools**          | Claude Code | Add scheduled task tools            |
| **Workflow Scripts**    | Claude Code | Add automation scripts              |

### 7.2 Medium Priority

| Improvement             | Source      | Description                 |
| ----------------------- | ----------- | --------------------------- |
| **Agent Swarms**        | Claude Code | Multi-agent coordination    |
| **Web Browser**         | Claude Code | Browser automation          |
| **More Granular Tasks** | Claude Code | task_create/get/update/list |
| **REPL Integration**    | Claude Code | Interactive shell           |
| **Context Inspection**  | Claude Code | Debug tools                 |

### 7.3 Architecture Patterns to Adopt

**1. Tool Concurrency Partitioning (Claude Code):**

```typescript
// Partition tools by safety
const { isConcurrencySafe, blocks } = partitionToolCalls(toolUses)
if (isConcurrencySafe) {
  yield * runToolsConcurrently(blocks) // Read-only: parallel
} else {
  yield * runToolsSerially(blocks) // Write: serial
}
```

**2. Hook Permission Precedence:**

```typescript
// Deny > Ask > Allow
switch (result.permissionBehavior) {
  case "deny":
    permissionBehavior = "deny"
    break
  case "ask":
    if (permissionBehavior !== "deny") permissionBehavior = "ask"
    break
  case "allow":
    if (!permissionBehavior) permissionBehavior = "allow"
    break
}
```

**3. Message Normalization:**

```typescript
// Filter UI-only messages for API
normalizeMessagesForAPI(messages)
// Removes: compact_boundary, hook_additional_context, progress
```

---

## 8. Summary

### OpenCode Strengths:

- ✅ Sophisticated offline tool routing with embeddings
- ✅ Tool exposure memory across turns
- ✅ SDD workflow orchestration
- ✅ Effect-based architecture
- ✅ Batch tool for parallelization

### Claude Code Strengths:

- ✅ Rich tool interface with validation
- ✅ Comprehensive hook system
- ✅ Tool deferral mechanism
- ✅ Agent swarms/multi-agent
- ✅ More built-in tools
- ✅ Workflow scripts

### Recommended Focus:

1. Add tool deferral mechanism to OpenCode
2. Enhance hook system with more types
3. Add agent swarm support
4. Add workflow scripts
5. Consider tool concurrency partitioning

---

_Generated for OpenCode fork development_
