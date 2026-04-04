# Claude Code Agent/Task System - Complete Architecture

Source: `/Users/saturno/Downloads/src` (Claude Code source)

## 1. All Agent/Task Types

### Task Types (defined in `Task.ts`)

The `TaskType` union defines **7 task types**:

| TaskType              | Implementation          | Role                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local_bash`          | `LocalShellTask`        | Background shell command execution. Runs `ShellCommand` in the background, monitors for stalls (interactive prompts), and notifies on completion.                                                                                                    |
| `local_agent`         | `LocalAgentTask`        | The PRIMARY subagent mechanism. Spawns a full Claude conversation loop (`runAgent()`) either sync (foreground) or async (background). Supports foreground-to-background transition, progress tracking, tool activity monitoring, and summarization.  |
| `remote_agent`        | `RemoteAgentTask`       | Delegates work to a remote Claude Cloud Run (CCR) session. Polls for session events, handles remote reviews (ultrareview), ultraplan, autofix-PR, and background-PR task types. Persists metadata for `--resume` reconnection.                       |
| `in_process_teammate` | `InProcessTeammateTask` | Runs in the SAME Node.js process using `AsyncLocalStorage` for isolation. Team-aware identity (`agentName@teamName`), supports plan mode approval flow, idle/active state, user message injection into transcripts, and has its own permission mode. |
| `local_workflow`      | `LocalWorkflowTask`     | Feature-gated (`WORKFLOW_SCRIPTS`). Runs local workflow scripts.                                                                                                                                                                                     |
| `monitor_mcp`         | `MonitorMcpTask`        | Feature-gated (`MONITOR_TOOL`). Monitors MCP server streams.                                                                                                                                                                                         |
| `dream`               | `DreamTask`             | Memory consolidation subagent ("auto-dream"). A background fork that reviews past sessions, edits/writes memory files (`CLAUDE.md` or `memories/`), and tracks which files were touched. Has phases: `starting` and `updating`.                      |

### Task Lifecycle States

All tasks share: `pending` -> `running` -> `completed` | `failed` | `killed`

`isTerminalTaskStatus()` returns true for completed/failed/killed. Tasks have `notified` flag to prevent duplicate notifications, `evictAfter` timestamp for GC.

### Built-In Agent Definitions (from `builtInAgents.ts` + `built-in/`)

| Agent               | File                      | Role                                                                                                                                                                                                  |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `general-purpose`   | `generalPurposeAgent.ts`  | Default agent for unspecified `subagent_type`. General code tasks.                                                                                                                                    |
| `Explore`           | `exploreAgent.ts`         | Read-only research. Omits CLAUDE.md and gitStatus for efficiency.                                                                                                                                     |
| `Plan`              | `planAgent.ts`            | Read-only planning. Same optimizations as Explore.                                                                                                                                                    |
| `claude-code-guide` | `claudeCodeGuideAgent.ts` | Help/documentation agent (non-SDK only).                                                                                                                                                              |
| `statusline-setup`  | `statuslineSetup.ts`      | Terminal status line configuration.                                                                                                                                                                   |
| `verification`      | `verificationAgent.ts`    | Feature-gated verification agent.                                                                                                                                                                     |
| `fork`              | `forkSubagent.ts`         | Special: inherits the PARENT's system prompt and full conversation context for prompt cache sharing. The fork path is activated when `subagent_type` is omitted AND the fork feature gate is enabled. |
| `worker`            | Coordinator mode          | In coordinator mode, `getCoordinatorAgents()` provides worker agents.                                                                                                                                 |

Custom agents are loaded from `.claude/agents/` directories (user, project, local, plugin sources) via `loadAgentsDir.ts` using markdown frontmatter or JSON format.

---

## 2. How Agents Are Dispatched

### The Coordinator (`coordinator/coordinatorMode.ts`)

When `CLAUDE_CODE_COORDINATOR_MODE=1`:

- The main thread becomes a **coordinator** that ONLY has tools: `Agent`, `TaskStop`, `SendMessage`, `SyntheticOutput`
- It gets a specialized system prompt (`getCoordinatorSystemPrompt()`) with detailed instructions for spawning workers, synthesizing results, managing concurrency
- Workers are spawned via `AgentTool` with `subagent_type: "worker"`
- Worker results arrive as `<task-notification>` XML in user-role messages
- The coordinator's `getCoordinatorUserContext()` injects worker tool listings, MCP server info, and scratchpad directory into the user context

### Dispatch Flow (AgentTool.tsx -> runAgent.ts -> query.ts)

1. **AgentTool.call()** resolves the agent type, checks MCP requirements, decides sync vs async
2. **Sync path**: Calls `runAgent()` directly, races each message against a `backgroundSignal` promise. If backgrounded (user presses Ctrl+B or auto-background timer fires), transitions to async
3. **Async path**: Calls `registerAsyncAgent()`, then fires `runAsyncAgentLifecycle()` in a detached `void` promise wrapped in `runWithAgentContext()`
4. **Fork path**: When `subagent_type` is omitted and fork gate is on, inherits parent's system prompt and builds forked messages via `buildForkedMessages()` for cache-identical API prefixes
5. **Remote path**: `isolation: "remote"` teleports to CCR, starts polling via `registerRemoteAgentTask()`
6. **Teammate path**: When `team_name` + `name` are set, delegates to `spawnTeammate()` for in-process or tmux teammates

### runAgent.ts (the core agent runner)

`runAgent()` is an **async generator** that:

1. Creates a unique `agentId`
2. Resolves the agent model via `getAgentModel()` (agent def model -> parent model -> user override)
3. Builds the agent's system prompt via `getAgentSystemPrompt()` or inherits parent's (fork path)
4. Initializes agent-specific MCP servers
5. Creates a `subagentContext` via `createSubagentContext()` (isolates setAppState for async agents, shares for sync)
6. Registers frontmatter hooks, preloads skills
7. Calls `query()` in a `for await` loop, yielding each message
8. Records each message to sidechain transcript
9. Cleans up: MCP servers, session hooks, cache tracking, file state, perfetto tracing, bash tasks

### query.ts (the multi-turn loop)

`query()` is the MAIN orchestration loop:

1. Runs in a `while(true)` loop
2. Each iteration: prepends `userContext`, appends `systemContext`, gets attachment messages (memory, agent listings, skill discovery)
3. Calls `claude()` API streaming function
4. Collects assistant messages, executes tools via `runTools()` (from `toolOrchestration.ts`)
5. Handles auto-compaction when context gets too large
6. Handles `max_output_tokens` recovery
7. Runs `stopHooks` to check if the agent should stop
8. Continues the loop if there are pending tool results to feed back

---

## 3. Tool System

### Tool Interface (`Tool.ts`)

The `Tool<Input, Output, Progress>` type is a comprehensive interface with ~40 methods including:

- **`call()`**: Execute the tool
- **`checkPermissions()`**: Tool-specific permission logic
- **`validateInput()`**: Input validation
- **`prompt()`**: System prompt contribution (tool instructions)
- **`description()`**: Dynamic description generation
- **`isConcurrencySafe()`**: Whether it can run in parallel
- **`isReadOnly()`**: Whether it writes
- **`isDestructive()`**: Whether it's irreversible
- **`shouldDefer`**: Whether it uses lazy loading via `ToolSearch`
- **`maxResultSizeChars`**: Threshold before results go to disk
- Rendering methods: `renderToolUseMessage`, `renderToolResultMessage`, `renderToolUseProgressMessage`, etc.

`buildTool()` fills safe defaults: `isEnabled=true`, `isConcurrencySafe=false`, `isReadOnly=false`, `checkPermissions=allow`.

### Tool Registration (`tools.ts`)

`getAllBaseTools()` returns the COMPLETE tool list. `getTools()` filters by:

1. Simple mode (`CLAUDE_CODE_SIMPLE`): only Bash, Read, Edit
2. Deny rules from permission context
3. REPL mode: hides primitive tools wrapped by REPL
4. `isEnabled()` per tool

`assembleToolPool()` merges built-in tools + MCP tools, sorting each partition for prompt-cache stability.

### Complete Tool Inventory (~50+ tools)

**Core**: AgentTool, BashTool, FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool, NotebookEditTool, WebFetchTool, WebSearchTool, SkillTool, TodoWriteTool

**Agent Management**: TaskStopTool, TaskOutputTool, SendMessageTool, TeamCreateTool, TeamDeleteTool

**Task Management (v2)**: TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool

**Plan Mode**: EnterPlanModeTool, ExitPlanModeV2Tool

**Worktree Isolation**: EnterWorktreeTool, ExitWorktreeTool

**MCP**: ListMcpResourcesTool, ReadMcpResourceTool, MCPTool, McpAuthTool

**Conditional/Feature-Gated**: REPLTool (ant-only), SleepTool (PROACTIVE/KAIROS), CronCreateTool/CronDeleteTool/CronListTool (AGENT_TRIGGERS), RemoteTriggerTool, MonitorTool, WorkflowTool, WebBrowserTool, SnipTool, ListPeersTool, PushNotificationTool, SubscribePRTool, TerminalCaptureTool, CtxInspectTool, OverflowTestTool, VerifyPlanExecutionTool, ConfigTool (ant), TungstenTool (ant), SuggestBackgroundPRTool (ant), PowerShellTool

**Infrastructure**: BriefTool, ToolSearchTool, SyntheticOutputTool, AskUserQuestionTool, LSPTool, TestingPermissionTool

### Tool Execution (`toolOrchestration.ts`)

`runTools()` partitions tool_use blocks into batches:

- **Concurrent batch**: consecutive `isConcurrencySafe=true` tools run in parallel (up to `MAX_TOOL_USE_CONCURRENCY=10`)
- **Serial batch**: `isConcurrencySafe=false` tools run one at a time
- Context modifiers from non-concurrent-safe tools are applied sequentially

---

## 4. System Prompt Assembly

### Priority Chain (`utils/systemPrompt.ts` -> `buildEffectiveSystemPrompt()`)

1. **Override system prompt** (e.g., loop mode) - REPLACES everything
2. **Coordinator system prompt** (`getCoordinatorSystemPrompt()`) - when coordinator mode is active
3. **Agent system prompt** (`agentDefinition.getSystemPrompt()`) - REPLACES default (or APPENDS in proactive mode)
4. **Custom system prompt** (`--system-prompt` CLI flag) - REPLACES default
5. **Default system prompt** (`getSystemPrompt()` from `constants/prompts.ts`)
6. **Append system prompt** (`--append-system-prompt`) - always added at end

### Default System Prompt Sections (`constants/prompts.ts` -> `getSystemPrompt()`)

Static sections (cacheable):

- Intro section ("You are Claude Code, Anthropic's official CLI for Claude")
- System section (shell, platform, OS info)
- Doing tasks section (coding instructions)
- Actions section (available actions)
- Using your tools section (tool usage patterns)
- Tone and style section
- Output efficiency section

Dynamic sections (registry-managed, cached per-session via `systemPromptSection()`):

- `session_guidance`: session-specific guidance, skill instructions
- `memory`: CLAUDE.md content from `loadMemoryPrompt()`
- `env_info_simple`: environment info (model, working directories)
- `language`: user language preference
- `output_style`: custom output style config
- `mcp_instructions`: MCP server instructions (or via delta attachment)
- `scratchpad`: scratchpad directory instructions
- `frc`: function result clearing section (model-specific)
- `summarize_tool_results`: instructions for summarizing tool output
- `token_budget`: token budget instructions (feature-gated)
- `brief`: brief mode instructions (KAIROS feature)

For subagents, `getAgentSystemPrompt()` in `runAgent.ts` calls `agentDefinition.getSystemPrompt()` and then `enhanceSystemPromptWithEnvDetails()` to add environment info.

### Context Injection (`context.ts`, `QueryEngine.ts`)

- **userContext**: `getUserContext()` returns `{ claudeMd, ... }` - CLAUDE.md content, git status
- **systemContext**: `getSystemContext()` returns environment details
- **coordinatorUserContext**: `getCoordinatorUserContext()` adds worker tool listings for coordinator mode
- These are prepended/appended to the system prompt at API call time via `prependUserContext()` and `appendSystemContext()`

---

## 5. Subagent/Delegation Model

### InProcessTeammateTask (Swarm Model)

- Runs in the SAME process using `AsyncLocalStorage` for isolation
- Has team-aware identity: `agentName@teamName`
- Supports plan mode approval: `awaitingPlanApproval` state, approval flows via `SendMessageTool`
- Can be idle or active
- Messages capped at 50 for UI display (`TEAMMATE_MESSAGES_UI_CAP`)
- User can inject messages into teammate transcript (`injectUserMessageToTeammate`)
- Has its own independent permission mode (`permissionMode`)
- Spawned via `spawnTeammate()` from `AgentTool.call()` when `team_name` + `name` are provided

### LocalAgentTask (Standard Subagent)

- Spawns a SEPARATE conversation loop via `runAgent()` -> `query()`
- Foreground mode: blocks parent turn, can be backgrounded mid-execution
- Background mode: runs detached, notifies via `<task-notification>` XML
- Auto-background timer: configurable (default 120s when enabled)
- Progress tracking: tool use count, token count, recent activities, periodic AI summarization
- Can queue pending messages via `SendMessageTool` (drained at tool-round boundaries)
- Supports worktree isolation (`isolation: "worktree"`)

### RemoteAgentTask (Cloud Execution)

- Teleports work to Claude Cloud Run (CCR)
- Polls remote session events every 1 second
- Handles multiple remote task types: `remote-agent`, `ultraplan`, `ultrareview`, `autofix-pr`, `background-pr`
- Persists metadata to disk for `--resume` reconnection
- Stable idle detection (5 consecutive idle polls) before declaring completion
- Review content extraction from hook stdout or assistant text

### DreamTask (Memory Consolidation)

- Background fork that reviews past session transcripts
- Phases: `starting` -> `updating` (when first Edit/Write detected)
- Tracks touched files, keeps last 30 turns
- On kill, rolls back consolidation lock mtime so next session can retry
- No model-facing notification (UI-only surfacing)

### Fork Subagent (`forkSubagent.ts`)

- When `subagent_type` is omitted and fork gate is on
- Inherits parent's EXACT system prompt for prompt cache sharing
- Gets parent's full conversation via `buildForkedMessages()`
- Uses parent's exact tool set (`useExactTools: true`)
- Recursive fork guard prevents fork-within-fork
- Short directive-style prompts (context already inherited)

---

## 6. Permission Model

### Permission Modes (`types/permissions.ts`)

| Mode                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `default`           | Standard interactive prompting                                     |
| `acceptEdits`       | Auto-accept file edits                                             |
| `bypassPermissions` | Skip all permission checks                                         |
| `dontAsk`           | Auto-deny everything that would prompt                             |
| `plan`              | Plan mode (read-only until approved)                               |
| `auto`              | Classifier-based auto-approval (feature-gated)                     |
| `bubble`            | Internal mode for teammates that bubble prompts to parent terminal |

### Permission Flow

1. **Tool.validateInput()**: Validates input shape and constraints
2. **Tool.checkPermissions()**: Tool-specific permission logic (returns allow/deny/ask/passthrough)
3. **General permission system** (`utils/permissions/permissions.ts`): Evaluates rules from multiple sources
4. **Rule sources** (in priority order): `policySettings` > `cliArg` > `userSettings` > `projectSettings` > `localSettings` > `flagSettings` > `session` > `command`
5. **Rule behaviors**: `allow`, `deny`, `ask` with tool name + optional `ruleContent` pattern matching
6. **Classifier** (auto mode): AI classifier evaluates whether tool use is safe

### Agent Permission Scoping

- `agentDefinition.permissionMode` overrides default (unless parent is `bypassPermissions`/`acceptEdits`/`auto`)
- Async agents get `shouldAvoidPermissionPrompts: true` (auto-deny prompts)
- `bubble` mode agents always show prompts (bubble to parent terminal)
- `allowedTools` parameter replaces ALL session allow rules (prevents parent approval leakage)
- `ToolPermissionContext` carries `alwaysAllowRules`, `alwaysDenyRules`, `alwaysAskRules` organized by source

### Tool Restrictions for Agents (`constants/tools.ts`)

- **ALL_AGENT_DISALLOWED_TOOLS**: `TaskOutput`, `ExitPlanMode`, `EnterPlanMode`, `AskUserQuestion`, `TaskStop`, `Workflow` (ant users can use `Agent` tool recursively)
- **ASYNC_AGENT_ALLOWED_TOOLS**: `FileRead`, `WebSearch`, `TodoWrite`, `Grep`, `WebFetch`, `Glob`, shell tools, `FileEdit`, `FileWrite`, `NotebookEdit`, `Skill`, `SyntheticOutput`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`
- **IN_PROCESS_TEAMMATE_ALLOWED_TOOLS**: Additional `TaskCreate/Get/List/Update`, `SendMessage`, cron tools
- **COORDINATOR_MODE_ALLOWED_TOOLS**: Only `Agent`, `TaskStop`, `SendMessage`, `SyntheticOutput`

