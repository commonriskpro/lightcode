# Complete Architecture Analysis: Claude Code CLI Source (`/Users/saturno/Downloads/src`)

This is the **source code of Claude Code** -- Anthropic's CLI-based AI coding assistant. It is a TypeScript/Bun project using **Ink** (React-based terminal UI framework) for its TUI, and the **Anthropic SDK** for LLM communication.

---

## 1. TOP-LEVEL DIRECTORY STRUCTURE

```
src/
  assistant/          - Kairos assistant mode (long-lived session management)
  bootstrap/          - Global mutable state singleton (session, cost, telemetry)
  bridge/             - Remote Control bridge (mobile/desktop ↔ CLI tunneling)
  buddy/              - Companion sprite/mascot feature (experimental)
  cli/                - CLI transport layer (print mode, structured I/O, SSE, WebSocket)
  commands/           - Slash command implementations (/help, /model, /compact, etc.)
  components/         - Ink (React TUI) components (dialogs, messages, permissions, etc.)
  constants/          - Shared constants (API limits, prompts, system values, tools)
  context/            - React contexts (mailbox, modals, notifications, stats, voice)
  coordinator/        - Coordinator mode (multi-agent orchestration)
  entrypoints/        - Application entrypoints (CLI, MCP server, SDK types)
  hooks/              - React hooks (permissions, notifications, tool permissions, UI state)
  ink/                - Forked/vendored Ink framework (terminal rendering engine)
  keybindings/        - Keybinding system (schema, parser, resolver, default bindings)
  memdir/             - Memory directory system (CLAUDE.md, team memory, memory scanning)
  migrations/         - Data migrations (model renames, settings format changes)
  moreright/          - "More to the right" horizontal overflow indicator hook
  native-ts/          - Native TypeScript implementations (color-diff, file-index, yoga-layout)
  outputStyles/       - Output style loader (custom output format loading)
  plugins/            - Plugin system (builtin plugins, bundled plugin init)
  query/              - Query loop internals (config, deps, stop hooks, token budget)
  remote/             - Remote session management (SDK adapter, WebSocket, permissions)
  schemas/            - Zod schemas for hooks
  screens/            - Top-level screen components (REPL, Doctor, ResumeConversation)
  server/             - Direct connect server (cc:// URL protocol handling)
  services/           - Core services (API, MCP, analytics, compact, LSP, OAuth, etc.)
  skills/             - Skills system (bundled skills, skill directory loading, MCP skills)
  state/              - Application state store (AppState, selectors, store implementation)
  tasks/              - Background task implementations (shell, agent, remote, workflow, dream)
  tools/              - Tool implementations (Bash, FileEdit, Grep, Agent, MCP, etc.)
  types/              - Shared TypeScript types (command, hooks, ids, logs, message, permissions, plugin)
  upstreamproxy/      - Upstream HTTP proxy relay
  utils/              - Massive utility library (~329 files covering everything)
  vim/                - Vim mode implementation (motions, operators, text objects, transitions)
  voice/              - Voice mode feature flag
```

---

## 2. ROOT-LEVEL FILES