---

## 7. Multi-Step / Streaming

### The Query Loop (`query.ts`)

The `query()` async generator implements the multi-turn agentic loop:

1. **Initialize state**: messages, autoCompactTracking, turnCount
2. **Start memory prefetch**: `startRelevantMemoryPrefetch()` runs while model streams
3. **Each iteration**:
   a. Build query chain tracking (chainId, depth)
   b. Get attachment messages (memory files, agent listings, skill discovery)
   c. Call `claude()` API with streaming
   d. Yield stream events and assistant messages
   e. If assistant message has `tool_use` blocks: run tools via `runTools()` (concurrent-safe partitioning)
   f. Yield tool result messages
   g. If `stop_reason === 'end_turn'` and no pending tool results: **stop**
   h. If `stop_reason === 'tool_use'`: **continue** (feed tool results back)
   i. Handle auto-compaction if context too large
   j. Handle max_output_tokens recovery (up to 3 retries)
   k. Run stop hooks (PostToolUse, pre-compact, post-compact)
   l. Increment turn count, check maxTurns limit
4. **Tool budget**: Optional `task_budget` parameter limits total output tokens

### StreamingToolExecutor

Handles streaming tool execution where tools start running as soon as their input is fully streamed, even before the full assistant message is complete.

### Notification System

Background tasks notify the model via `enqueuePendingNotification()`:

- Notifications are formatted as `<task-notification>` XML
- Delivered as user-role messages between turns
- Contain: task-id, status, summary, result text, token usage, duration
- Priority: `next` (immediate) or `later` (batch)
- Atomic `notified` flag prevents duplicate notifications
- `abortSpeculation()` called when background state changes to invalidate pre-computed responses

### Agent Resumption (`resumeAgent.ts`)

Agents can be resumed via `SendMessageTool`:

- Running agents: message queued via `queuePendingMessage()`, drained at tool-round boundaries
- Stopped agents: auto-resumed from disk transcript via `resumeAgentBackground()`
- Evicted agents: resumed from sidechain transcript on disk
- The `agentNameRegistry` maps human-readable names to agent IDs for routing

---

---

## Comparative Analysis: Claude Code vs Gentle-AI vs LightCode

### Architectural Philosophy

| System          | Philosophy                                                                                                                                                               | Runtime                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Claude Code** | Heavy agent runtime — infrastructure for orchestrating multiple agents in parallel (coordinator, teammates, fork, remote, dream). Intelligence lives in TypeScript code. | ~50+ tools, 7 task types, 7 permission modes         |
| **Gentle-AI**   | Instruction framework — pure markdown prompts injected into ANY agent. No runtime of its own. Intelligence lives in PROMPTS, not code.                                   | Skills on-demand, word-budgeted phases, SDD workflow |
| **LightCode**   | Hybrid — Effect-based runtime (OpenCode fork) with token-efficient innovations (deferred tools, unified prompt, multi-step streaming).                                   | ~17 tools (7 core + deferred), 6 agents              |