| File                        | Purpose                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands.ts`               | **Command registry**. Imports ALL slash commands, wires feature-flagged commands via `bun:bundle` `feature()`, exports `getCommands()`, `findCommand()`, `REMOTE_SAFE_COMMANDS`, `BRIDGE_SAFE_COMMANDS`. Central command resolution.              |
| `context.ts`                | **System/user context builder**. Builds git status context, CLAUDE.md user context, system prompt injection. Memoized per conversation.                                                                                                           |
| `cost-tracker.ts`           | **Session cost tracking**. Accumulates token usage per model, formats cost display, saves/restores costs for session resume.                                                                                                                      |
| `costHook.ts`               | React hook (`useCostSummary`) that prints cost summary and saves on process exit.                                                                                                                                                                 |
| `dialogLaunchers.tsx`       | Lazy-import launchers for dialogs (resume chooser, teleport, assistant, invalid settings). Avoids circular deps.                                                                                                                                  |
| `history.ts`                | **Prompt history system**. JSONL-based history with paste content resolution, session-scoped dedup, async flush with file locking.                                                                                                                |
| `ink.ts`                    | **Ink framework re-export barrel**. Wraps all renders with ThemeProvider. Re-exports Box, Text, Button, hooks, events, etc.                                                                                                                       |
| `interactiveHelpers.tsx`    | Setup screens, exit handlers, render context creation for interactive mode.                                                                                                                                                                       |
| `main.tsx`                  | **Main entrypoint** (~1000+ lines). Commander CLI setup, flag parsing, migrations, GrowthBook init, MCP setup, REPL launch, print mode, direct connect, SSH mode, assistant mode. The application backbone.                                       |
| `projectOnboardingState.ts` | Tracks whether user has completed project onboarding (CLAUDE.md creation, workspace setup).                                                                                                                                                       |
| `query.ts`                  | **Core query loop**. The agentic turn loop: streams API responses, runs tools (parallel via StreamingToolExecutor), handles auto-compact, reactive compact, context collapse, max_output_tokens recovery, snip, stop hooks.                       |
| `QueryEngine.ts`            | **Headless/SDK query engine**. Wraps `query()` for non-interactive use. Manages session state, messages, file cache, permission denials, usage tracking.                                                                                          |
| `replLauncher.tsx`          | Launches the interactive REPL screen (`screens/REPL.tsx`).                                                                                                                                                                                        |
| `setup.ts`                  | **Session setup**. Node version check, session ID, worktree creation, tmux, hooks snapshot, plugin prefetch, UDS messaging, session memory init.                                                                                                  |
| `Task.ts`                   | **Task type definitions**. `TaskType` (local_bash, local_agent, remote_agent, in_process_teammate, dream, etc.), `TaskStatus`, `TaskStateBase`, `generateTaskId()`.                                                                               |
| `tasks.ts`                  | **Task registry**. `getAllTasks()`, `getTaskByType()`. Feature-gated workflow/monitor tasks.                                                                                                                                                      |
| `Tool.ts`                   | **Core Tool type definition** (~792 lines). Defines `Tool<Input, Output, Progress>`, `ToolUseContext`, `ToolPermissionContext`, `ToolResult`, `buildTool()` factory, `Tools` collection type. Every tool in the system implements this interface. |
| `tools.ts`                  | **Tool registry**. `getAllBaseTools()`, `getTools()`, `assembleToolPool()`, `filterToolsByDenyRules()`. Feature-flagged tool registration with conditional imports.                                                                               |

---

## 3. KEY MODULES IN DETAIL

### 3.1 Entrypoints (`entrypoints/`)

| File                    | Description                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `cli.tsx`               | CLI-specific entrypoint setup                                                                    |
| `init.ts`               | `init()` function: config enablement, env variable application, GrowthBook pre-init              |
| `mcp.ts`                | MCP server entrypoint (for `claude mcp serve`)                                                   |
| `agentSdkTypes.ts`      | SDK message types (`SDKMessage`, `SDKStatus`, `PermissionMode`, `ModelUsage`, `HookEvent`, etc.) |
| `sandboxTypes.ts`       | Sandbox/bubblewrap types                                                                         |
| `sdk/controlSchemas.ts` | Zod schemas for SDK control messages                                                             |
| `sdk/coreSchemas.ts`    | Zod schemas for SDK core message types                                                           |
| `sdk/coreTypes.ts`      | TypeScript types inferred from core schemas                                                      |

### 3.2 State Management (`state/`, `bootstrap/`)

**`bootstrap/state.ts`** (~1758 lines): The **global mutable state singleton**. Contains:

- Session ID, CWD, project root
- Cost/token tracking (totalCostUSD, modelUsage)
- Telemetry meters/counters (OpenTelemetry)
- Feature flags/settings state
- Model string resolution
- Registered hooks (SDK callbacks, plugin hooks)
- Channel/plugin/permission configuration
- Turn-level metric tracking

**`state/store.ts`**: Minimal reactive store (`createStore<T>` with `getState/setState/subscribe`).

**`state/AppStateStore.ts`** (~569 lines): The **AppState type** -- the entire runtime state shape:

- `toolPermissionContext` (permission mode, allow/deny rules)
- `mcp` (clients, tools, commands, resources, elicitations)
- `tasks` (background task states)
- `messages`, `speculation`, `fileHistory`, `attribution`
- `agentDefinitions`, `plugins`, `denialTracking`
- `settings`, `mainLoopModel`, `effortValue`, `advisorModel`
- `fastMode`, `verbose`, `isBriefOnly`
- Various UI state (expandedView, notifications, footer items)

**`state/selectors.ts`**: State selectors for derived values.

**`state/onChangeAppState.ts`**: Side-effect handler on state changes.

**`state/teammateViewHelpers.ts`**: Helpers for teammate view navigation.

### 3.3 Tool System (`tools/`, `Tool.ts`, `tools.ts`)

**43 tool directories**, each following the pattern:

```
ToolName/
  ToolName.ts/.tsx   - Main tool implementation (implements Tool interface via buildTool())
  prompt.ts          - System prompt text for the tool
  constants.ts       - Tool name, feature flag constants
  UI.tsx             - Ink rendering components for tool use/result display
  utils.ts           - Tool-specific helpers