### Performance by Dimension

| Dimension                  | Claude Code                                                                                            | Gentle-AI                                                                                                  | LightCode                                                      | Winner                |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| **Agent parallelism**      | 7 task types, coordinator mode, swarm, fork subagent                                                   | Single `task` tool, sequential                                                                             | Single `task` tool, sequential                                 | Claude Code           |
| **Token efficiency**       | ~50+ tools always loaded, massive system prompt                                                        | Skills on-demand, word budgets (450-800 words per phase)                                                   | 7 core tools, deferred loading, 37-line unified prompt         | LightCode + Gentle-AI |
| **Output quality**         | Generic "do coding tasks" prompt                                                                       | SDD workflow (propose→spec→design→tasks→apply→verify→archive), Strict TDD, Judgment Day adversarial review | Unified prompt, deferred tools                                 | Gentle-AI             |
| **Cache hit rate**         | Fork subagent inherits parent prompt = max cache reuse. `assembleToolPool()` sorts for cache stability | Each skill injected dynamically = cache invalidation                                                       | Multi-step streaming preserves cache within steps              | Claude Code           |
| **Cross-session memory**   | DreamTask consolidates CLAUDE.md automatically in background                                           | Engram protocol: proactive saves + session summaries + search                                              | Inherits from Gentle-AI via Engram MCP                         | Tie                   |
| **Task scalability**       | Coordinator + N workers + remote CCR + worktree isolation                                              | One agent with sequential subagents                                                                        | One agent with sequential subagents                            | Claude Code           |
| **Code consistency**       | Depends entirely on the model                                                                          | SDD specs + verify gate = quality enforcement                                                              | Depends on model + instructions                                | Gentle-AI             |
| **Cost optimization**      | One model for everything (or manual override)                                                          | Per-phase model routing: Opus for design, Sonnet for apply, Haiku for archive                              | Single model (inherits from OpenCode)                          | Gentle-AI             |
| **Review quality**         | No built-in review mechanism                                                                           | Judgment Day: 2 blind judges in parallel, synthesis, re-judge until convergence                            | No built-in review                                             | Gentle-AI             |
| **Streaming perf**         | Each step is a separate API call                                                                       | N/A (no runtime)                                                                                           | `stopWhen: stepCountIs(5)` — 5 steps without per-step overhead | LightCode             |
| **LSP integration**        | Not integrated in tool pipeline                                                                        | N/A                                                                                                        | Batched diagnostics at end-of-step, not per-edit               | LightCode             |
| **Permission granularity** | 7 modes, classifier-based auto-approval, 8 rule sources                                                | Configured per-agent via overlays                                                                          | Effect-based permission service, pattern matching              | Claude Code           |
| **Tool concurrency**       | `isConcurrencySafe` partitioning, up to 10 parallel                                                    | N/A                                                                                                        | No explicit partitioning                                       | Claude Code           |

### Verdict

**For LARGE tasks** (20+ file refactors, multi-repo): **Claude Code wins** — coordinator mode + fork cache sharing + concurrent tools + remote execution.

**For OUTPUT quality** (correct, tested, documented code): **Gentle-AI wins** — SDD workflow + Strict TDD + Judgment Day + word budgets prevent model rambling.

**For COST efficiency** (tokens per task): **Gentle-AI + LightCode win** — per-phase model routing + deferred tools + unified prompt + multi-step streaming.

**For LATENCY** (time to first token, step transitions): **LightCode wins** — multi-step streaming eliminates per-step API overhead, batched LSP avoids inline diagnostic delays.

### What LightCode Already Has From Each

**From Claude Code (via OpenCode fork):**

- Effect-based service architecture
- Multi-step streaming (`stopWhen: stepCountIs(5)`)
- Agent system (build, plan, general, explore, compaction, title, summary, dream)
- Plugin system with hooks
- MCP integration
- ✅ Fork subagent (prompt cache sharing with parent)
- ✅ Tool concurrency safety (serializer for unsafe tools)
- ✅ Prompt cache stability sorting (alphabetical tool order)
- ✅ AutoDream + Engram (background memory consolidation)

**From Gentle-AI:**

- Skills system (SKILL.md files loaded via `skill` tool)
- Engram persistent memory protocol
- Persona system (Gentleman Architect)
- Deferred tools concept (expanded with hybrid + native modes)