```

**Core tools (always available):**
| Tool | Purpose |
|------|---------|
| `AgentTool` | Spawns sub-agents (the coordinator/worker pattern). Loads agent definitions, runs agents with scoped contexts, resume support. |
| `BashTool` | Shell command execution. Includes sandbox support, sed validation, path validation, destructive command warnings, permission matchers. |
| `FileEditTool` | Search-and-replace file editing with diff display. |
| `FileReadTool` | Read files/images with token limits. |
| `FileWriteTool` | Write entire file contents. |
| `GlobTool` | File pattern matching/search. |
| `GrepTool` | Content search via ripgrep. |
| `WebFetchTool` | HTTP URL fetching with pre-approved URL list. |
| `WebSearchTool` | Web search via API. |
| `SkillTool` | Invokes skills (prompt-based commands the model can call). |
| `TodoWriteTool` | Todo/task list management. |
| `NotebookEditTool` | Jupyter notebook cell editing. |
| `EnterPlanModeTool` / `ExitPlanModeV2Tool` | Plan mode entry/exit. |
| `AskUserQuestionTool` | Interactive question to the user. |
| `TaskStopTool` | Stop background tasks. |
| `TaskOutputTool` | Read background task output. |
| `ToolSearchTool` | Search for deferred tools by keyword. |
| `BriefTool` | Generate brief summaries with attachments/uploads. |
| `SendMessageTool` | Send messages between agents/teammates. |
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | MCP resource listing/reading. |
| `ConfigTool` | Runtime config modification (ant-only). |

**Feature-gated tools:**
| Tool | Feature Flag | Purpose |
|------|-------------|---------|
| `REPLTool` | `USER_TYPE=ant` | REPL mode wrapping primitive tools in a VM |
| `SuggestBackgroundPRTool` | `USER_TYPE=ant` | Suggest background PR creation |
| `TungstenTool` | `USER_TYPE=ant` | Verification/testing tool |
| `SleepTool` | `PROACTIVE`/`KAIROS` | Sleep for proactive agent mode |
| `CronCreate/Delete/ListTool` | `AGENT_TRIGGERS` | Cron job scheduling |
| `RemoteTriggerTool` | `AGENT_TRIGGERS_REMOTE` | Remote trigger management |
| `MonitorTool` | `MONITOR_TOOL` | MCP server monitoring |
| `SendUserFileTool` | `KAIROS` | Send files to user |
| `PushNotificationTool` | `KAIROS`/`KAIROS_PUSH_NOTIFICATION` | Push notifications |
| `SubscribePRTool` | `KAIROS_GITHUB_WEBHOOKS` | PR subscription |
| `EnterWorktreeTool`/`ExitWorktreeTool` | Worktree mode enabled | Git worktree management |
| `TeamCreateTool`/`TeamDeleteTool` | Agent swarms enabled | Team/swarm management |
| `PowerShellTool` | Windows + enabled | PowerShell execution |
| `SnipTool` | `HISTORY_SNIP` | History snipping |
| `ListPeersTool` | `UDS_INBOX` | List peer sessions |
| `WorkflowTool` | `WORKFLOW_SCRIPTS` | Workflow script execution |
| `OverflowTestTool` | `OVERFLOW_TEST_TOOL` | Testing tool |
| `CtxInspectTool` | `CONTEXT_COLLAPSE` | Context inspection |
| `TerminalCaptureTool` | `TERMINAL_PANEL` | Terminal screenshot capture |
| `WebBrowserTool` | `WEB_BROWSER_TOOL` | Web browser automation |
| `VerifyPlanExecutionTool` | `CLAUDE_CODE_VERIFY_PLAN` | Plan verification |
| `SyntheticOutputTool` | JSON schema mode | Structured output enforcement |
| `TaskCreate/Get/Update/ListTool` | Todo V2 enabled | Task management tools |
| `LSPTool` | `ENABLE_LSP_TOOL` | Language Server Protocol integration |
| `McpAuthTool` | (internal) | MCP authentication |

**Tool registration flow:**

1. `getAllBaseTools()` in `tools.ts` assembles the complete list
2. `getTools(permissionContext)` filters by deny rules and `isEnabled()`
3. `assembleToolPool(permissionContext, mcpTools)` merges built-in + MCP tools
4. `filterToolsByDenyRules()` applies blanket deny rules
5. REPL mode hides primitive tools when REPL is enabled

### 3.4 Command System (`commands/`, `commands.ts`)

**~80+ slash commands**, each in a directory with:

```
command-name/
  command-name.ts/.tsx  - Implementation
  index.ts              - Barrel export with Command type