### Features Worth Porting

#### From Claude Code (high impact)

| Feature                            | Impact                                                   | Complexity | Status                                                        |
| ---------------------------------- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| **Fork Subagent**                  | Massive prompt cache savings for subagents               | Medium     | ✅ IMPLEMENTED — parent stashes context, child skips rebuild  |
| **Concurrent tool partitioning**   | Safer multi-tool execution                               | Low        | ✅ IMPLEMENTED — unsafe tools serialized, safe tools parallel |
| **StreamingToolExecutor**          | Lower latency — tools start before full message streamed | Medium     | Not yet — AI SDK handles tool parallelism internally          |
| **Prompt cache stability sorting** | Better cache hit rate                                    | Low        | ✅ IMPLEMENTED — alphabetical sort before streamText()        |
| **DreamTask**                      | Auto-consolidate memory between sessions                 | Medium     | ✅ IMPLEMENTED — AutoDream + Engram as backend                |

#### From Gentle-AI (high impact)

| Feature                       | Impact                               | Complexity | Notes                                                                                  |
| ----------------------------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| **SDD Workflow**              | Structured development quality       | Low        | 10 SKILL.md files + orchestrator prompt + 9 commands + 2 overlay JSONs. Pure markdown. |
| **Per-phase model routing**   | Cost optimization                    | Medium     | Config mapping: phase → provider/model. Orchestrator assigns models to sub-agents.     |
| **Judgment Day**              | Adversarial code review quality      | Low        | 1 SKILL.md (350 lines). Two blind judges, synthesis, convergence.                      |
| **Strict TDD Module**         | Test quality enforcement             | Low        | 1 markdown (364 lines). RED→GREEN→TRIANGULATE→REFACTOR.                                |
| **Skill Registry + Resolver** | Smart skill injection for sub-agents | Low        | 2 markdown files. Auto-detect relevant skills by context.                              |