```

Commands implement the `Command` type (from `types/command.ts`):

- `type: 'local' | 'local-jsx' | 'prompt'`
- `name`, `description`, `aliases`
- `source: 'builtin' | 'plugin' | 'bundled' | 'mcp'`
- `availability?: ('claude-ai' | 'console')[]`

**Command categories:**

| Category      | Commands                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| Session       | `/session`, `/resume`, `/rename`, `/clear`, `/compact`, `/export`, `/rewind`   |
| Model/Config  | `/model`, `/config`, `/effort`, `/fast`, `/output-style`, `/theme`, `/color`   |
| Navigation    | `/help`, `/status`, `/cost`, `/usage`, `/stats`, `/files`, `/diff`, `/context` |
| Tools/MCP     | `/mcp`, `/tools` (via plugin), `/hooks`, `/permissions`                        |
| Agent/Skills  | `/agents`, `/skills`, `/plan`, `/tasks`                                        |
| Dev/Internal  | `/doctor`, `/heapdump`, `/version`, `/init`, `/init-verifiers`                 |
| Plugin        | `/plugin` (full marketplace UI), `/reload-plugins`                             |
| External      | `/install-github-app`, `/install-slack-app`, `/chrome`, `/desktop`, `/mobile`  |
| Git           | `/commit`, `/commit-push-pr`, `/review`, `/branch`, `/pr_comments`             |
| Memory        | `/memory`, `/stickers`                                                         |
| Auth          | `/login`, `/logout`, `/upgrade`, `/passes`                                     |
| Feature-gated | `/voice`, `/bridge`, `/vim`, `/keybindings`, `/sandbox-toggle`                 |

**Feature-gated commands** (via `bun:bundle` `feature()`):

- `PROACTIVE` / `KAIROS`: `/proactive`, `/brief`, `/assistant`
- `BRIDGE_MODE`: `/bridge`
- `VOICE_MODE`: `/voice`
- `HISTORY_SNIP`: `/force-snip`
- `WORKFLOW_SCRIPTS`: `/workflows`
- `CCR_REMOTE_SETUP`: `/remote-setup`
- `EXPERIMENTAL_SKILL_SEARCH`: skill index cache clearing
- `KAIROS_GITHUB_WEBHOOKS`: `/subscribe-pr`
- `ULTRAPLAN`: `/ultraplan`
- `TORCH`: `/torch`
- `UDS_INBOX`: `/peers`
- `FORK_SUBAGENT`: `/fork`
- `BUDDY`: `/buddy`

### 3.5 Services (`services/`)

| Service                  | Files                                                                                                                                                                                                                              | Purpose                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/`                   | 14 files                                                                                                                                                                                                                           | API client (`claude.ts`), retry logic, error handling, file API, referral, usage, session ingress, bootstrap data, ultrareview quota          |
| `analytics/`             | 8 files                                                                                                                                                                                                                            | GrowthBook feature flags, Datadog, first-party event logging, analytics sink, killswitch                                                      |
| `mcp/`                   | 20+ files                                                                                                                                                                                                                          | MCP client management, server config parsing, auth (OAuth/XAA), elicitation, channel allowlists/permissions, normalization, official registry |
| `compact/`               | 10 files                                                                                                                                                                                                                           | Auto-compact, reactive compact, micro-compact, session memory compact, API-based compact, grouping, prompts                                   |
| `lsp/`                   | 7 files                                                                                                                                                                                                                            | LSP client, server instance management, diagnostic registry, passive feedback                                                                 |
| `oauth/`                 | 5 files                                                                                                                                                                                                                            | OAuth auth code listener, client, crypto, profile                                                                                             |
| `plugins/`               | 3 files                                                                                                                                                                                                                            | Plugin CLI commands, installation manager, operations                                                                                         |
| `policyLimits/`          | 2 files                                                                                                                                                                                                                            | Enterprise policy limit loading/enforcement                                                                                                   |
| `remoteManagedSettings/` | 5 files                                                                                                                                                                                                                            | Remote managed settings sync/cache for enterprise                                                                                             |
| `settingsSync/`          | 2 files                                                                                                                                                                                                                            | Settings upload/download sync                                                                                                                 |
| `teamMemorySync/`        | 5 files                                                                                                                                                                                                                            | Team memory file watching, secret scanning/guarding                                                                                           |
| `SessionMemory/`         | 3 files                                                                                                                                                                                                                            | Session memory hooks, prompts, utilities                                                                                                      |
| `extractMemories/`       | 2 files                                                                                                                                                                                                                            | Memory extraction from conversations                                                                                                          |
| `MagicDocs/`             | 2 files                                                                                                                                                                                                                            | Magic Docs generation (CLAUDE.md auto-creation)                                                                                               |
| `PromptSuggestion/`      | 2 files                                                                                                                                                                                                                            | Prompt suggestion/speculation system                                                                                                          |
| `autoDream/`             | 4 files                                                                                                                                                                                                                            | Auto-dream feature (background memory consolidation)                                                                                          |
| `tips/`                  | 3 files                                                                                                                                                                                                                            | Tip system (tip registry, scheduler, history)                                                                                                 |
| `tools/`                 | 4 files                                                                                                                                                                                                                            | Tool execution engine: `StreamingToolExecutor`, `toolExecution`, `toolHooks`, `toolOrchestration`                                             |
| `toolUseSummary/`        | 1 file                                                                                                                                                                                                                             | Generates tool use summaries                                                                                                                  |
| `AgentSummary/`          | 1 file                                                                                                                                                                                                                             | Agent summary generation                                                                                                                      |
| Standalone               | `voice.ts`, `voiceStreamSTT.ts`, `voiceKeyterms.ts`, `awaySummary.ts`, `diagnosticTracking.ts`, `claudeAiLimits.ts`, `rateLimitMessages.ts`, `notifier.ts`, `preventSleep.ts`, `vcr.ts`, `mockRateLimits.ts`, `tokenEstimation.ts` |

### 3.6 Skills System (`skills/`)

| File                              | Purpose                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `bundledSkills.ts`                | Registry for bundled skills, `getBundledSkills()`, `registerBundledSkill()`                                             |
| `loadSkillsDir.ts`                | Loads skills from `.claude/skills/` directories, dynamic skill discovery, `getSkillDirCommands()`, `getDynamicSkills()` |
| `mcpSkillBuilders.ts`             | Builds skill commands from MCP prompt resources                                                                         |
| `bundled/index.ts`                | Initializes all bundled skills                                                                                          |
| `bundled/batch.ts`                | Batch processing skill                                                                                                  |
| `bundled/claudeApi.ts`            | Claude API skill                                                                                                        |
| `bundled/debug.ts`                | Debug skill                                                                                                             |
| `bundled/keybindings.ts`          | Keybindings skill                                                                                                       |
| `bundled/loop.ts`                 | Loop/iteration skill                                                                                                    |
| `bundled/remember.ts`             | Memory/remember skill                                                                                                   |
| `bundled/scheduleRemoteAgents.ts` | Remote agent scheduling skill                                                                                           |
| `bundled/simplify.ts`             | Simplify skill                                                                                                          |
| `bundled/skillify.ts`             | Skill creation skill                                                                                                    |
| `bundled/stuck.ts`                | "I'm stuck" recovery skill                                                                                              |
| `bundled/updateConfig.ts`         | Config update skill                                                                                                     |
| `bundled/verify.ts`               | Verification skill                                                                                                      |
| `bundled/loremIpsum.ts`           | Lorem ipsum generation                                                                                                  |
| `bundled/claudeInChrome.ts`       | Chrome extension skill                                                                                                  |