### Agent Comparison Table

| LightCode Agent | Claude Code Equivalent                     | Gentle-AI Equivalent               | Notes                                                   |
| --------------- | ------------------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| `build`         | Main session (default)                     | N/A (runtime-agnostic)             | LightCode's default primary agent                       |
| `plan`          | Plan mode (`EnterPlanMode`/`ExitPlanMode`) | SDD Explore + SDD Propose          | Claude Code has dedicated plan mode tools               |
| `general`       | `general-purpose` agent                    | SDD Apply (via orchestrator)       | Both are general-purpose subagents                      |
| `explore`       | `Explore` agent                            | SDD Explore skill                  | Same concept: read-only codebase research               |
| `compaction`    | Auto-compaction in `query.ts`              | N/A                                | Both handle context overflow                            |
| `title`         | Title generation (inline)                  | N/A                                | LightCode uses dedicated agent, Claude Code does inline |
| `summary`       | Summary generation (inline)                | Session summary in Engram protocol | Different mechanisms, same goal                         |
| `fork` (auto)   | `fork` subagent                            | N/A                                | ✅ Auto-fork when same model — shares parent context    |
| N/A             | Coordinator + workers                      | SDD Orchestrator                   | **Missing in LightCode** — parallel task execution      |
| `dream`         | `dream` (DreamTask)                        | Engram proactive saves             | ✅ AutoDream + Engram (4-phase consolidation)           |
| N/A             | `in_process_teammate`                      | N/A                                | **Missing** — swarm model for large tasks               |
| N/A             | `remote_agent` (CCR)                       | N/A                                | **Missing** — cloud execution delegation                |
| N/A             | N/A                                        | SDD Verify agent                   | **Missing in Claude Code** — quality gate               |
| N/A             | N/A                                        | Judgment Day judges                | **Missing in Claude Code** — adversarial review         |