### 3.7 Plugin System (`plugins/`)

| File                | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `builtinPlugins.ts` | Built-in plugin registration, `getBuiltinPluginSkillCommands()` |
| `bundled/index.ts`  | `initBuiltinPlugins()` -- registers built-in plugins at startup |

Plugin loading/management is primarily in `utils/plugins/`:

- `pluginLoader.ts`, `installedPluginsManager.ts`, `loadPluginCommands.ts`, `loadPluginHooks.ts`
- `cacheUtils.ts`, `orphanedPluginFilter.ts`, `pluginDirectories.ts`, `managedPlugins.ts`

### 3.8 Keybinding System (`keybindings/`)

| File                    | Purpose                               |
| ----------------------- | ------------------------------------- |
| `defaultBindings.ts`    | Default key bindings                  |
| `loadUserBindings.ts`   | Load user custom bindings from config |
| `match.ts`              | Match key events to bindings          |
| `parser.ts`             | Parse key binding strings             |
| `resolver.ts`           | Resolve key sequences to actions      |
| `schema.ts`             | Zod schema for keybinding config      |
| `shortcutFormat.ts`     | Format shortcuts for display          |
| `reservedShortcuts.ts`  | Reserved/system shortcuts             |
| `template.ts`           | Keybinding config template            |
| `validate.ts`           | Validate keybinding config            |
| `useKeybinding.ts`      | React hook for keybinding consumption |
| `useShortcutDisplay.ts` | React hook for shortcut display       |

### 3.9 Ink Framework (`ink/`)

A **forked/vendored Ink terminal UI framework** (~90 files):

- **Core**: `root.ts`, `ink.tsx`, `reconciler.ts`, `renderer.ts`, `dom.ts`
- **Layout**: `layout/engine.ts`, `layout/geometry.ts`, `layout/node.ts`, `layout/yoga.ts`
- **Rendering**: `output.ts`, `frame.ts`, `render-to-screen.ts`, `render-node-to-output.ts`, `render-border.ts`
- **Components**: `Box.tsx`, `Text.tsx`, `Button.tsx`, `Link.tsx`, `Newline.tsx`, `Spacer.tsx`, `ScrollBox.tsx`, `AlternateScreen.tsx`, `RawAnsi.tsx`, `NoSelect.tsx`
- **Events**: `events/input-event.ts`, `events/click-event.ts`, `events/keyboard-event.ts`, `events/terminal-focus-event.ts`, `events/dispatcher.ts`, `events/emitter.ts`
- **Hooks**: `use-input.ts`, `use-app.ts`, `use-stdin.ts`, `use-interval.ts`, `use-selection.ts`, `use-terminal-viewport.ts`, `use-terminal-focus.ts`, `use-tab-status.ts`, `use-animation-frame.ts`, `use-search-highlight.ts`
- **Terminal I/O**: `termio/ansi.ts`, `termio/csi.ts`, `termio/dec.ts`, `termio/esc.ts`, `termio/osc.ts`, `termio/parser.ts`, `termio/sgr.ts`, `termio/tokenize.ts`
- **Utilities**: `stringWidth.ts`, `measure-text.ts`, `wrap-text.ts`, `colorize.ts`, `bidi.ts`, `optimizer.ts`, `hit-test.ts`, `focus.ts`, `selection.ts`, `tabstops.ts`

### 3.10 Bridge / Remote (`bridge/`, `remote/`)

**Bridge** (~33 files): Remote control bridge for mobile/desktop:

- `bridgeMain.ts` -- Main bridge orchestration
- `replBridge.ts`, `replBridgeHandle.ts`, `replBridgeTransport.ts` -- REPL bridge
- `remoteBridgeCore.ts` -- Core remote bridge logic
- `bridgeMessaging.ts`, `inboundMessages.ts`, `inboundAttachments.ts` -- Message handling
- `bridgePermissionCallbacks.ts` -- Permission delegation
- `bridgeConfig.ts`, `envLessBridgeConfig.ts`, `pollConfig.ts` -- Configuration
- `sessionRunner.ts`, `createSession.ts`, `codeSessionApi.ts` -- Session management
- `jwtUtils.ts`, `trustedDevice.ts`, `workSecret.ts` -- Security
- `bridgeUI.ts`, `bridgeStatusUtil.ts`, `bridgeDebug.ts` -- UI/debug

**Remote** (4 files):

- `RemoteSessionManager.ts` -- Remote session lifecycle management
- `SessionsWebSocket.ts` -- WebSocket transport for remote sessions
- `sdkMessageAdapter.ts` -- SDK message format adaptation
- `remotePermissionBridge.ts` -- Permission bridging for remote

### 3.11 Memory System (`memdir/`)

| File                      | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `memdir.ts`               | Core memory directory operations, `loadMemoryPrompt()` |
| `memoryScan.ts`           | Scan for memory files                                  |
| `memoryTypes.ts`          | Memory file type definitions                           |
| `memoryAge.ts`            | Memory age/freshness calculations                      |
| `findRelevantMemories.ts` | Find contextually relevant memories                    |
| `paths.ts`                | Memory file path resolution                            |
| `teamMemPaths.ts`         | Team memory path resolution                            |
| `teamMemPrompts.ts`       | Team memory prompt generation                          |

### 3.12 Query System (`query/`, `query.ts`, `QueryEngine.ts`)

The query system has a layered architecture:

1. **`query/config.ts`** -- Builds immutable query config from env/statsig/session state
2. **`query/deps.ts`** -- Dependency injection for the query loop (callModel, autocompact, microcompact, uuid)
3. **`query/tokenBudget.ts`** -- Token budget tracking for auto-continue
4. **`query/stopHooks.ts`** -- Stop hook execution after model response
5. **`query.ts`** -- The **main agentic query loop** with:
   - Auto-compact (proactive + reactive)
   - Context collapse
   - Microcompact (API-based cache editing)
   - Snip compaction (history snipping)
   - Tool result budget enforcement
   - Max output tokens recovery (escalation + multi-turn)
   - Streaming tool execution (`StreamingToolExecutor`)
   - Model fallback (on overload)
   - Stop hooks
   - Token budget auto-continue
6. **`QueryEngine.ts`** -- Wraps `query()` for SDK/headless use with session state management

### 3.13 Screens (`screens/`)

| File                     | Purpose                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REPL.tsx`               | **Main interactive REPL screen**. Message list, prompt input, tool permission handling, MCP connection management, hooks, notifications, speculation, virtual scrolling. |
| `Doctor.tsx`             | Diagnostic doctor screen                                                                                                                                                 |
| `ResumeConversation.tsx` | Session resume screen                                                                                                                                                    |

### 3.14 Tasks System (`tasks/`, `Task.ts`, `tasks.ts`)

Background task types:

- `LocalShellTask` -- Background bash commands
- `LocalAgentTask` -- Local sub-agent tasks
- `RemoteAgentTask` -- Remote agent sessions
- `DreamTask` -- Auto-dream memory consolidation
- `LocalWorkflowTask` -- Workflow script execution (feature-gated)
- `MonitorMcpTask` -- MCP server monitoring (feature-gated)

Also has `tasks/types.ts` for shared task state types.

### 3.15 Coordinator Mode (`coordinator/`)

Single file `coordinatorMode.ts` implementing multi-agent coordination:

- `isCoordinatorMode()` -- Check if coordinator mode is active
- `getCoordinatorUserContext()` -- Additional context for coordinator
- Tool filtering for coordinator vs. worker agents

---

## 4. TYPES DIRECTORY (`types/`)

| File                | Purpose                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `command.ts`        | `Command` type with all variants (local, local-jsx, prompt), `getCommandName()`, `isCommandEnabled()` |
| `hooks.ts`          | Hook types: `HookProgress`, `PromptRequest`, `PromptResponse`, `HookCallbackMatcher`                  |
| `ids.ts`            | Branded ID types: `SessionId`, `AgentId`, `asSessionId()`, `asAgentId()`                              |
| `logs.ts`           | Log option types                                                                                      |
| `permissions.ts`    | `PermissionResult`, `PermissionMode`, `ToolPermissionRulesBySource`, `AdditionalWorkingDirectory`     |
| `plugin.ts`         | `LoadedPlugin`, `PluginError` types                                                                   |
| `textInputTypes.ts` | Text input types for prompt handling                                                                  |
| `generated/`        | Generated type definitions                                                                            |

---

## 5. SPECIAL PATTERNS AND FEATURES

### 5.1 Feature Flag System (`bun:bundle` `feature()`)

The codebase uses **Bun's build-time dead code elimination** via `feature()` from `bun:bundle`:

```ts
import { feature } from "bun:bundle"
const SleepTool = feature("PROACTIVE") ? require("./tools/SleepTool/SleepTool.js").SleepTool : null
```

Known feature flags: `PROACTIVE`, `KAIROS`, `KAIROS_BRIEF`, `KAIROS_PUSH_NOTIFICATION`, `KAIROS_GITHUB_WEBHOOKS`, `BRIDGE_MODE`, `DAEMON`, `VOICE_MODE`, `HISTORY_SNIP`, `WORKFLOW_SCRIPTS`, `CCR_REMOTE_SETUP`, `EXPERIMENTAL_SKILL_SEARCH`, `ULTRAPLAN`, `TORCH`, `UDS_INBOX`, `FORK_SUBAGENT`, `BUDDY`, `COORDINATOR_MODE`, `TRANSCRIPT_CLASSIFIER`, `OVERFLOW_TEST_TOOL`, `CONTEXT_COLLAPSE`, `TERMINAL_PANEL`, `WEB_BROWSER_TOOL`, `CACHED_MICROCOMPACT`, `REACTIVE_COMPACT`, `TOKEN_BUDGET`, `BG_SESSIONS`, `BREAK_CACHE_COMMAND`, `COMMIT_ATTRIBUTION`, `TEAMMEM`, `MCP_SKILLS`, `TEMPLATES`, `CHICAGO_MCP`, `AGENT_TRIGGERS`, `AGENT_TRIGGERS_REMOTE`, `MONITOR_TOOL`, `PROACTIVE`, `LODESTONE`, `SSH_REMOTE`, `DIRECT_CONNECT`, `UPLOAD_USER_SETTINGS`, `CONTEXT_COLLAPSE`

### 5.2 `buildTool()` Factory Pattern

All tools use `buildTool()` from `Tool.ts` which fills defaults:

- `isEnabled` -> `true`
- `isConcurrencySafe` -> `false`
- `isReadOnly` -> `false`
- `isDestructive` -> `false`
- `checkPermissions` -> `allow`
- `toAutoClassifierInput` -> `''`
- `userFacingName` -> `name`

### 5.3 Streaming Tool Execution

`services/tools/StreamingToolExecutor.ts` enables **parallel tool execution during streaming**:

- Tools are enqueued as tool_use blocks arrive during streaming
- Concurrency-safe tools execute in parallel
- Results are yielded as they complete

### 5.4 Multi-layer Permission System

1. **PermissionMode**: `default`, `plan`, `bypassPermissions`, `auto`
2. **Tool-level**: `checkPermissions()` on each tool
3. **Rule-based**: `alwaysAllowRules`, `alwaysDenyRules`, `alwaysAskRules` per source
4. **Hooks**: `PreToolUse`/`PostToolUse` hooks can intercept
5. **Auto-mode classifier**: Transcript classifier for auto-approval
6. **Sandbox**: Bubblewrap sandboxing for bash commands

### 5.5 Auto-Compact / Context Management

Multiple compaction strategies:

- **Auto-compact**: Threshold-based automatic compaction
- **Reactive compact**: Triggers on prompt-too-long API errors
- **Micro-compact**: API-level cache editing (removes old tool results)
- **Context collapse**: Staged collapsing of old context
- **Snip compact**: History snipping at marked boundaries
- **Tool result budget**: Persists large tool results to disk

### 5.6 Multi-Agent Patterns

- **AgentTool**: Spawns sub-agents with scoped contexts
- **Coordinator mode**: Main agent dispatches to worker agents
- **In-process teammates**: Agents running in the same process
- **Remote agents**: Agents running on remote infrastructure
- **Team create/delete**: Dynamic team management
- **SendMessageTool**: Inter-agent messaging
- **UDS messaging**: Unix domain socket messaging between peers

### 5.7 Plugin Architecture

- **Builtin plugins**: Registered at `plugins/bundled/index.ts`
- **External plugins**: Loaded from directories, ref-tracked with versioned caches
- **Plugin hooks**: Hot-reloaded on settings changes
- **Plugin marketplace**: Browse/install from marketplaces
- **Plugin skills**: Plugins can provide skill commands
- **Plugin commands**: Plugins can provide slash commands

### 5.8 MCP (Model Context Protocol) Integration

Comprehensive MCP support:

- **Server management**: `MCPConnectionManager`, auto-reconnect
- **Tool bridging**: MCP tools appear as native tools via `MCPTool.ts`
- **Resource support**: `ListMcpResourcesTool`, `ReadMcpResourceTool`
- **Auth**: OAuth, XAA IDP login, channel permissions
- **Elicitation**: Interactive URL-based authentication flows
- **Config**: Multi-scope config parsing (global, project, agent)
- **Official registry**: Pre-approved MCP server registry
- **Channel system**: Channel-based MCP server allowlists

### 5.9 Session Management

- **Session storage**: JSONL transcript recording, session ID-based
- **Session resume**: Load and continue previous conversations
- **Session teleport**: Move sessions between machines/repos
- **Cost state persistence**: Save/restore token costs across sessions
- **File history**: Snapshot file state for undo/rewind
- **Cross-project resume**: Resume sessions from different projects

### 5.10 Constants System (`constants/`)

| File                      | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `apiLimits.ts`            | API rate limits, token limits              |
| `betas.ts`                | Beta feature flags                         |
| `common.ts`               | Common utilities (date formatting)         |
| `cyberRiskInstruction.ts` | Security/safety instructions               |
| `errorIds.ts`             | Error identifier constants                 |
| `figures.ts`              | Unicode figure characters                  |
| `files.ts`                | File path constants                        |
| `github-app.ts`           | GitHub App constants                       |
| `keys.ts`                 | Key constants                              |
| `messages.ts`             | Message constants                          |
| `oauth.ts`                | OAuth configuration                        |
| `outputStyles.ts`         | Output style definitions                   |
| `product.ts`              | Product name, URLs                         |
| `prompts.ts`              | System prompt constants                    |
| `spinnerVerbs.ts`         | Spinner animation verbs                    |
| `system.ts`               | System constants (OS, platform)            |
| `systemPromptSections.ts` | System prompt section builders             |
| `toolLimits.ts`           | Tool-specific limits                       |
| `tools.ts`                | Tool name constants, disallowed tool lists |
| `turnCompletionVerbs.ts`  | Turn completion verb lists                 |
| `xml.ts`                  | XML tag constants                          |

---

## 6. UTILITIES (`utils/`) -- NOTABLE CATEGORIES

With **329 files**, the utils directory is effectively a framework library. Key categories:

| Category        | Key Files                                                                                                             | Purpose                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Permissions** | `permissions/`, `permissions.ts`                                                                                      | Full permission system, rule matching, auto-mode, filesystem rules |
| **Model**       | `model/model.ts`, `model/providers.ts`, `model/deprecation.ts`, `model/modelCapabilities.ts`, `model/modelStrings.ts` | Model resolution, provider detection, capability checking          |
| **Settings**    | `settings/settings.ts`, `settings/settingsCache.ts`, `settings/validation.ts`, `settings/mdm/`                        | Multi-source settings with MDM support                             |
| **Hooks**       | `hooks.ts`, `hooks/hookEvents.ts`, `hooks/sessionHooks.ts`, `hooks/postSamplingHooks.ts`                              | Hook execution engine                                              |
| **Git**         | `git.ts`, `git/`, `gitDiff.ts`, `gitSettings.ts`                                                                      | Git operations, worktree, diff                                     |
| **Auth**        | `auth.ts`, `authPortable.ts`, `secureStorage/`                                                                        | Authentication, API key management, keychain                       |
| **Messages**    | `messages.ts`, `messages/mappers.ts`, `messages/systemInit.ts`                                                        | Message creation, normalization, SDK mapping                       |
| **Sandbox**     | `sandbox/sandbox-adapter.ts`                                                                                          | Bubblewrap sandboxing                                              |
| **Plugins**     | `plugins/pluginLoader.ts`, `plugins/installedPluginsManager.ts`, etc.                                                 | Plugin loading, caching, validation                                |
| **Skills**      | `skills/skillChangeDetector.ts`                                                                                       | Skill file change detection                                        |
| **Process**     | `Shell.ts`, `ShellCommand.ts`, `shellConfig.ts`                                                                       | Shell execution                                                    |
| **Swarm**       | `swarm/`, `teammate.ts`, `teammateContext.ts`                                                                         | Multi-agent swarm utilities                                        |
| **Session**     | `sessionStorage.ts`, `sessionRestore.ts`, `sessionStart.ts`                                                           | Session persistence                                                |
| **File ops**    | `fsOperations.ts`, `file.ts`, `fileRead.ts`, `fileStateCache.ts`, `fileHistory.ts`                                    | File operations                                                    |
| **Teleport**    | `teleport.tsx`, `teleport/api.ts`                                                                                     | Session teleportation                                              |
| **Deep Link**   | `deepLink/banner.ts`, `deepLink/protocolHandler.ts`                                                                   | URL protocol handling                                              |

---

## 7. MIGRATION SYSTEM (`migrations/`)

Versioned migrations (CURRENT_MIGRATION_VERSION = 11):

| Migration                                             | Purpose                             |
| ----------------------------------------------------- | ----------------------------------- |
| `migrateFennecToOpus.ts`                              | Rename model "fennec" -> "opus"     |
| `migrateSonnet1mToSonnet45.ts`                        | Rename sonnet-1m -> sonnet-4-5      |
| `migrateSonnet45ToSonnet46.ts`                        | Rename sonnet-4-5 -> sonnet-4-6     |
| `migrateOpusToOpus1m.ts`                              | Rename opus -> opus-1m              |
| `migrateLegacyOpusToCurrent.ts`                       | Legacy opus string migration        |
| `resetProToOpusDefault.ts`                            | Reset Pro users to opus default     |
| `migrateAutoUpdatesToSettings.ts`                     | Move auto-update config to settings |
| `migrateBypassPermissionsAcceptedToSettings.ts`       | Move bypass permissions to settings |
| `migrateEnableAllProjectMcpServersToSettings.ts`      | Move MCP server config to settings  |
| `migrateReplBridgeEnabledToRemoteControlAtStartup.ts` | Bridge -> remote control migration  |
| `resetAutoModeOptInForDefaultOffer.ts`                | Reset auto-mode opt-in              |

---

## 8. BUILD/RUNTIME PATTERNS

- **Bun runtime**: Uses `bun:bundle` for tree-shaking, `Bun.file()` for file ops
- **Dead code elimination**: `feature()` + conditional `require()` for build-time elimination
- **`USER_TYPE=ant`**: Internal-only features gated on Anthropic employee builds
- **External vs. ant builds**: `"external" !== 'ant'` guards for public vs. internal
- **React/Ink TUI**: Full React rendering pipeline in the terminal
- **Zod validation**: Used extensively for schemas (tools, settings, hooks, SDK)
- **Memoization**: `lodash-es/memoize` used heavily for expensive computations
- **OpenTelemetry**: Full OTel integration for metrics/logging

---

This analysis covers **every directory and its purpose**, the **complete tool inventory**, the **command registry**, the **service layer**, the **feature flag system**, the **state management architecture**, the **query/agentic loop**, and all **special patterns**. The codebase is the full Claude Code CLI with approximately **1800+ TypeScript files**.
