# Complete Architecture Analysis: `packages/opencode/src/` (merge-update branch)

## 1. DIRECTORY STRUCTURE (Top-Level)

| Directory        | Purpose                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `account/`       | Account management (authentication, device login, org management) via OpenCode's auth server |
| `acp/`           | Agent Client Protocol -- adapter layer for external IDE clients (VS Code, etc.)              |
| `agent/`         | Agent definitions and configuration (build, plan, explore, etc.)                             |
| `auth/`          | Local auth credential storage (OAuth, API keys, well-known tokens)                           |
| `bus/`           | Event bus system (per-instance PubSub + global EventEmitter)                                 |
| `cli/`           | CLI entry points, commands, and the entire TUI (Ink/SolidJS-based terminal UI)               |
| `command/`       | Slash-command system (/init, /review, custom markdown commands)                              |
| `config/`        | Configuration loading, schema, TUI config, markdown parsing                                  |
| `control-plane/` | Multi-workspace management, workspace adaptors, SSE forwarding                               |
| `effect/`        | Effect-TS runtime infrastructure (makeRuntime, InstanceState, InstanceRef)                   |
| `env/`           | Environment variable handling                                                                |
| `file/`          | File utilities (ignore rules, ripgrep, file watching, time tracking)                         |
| `filesystem/`    | Effect-based filesystem service abstraction                                                  |
| `flag/`          | Feature flags and environment variable flags (extensive)                                     |
| `format/`        | Code formatter integration (external formatters like prettier, biome, etc.)                  |
| `git/`           | Git operations wrapper                                                                       |
| `global/`        | Global XDG paths (data, cache, config, state)                                                |
| `id/`            | Identifier generation (ascending/descending ULIDs with entity prefixes)                      |
| `ide/`           | IDE detection and integration                                                                |
| `installation/`  | Installation metadata, version info, local dev detection                                     |
| `lsp/`           | LSP client/server management (TypeScript, Python, Go, etc.)                                  |
| `mcp/`           | MCP (Model Context Protocol) client management with OAuth support                            |
| `npm/`           | npm/bun install wrapper                                                                      |
| `patch/`         | Patch application utilities                                                                  |
| `permission/`    | Permission system (ask/allow/deny rules with pattern matching)                               |
| `plugin/`        | Plugin system (loading, lifecycle, GitHub Copilot, Codex, GitLab, Poe integrations)          |
| `project/`       | Project detection, instance management, VCS detection                                        |
| `provider/`      | AI provider SDK layer (30+ providers), model resolution, transforms                          |
| `pty/`           | Pseudo-terminal management for web UI                                                        |
| `question/`      | Question tool system (user interaction during agent execution)                               |
| `server/`        | HTTP/WebSocket server (Hono framework), API routes, mDNS                                     |
| `session/`       | Session management (CRUD, messages, prompting, LLM streaming, compaction, retry)             |
| `share/`         | Session sharing (upload to remote share service)                                             |
| `shell/`         | Shell detection (bash, zsh, PowerShell, fish)                                                |
| `skill/`         | Skill system (SKILL.md files, discovery, external Claude-compatible skills)                  |
| `snapshot/`      | Git-based snapshot tracking for undo/redo of file changes                                    |
| `storage/`       | SQLite database abstraction (Drizzle ORM), JSON migration                                    |
| `sync/`          | Event sourcing system (sync events with projectors)                                          |
| `tool/`          | All built-in tools (bash, edit, read, write, grep, glob, task, etc.)                         |
| `util/`          | Utility library (logging, errors, hashing, glob, filesystem, etc.)                           |
| `worktree/`      | Git worktree management for parallel sessions                                                |

Root files:

- **`index.ts`** -- CLI entry point, yargs command registration, DB migration middleware
- **`node.ts`** -- Re-exports `Server` for Node.js consumers
- **`sql.d.ts`** -- TypeScript declarations for SQL-related types

---

## 2. FILE INVENTORY BY DIRECTORY

### `account/` -- Account Management

| File             | Description                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`      | Branded types: AccountID, OrgID, AccessToken, RefreshToken, DeviceCode, UserCode; Info, Org, Login, PollResult classes |
| `account.sql.ts` | Drizzle schema: AccountTable, AccountStateTable, legacy ControlAccountTable                                            |
| `repo.ts`        | AccountRepo -- database operations (CRUD, token persistence)                                                           |
| `index.ts`       | Account service -- OAuth device flow login, token refresh, org management; exports `Account` namespace                 |

### `acp/` -- Agent Client Protocol

| File         | Description                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`   | ACPSessionState, ACPConfig interfaces                                                                                                                                  |
| `session.ts` | ACPSessionManager class -- session lifecycle for ACP connections                                                                                                       |
| `agent.ts`   | ACP.Agent class -- implements `ACPAgent` interface; handles initialize, newSession, loadSession, listSessions, forkSession, resumeSession, prompt, permission bridging |

### `agent/` -- Agent System

| File       | Description                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.ts` | Agent namespace -- defines built-in agents (build, plan, general, explore, compaction, title, summary); loads custom agents from config; Effect service with InstanceState; generate agent via LLM |

Prompt files (imported as .txt):

- `generate.txt`, `prompt/compaction.txt`, `prompt/explore.txt`, `prompt/summary.txt`, `prompt/title.txt`

### `auth/` -- Credential Storage

| File       | Description                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `index.ts` | Auth namespace -- stores OAuth tokens, API keys, well-known tokens in `auth.json`; Effect service |

### `bus/` -- Event Bus

| File           | Description                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `bus-event.ts` | BusEvent.define() -- typed event definition factory with registry                                   |
| `global.ts`    | GlobalBus -- Node.js EventEmitter for cross-instance events                                         |
| `index.ts`     | Bus namespace -- per-instance PubSub (typed + wildcard), publish/subscribe/callback; Effect service |

### `cli/` -- CLI and TUI

| File           | Description                                               |
| -------------- | --------------------------------------------------------- |
| `bootstrap.ts` | Server bootstrap for CLI commands                         |
| `error.ts`     | FormatError -- human-readable error formatting            |
| `heap.ts`      | Heap snapshot management                                  |
| `logo.ts`      | ASCII logo rendering                                      |
| `network.ts`   | Network option utilities for CLI commands                 |
| `ui.ts`        | UI namespace -- terminal styling, logo, println utilities |
| `upgrade.ts`   | Auto-upgrade logic                                        |

#### `cli/cmd/` -- CLI Commands

| File             | Description                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `cmd.ts`         | `cmd()` helper for yargs command definition                                                   |
| `account.ts`     | `opencode auth` -- login/logout/switch account                                                |
| `acp.ts`         | `opencode acp` -- ACP server mode                                                             |
| `agent.ts`       | `opencode agent` -- generate new agents                                                       |
| `db.ts`          | `opencode db` -- database management                                                          |
| `debug/index.ts` | `opencode debug` -- subcommands for agent, config, file, lsp, ripgrep, scrap, skill, snapshot |
| `export.ts`      | `opencode export` -- export sessions                                                          |
| `generate.ts`    | `opencode generate` -- generate agent config                                                  |
| `github.ts`      | `opencode github` -- GitHub integration                                                       |
| `import.ts`      | `opencode import` -- import sessions                                                          |
| `mcp.ts`         | `opencode mcp` -- MCP server management                                                       |
| `models.ts`      | `opencode models` -- list available models                                                    |
| `plug.ts`        | `opencode plugin` -- plugin management                                                        |
| `pr.ts`          | `opencode pr` -- PR creation/review                                                           |
| `providers.ts`   | `opencode providers` -- list providers                                                        |
| `run.ts`         | `opencode run` -- headless/non-interactive mode (stream output to terminal)                   |
| `serve.ts`       | `opencode serve` -- start HTTP server                                                         |
| `session.ts`     | `opencode session` -- session management CLI                                                  |
| `stats.ts`       | `opencode stats` -- usage statistics                                                          |
| `uninstall.ts`   | `opencode uninstall`                                                                          |
| `upgrade.ts`     | `opencode upgrade`                                                                            |
| `web.ts`         | `opencode web` -- start web UI                                                                |

#### `cli/cmd/tui/` -- TUI Application (SolidJS + @opentui)

| File        | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `app.tsx`   | Main TUI application -- SolidJS render tree with all providers and routes |
| `thread.ts` | TuiThreadCommand -- `$0` default command, spawns worker process for TUI   |
| `attach.ts` | AttachCommand -- attach to running server                                 |
| `worker.ts` | Worker process -- runs HTTP server, forwards events via RPC               |
| `event.ts`  | TuiEvent definitions (model cycle, tips toggle, etc.)                     |
| `win32.ts`  | Windows-specific terminal fixes                                           |

##### `cli/cmd/tui/context/` -- React-like Context Providers

| File                 | Description                                     |
| -------------------- | ----------------------------------------------- |
| `args.tsx`           | ArgsProvider -- CLI arguments context           |
| `directory.ts`       | Directory context utilities                     |
| `exit.tsx`           | ExitProvider -- app exit handling               |
| `helper.tsx`         | Helper context                                  |
| `keybind.tsx`        | KeybindProvider -- keyboard shortcut management |
| `kv.tsx`             | KVProvider -- key-value store context           |
| `local.tsx`          | LocalProvider -- local state management         |
| `plugin-keybinds.ts` | Plugin keybind registration                     |
| `prompt.tsx`         | PromptRefProvider -- prompt input ref           |
| `route.tsx`          | RouteProvider -- client-side routing            |
| `sdk.tsx`            | SDKProvider -- OpenCode SDK client context      |
| `sync.tsx`           | SyncProvider -- server sync event subscription  |
| `theme.tsx`          | ThemeProvider -- theme management               |
| `tui-config.tsx`     | TuiConfigProvider -- TUI configuration          |

##### `cli/cmd/tui/component/` -- UI Components

| File                                | Description                           |
| ----------------------------------- | ------------------------------------- |
| `border.tsx`                        | Border component                      |
| `dialog-agent.tsx`                  | Agent selection dialog                |
| `dialog-command.tsx`                | Command palette dialog                |
| `dialog-mcp.tsx`                    | MCP server status dialog              |
| `dialog-model.tsx`                  | Model selection dialog                |
| `dialog-provider.tsx`               | Provider list dialog                  |
| `dialog-session-list.tsx`           | Session list dialog                   |
| `dialog-session-rename.tsx`         | Session rename dialog                 |
| `dialog-skill.tsx`                  | Skill selection dialog                |
| `dialog-stash.tsx`                  | Stash management dialog               |
| `dialog-status.tsx`                 | Status dialog                         |
| `dialog-tag.tsx`                    | Tag dialog                            |
| `dialog-theme-list.tsx`             | Theme selection dialog                |
| `dialog-variant.tsx`                | Model variant dialog                  |
| `dialog-workspace-list.tsx`         | Workspace list dialog                 |
| `error-component.tsx`               | Error boundary component              |
| `logo.tsx`                          | Logo component                        |
| `plugin-route-missing.tsx`          | Missing plugin route fallback         |
| `spinner.tsx`                       | Loading spinner                       |
| `startup-loading.tsx`               | Startup loading screen                |
| `todo-item.tsx`                     | Todo list item component              |
| `prompt/index.tsx`                  | Prompt input component                |
| `prompt/autocomplete.tsx`           | Autocomplete for @-mentions, commands |
| `prompt/frecency.tsx`               | Frecency-based model ranking          |
| `prompt/history.tsx`                | Prompt history management             |
| `prompt/part.ts`                    | Prompt part parsing                   |
| `prompt/stash.tsx`                  | Prompt stash (save/restore drafts)    |
| `workspace/dialog-session-list.tsx` | Workspace-scoped session list         |

##### `cli/cmd/tui/routes/` -- TUI Routes

| File                                    | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| `home.tsx`                              | Home route -- session list, tips               |
| `session/index.tsx`                     | Session route -- message view, prompt, sidebar |
| `session/footer.tsx`                    | Session footer (model, tokens, cost)           |
| `session/subagent-footer.tsx`           | Subagent session footer                        |
| `session/sidebar.tsx`                   | Session sidebar (files, MCP, LSP, todo)        |
| `session/permission.tsx`                | Permission request dialog                      |
| `session/question.tsx`                  | Question dialog for question tool              |
| `session/dialog-fork-from-timeline.tsx` | Fork session dialog                            |
| `session/dialog-message.tsx`            | Message detail dialog                          |
| `session/dialog-subagent.tsx`           | Subagent dialog                                |
| `session/dialog-timeline.tsx`           | Timeline/undo dialog                           |

##### `cli/cmd/tui/ui/` -- Base UI Primitives

| File                        | Description                   |
| --------------------------- | ----------------------------- |
| `dialog.tsx`                | Base dialog component         |
| `dialog-alert.tsx`          | Alert dialog                  |
| `dialog-confirm.tsx`        | Confirmation dialog           |
| `dialog-export-options.tsx` | Export options dialog         |
| `dialog-help.tsx`           | Help/keybind reference dialog |
| `dialog-prompt.tsx`         | Prompt dialog                 |
| `dialog-select.tsx`         | Selection dialog              |
| `link.tsx`                  | Clickable link component      |
| `spinner.ts`                | Spinner animation frames      |
| `toast.tsx`                 | Toast notification system     |

##### `cli/cmd/tui/util/` -- TUI Utilities

| File            | Description                 |
| --------------- | --------------------------- |
| `clipboard.ts`  | Clipboard operations        |
| `editor.ts`     | External editor integration |
| `model.ts`      | Model display utilities     |
| `scroll.ts`     | Scroll management           |
| `selection.ts`  | Text selection              |
| `signal.ts`     | Signal utilities            |
| `terminal.ts`   | Terminal detection          |
| `transcript.ts` | Session transcript export   |

##### `cli/cmd/tui/plugin/` -- TUI Plugin System

| File          | Description                                         |
| ------------- | --------------------------------------------------- |
| `index.ts`    | Re-exports TuiPluginRuntime, createTuiApi, RouteMap |
| `api.tsx`     | createTuiApi -- API surface exposed to TUI plugins  |
| `internal.ts` | Internal plugin utilities                           |
| `runtime.ts`  | TuiPluginRuntime -- loads and runs TUI plugins      |
| `slots.tsx`   | Slot system for plugin UI injection points          |

##### `cli/cmd/tui/feature-plugins/` -- Built-in TUI Feature Plugins

| File                  | Description               |
| --------------------- | ------------------------- |
| `home/footer.tsx`     | Home screen footer plugin |
| `home/tips.tsx`       | Tips feature plugin       |
| `home/tips-view.tsx`  | Tips display component    |
| `sidebar/context.tsx` | Sidebar context           |
| `sidebar/files.tsx`   | Files sidebar tab         |
| `sidebar/footer.tsx`  | Sidebar footer            |
| `sidebar/lsp.tsx`     | LSP sidebar tab           |
| `sidebar/mcp.tsx`     | MCP sidebar tab           |
| `sidebar/todo.tsx`    | Todo sidebar tab          |
| `system/plugins.tsx`  | Plugin manager UI         |

##### `cli/effect/` -- Effect-based CLI utilities

| File        | Description                   |
| ----------- | ----------------------------- |
| `prompt.ts` | Effect-based prompt utilities |

### `command/` -- Slash Commands

| File       | Description                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `index.ts` | Command namespace -- loads from config, MCP, skills; built-in /init and /review; Effect service |

Template files: `template/initialize.txt`, `template/review.txt`

### `config/` -- Configuration

| File             | Description                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`      | Config namespace -- MASSIVE file (~1700 lines): Zod schemas for entire config (providers, agents, MCP, keybinds, server, permissions, etc.); loads from global/local/managed/remote/plist sources; Effect service |
| `markdown.ts`    | ConfigMarkdown -- YAML frontmatter parsing for .md config files                                                                                                                                                   |
| `paths.ts`       | ConfigPaths -- config file path resolution, error types                                                                                                                                                           |
| `tui.ts`         | TuiConfig -- TUI-specific config loading (tui.json, themes)                                                                                                                                                       |
| `tui-schema.ts`  | TUI config schema (themes, display options)                                                                                                                                                                       |
| `tui-migrate.ts` | TUI config migration from legacy format                                                                                                                                                                           |

### `control-plane/` -- Multi-Workspace

| File                   | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `schema.ts`            | WorkspaceID branded type                                    |
| `types.ts`             | WorkspaceInfo schema                                        |
| `workspace.ts`         | Workspace namespace -- CRUD, create/destroy, SSE forwarding |
| `workspace.sql.ts`     | Drizzle schema for workspace table                          |
| `sse.ts`               | SSE event parsing utility                                   |
| `adaptors/index.ts`    | Adaptor registry (worktree, etc.)                           |
| `adaptors/worktree.ts` | Worktree workspace adaptor                                  |

### `effect/` -- Effect-TS Infrastructure

| File                     | Description                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `run-service.ts`         | `makeRuntime()` -- shared memoMap runtime factory for all services; returns runPromise/runSync/runFork/runCallback |
| `instance-state.ts`      | `InstanceState` -- per-directory state via ScopedCache; the core pattern for per-project isolation                 |
| `instance-ref.ts`        | InstanceRef -- Effect reference for AsyncLocalStorage bridging                                                     |
| `instance-registry.ts`   | Instance disposal tracking across all InstanceState caches                                                         |
| `runner.ts`              | Runner -- Effect runtime execution helpers                                                                         |
| `cross-spawn-spawner.ts` | Cross-platform process spawner (cross-spawn integration for Effect)                                                |

### `env/` -- Environment

| File       | Description                                         |
| ---------- | --------------------------------------------------- |
| `index.ts` | Env namespace -- environment variable getter/setter |

### `file/` -- File Utilities

| File           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `ignore.ts`    | File ignore rules (.gitignore, .opencodeignore)         |
| `index.ts`     | File service barrel                                     |
| `protected.ts` | Protected file detection                                |
| `ripgrep.ts`   | Ripgrep wrapper for code search and directory tree      |
| `time.ts`      | FileTime -- file modification time tracking via watcher |
| `watcher.ts`   | File watcher (parcel/watcher integration)               |

### `filesystem/` -- Effect Filesystem

| File       | Description                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------- |
| `index.ts` | AppFileSystem -- Effect-based filesystem service (readJson, writeJson, readFileString, etc.) |

### `flag/` -- Feature Flags

| File      | Description                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flag.ts` | Flag namespace -- 60+ environment variable flags controlling features, experimental toggles, disable switches. Dynamic getters for runtime-settable flags. Key flags: OPENCODE_PURE, OPENCODE_EXPERIMENTAL, OPENCODE_EXPERIMENTAL_PLAN_MODE, OPENCODE_EXPERIMENTAL_WORKSPACES, OPENCODE_EXPERIMENTAL_LSP_TOOL, OPENCODE_DISABLE_CLAUDE_CODE, etc. |

### `format/` -- Code Formatting

| File           | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `formatter.ts` | Formatter integration -- runs external formatters on files |
| `index.ts`     | Format namespace -- service barrel                         |

### `git/` -- Git Operations

| File       | Description                          |
| ---------- | ------------------------------------ |
| `index.ts` | Git namespace -- git command wrapper |

### `global/` -- Global Paths

| File       | Description                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `index.ts` | Global.Path -- XDG-compliant paths (data, cache, config, state, bin, log); creates directories on import |

### `id/` -- Identifiers

| File    | Description                                                                      |
| ------- | -------------------------------------------------------------------------------- |
| `id.ts` | Identifier -- ascending/descending ULID generators with entity prefix validation |

### `ide/` -- IDE Detection

| File       | Description             |
| ---------- | ----------------------- |
| `index.ts` | IDE detection utilities |

### `installation/` -- Installation Info

| File       | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `index.ts` | Installation namespace -- VERSION, isLocal(), channel detection |
| `meta.ts`  | Installation metadata                                           |

### `lsp/` -- LSP Management

| File          | Description                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | LSP namespace -- server lifecycle management, diagnostics, document symbols, hover, references; Effect service with InstanceState |
| `client.ts`   | LSPClient -- LSP protocol communication                                                                                           |
| `language.ts` | Language configuration (extensions mapping)                                                                                       |
| `launch.ts`   | LSP server launch/download                                                                                                        |
| `server.ts`   | LSPServer -- built-in server definitions (TypeScript, Python, Go, etc.)                                                           |

### `mcp/` -- Model Context Protocol

| File                | Description                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `index.ts`          | MCP namespace -- client management for stdio/HTTP/SSE MCP servers; tool proxying; Effect service with InstanceState |
| `auth.ts`           | MCP OAuth authentication state                                                                                      |
| `oauth-callback.ts` | OAuth callback server for MCP auth flow                                                                             |
| `oauth-provider.ts` | OAuth provider implementation for MCP                                                                               |

### `npm/` -- Package Management

| File       | Description                                |
| ---------- | ------------------------------------------ |
| `index.ts` | Npm namespace -- install wrapper (bun/npm) |

### `patch/` -- Patch Utilities

| File       | Description                 |
| ---------- | --------------------------- |
| `index.ts` | Patch application utilities |

### `permission/` -- Permission System

| File          | Description                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | Permission namespace -- rule evaluation, ask/allow/deny with pattern matching (wildcard/glob), session-level permission state; Effect service |
| `schema.ts`   | PermissionID branded type                                                                                                                     |
| `evaluate.ts` | Rule evaluation logic (pattern-specific matching)                                                                                             |
| `arity.ts`    | BashArity -- extracts file patterns from bash commands for permission checks                                                                  |

### `plugin/` -- Plugin System

| File                        | Description                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                  | Plugin namespace -- loads plugins (internal + npm + file), manages hooks lifecycle; Effect service with InstanceState |
| `loader.ts`                 | PluginLoader -- dynamic import of plugin modules                                                                      |
| `install.ts`                | Plugin installation (npm)                                                                                             |
| `meta.ts`                   | Plugin metadata management                                                                                            |
| `shared.ts`                 | Plugin utility functions (specifier parsing, ID resolution)                                                           |
| `codex.ts`                  | CodexAuthPlugin -- OpenAI Codex auth plugin                                                                           |
| `github-copilot/copilot.ts` | CopilotAuthPlugin -- GitHub Copilot OAuth plugin                                                                      |
| `github-copilot/models.ts`  | Copilot model definitions                                                                                             |

### `project/` -- Project Management

| File             | Description                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `project.ts`     | Project namespace -- project detection from directory, VCS detection                                                          |
| `project.sql.ts` | Drizzle schema for project table                                                                                              |
| `schema.ts`      | ProjectID branded type                                                                                                        |
| `instance.ts`    | Instance -- AsyncLocalStorage-based project context (directory, worktree, project); the central "current project" abstraction |
| `bootstrap.ts`   | InstanceBootstrap -- initialization logic when entering a project                                                             |
| `state.ts`       | State management utilities                                                                                                    |
| `vcs.ts`         | VCS detection and operations                                                                                                  |

### `provider/` -- AI Provider Layer

| File                   | Description                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider.ts`          | Provider namespace (~1700 lines) -- manages 30+ AI SDK providers (Anthropic, OpenAI, Google, Azure, Bedrock, Vertex, OpenRouter, Mistral, Groq, xAI, Cerebras, GitLab, Copilot, etc.); model resolution, language model creation; Effect service |
| `schema.ts`            | ProviderID, ModelID branded types with well-known provider constants                                                                                                                                                                             |
| `auth.ts`              | Provider authentication (OAuth flows for OpenAI, GitHub Copilot)                                                                                                                                                                                 |
| `error.ts`             | ProviderError definitions                                                                                                                                                                                                                        |
| `models.ts`            | ModelsDev -- models.dev API integration for model metadata                                                                                                                                                                                       |
| `models-snapshot.d.ts` | Type declarations for bundled model snapshots                                                                                                                                                                                                    |
| `transform.ts`         | ProviderTransform -- model-specific parameter transforms (max tokens, cache control, etc.)                                                                                                                                                       |
| `sdk/copilot/`         | Full GitHub Copilot AI SDK provider implementation (chat + responses API)                                                                                                                                                                        |

### `pty/` -- Pseudo-Terminal

| File        | Description                                                           |
| ----------- | --------------------------------------------------------------------- |
| `index.ts`  | Pty namespace -- terminal session management for web UI (via bun-pty) |
| `schema.ts` | PtyID branded type                                                    |

### `question/` -- User Questions

| File        | Description                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `index.ts`  | Question namespace -- ask questions during agent execution; deferred responses; Effect service |
| `schema.ts` | QuestionID branded type                                                                        |

### `server/` -- HTTP Server

| File                     | Description                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `server.ts`              | Server namespace -- Hono app setup, CORS, auth middleware, OpenAPI spec generation, mDNS  |
| `instance.ts`            | InstanceRoutes -- all per-project API routes (session, config, provider, mcp, file, etc.) |
| `router.ts`              | WorkspaceRouterMiddleware -- routes requests to correct workspace instance                |
| `middleware.ts`          | Error handling middleware                                                                 |
| `error.ts`               | API error definitions                                                                     |
| `event.ts`               | Server event definitions                                                                  |
| `projectors.ts`          | Sync event projector initialization                                                       |
| `mdns.ts`                | mDNS service discovery                                                                    |
| `routes/config.ts`       | `/config` API routes                                                                      |
| `routes/event.ts`        | `/event` SSE streaming routes                                                             |
| `routes/experimental.ts` | `/experimental` API routes                                                                |
| `routes/file.ts`         | `/file` API routes                                                                        |
| `routes/global.ts`       | Global (non-project) API routes                                                           |
| `routes/mcp.ts`          | `/mcp` API routes                                                                         |
| `routes/permission.ts`   | `/permission` API routes                                                                  |
| `routes/project.ts`      | `/project` API routes                                                                     |
| `routes/provider.ts`     | `/provider` API routes                                                                    |
| `routes/pty.ts`          | `/pty` WebSocket routes                                                                   |
| `routes/question.ts`     | `/question` API routes                                                                    |
| `routes/session.ts`      | `/session` API routes (CRUD, prompt, messages, etc.)                                      |
| `routes/tui.ts`          | `/tui` TUI-specific routes                                                                |
| `routes/workspace.ts`    | `/workspace` API routes                                                                   |

### `session/` -- Session Management (CORE)

| File             | Description                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`      | SessionID, MessageID, PartID branded types                                                                                                                                                                           |
| `session.sql.ts` | Drizzle schema: SessionTable, MessageTable, PartTable, TodoTable, PermissionTable                                                                                                                                    |
| `index.ts`       | Session namespace (~887 lines) -- CRUD, fork, share, messages, updateMessage/updatePart, event definitions; Effect service                                                                                           |
| `message.ts`     | Legacy message handling                                                                                                                                                                                              |
| `message-v2.ts`  | MessageV2 namespace (~1031 lines) -- message schemas (User, Assistant, TextPart, ToolPart, ReasoningPart, FilePart, SnapshotPart, PatchPart, CompactionPart); error types; conversion to AI SDK format               |
| `prompt.ts`      | SessionPrompt namespace (~1950 lines) -- THE CORE ORCHESTRATION: handles user prompts, builds tool registry, runs LLM stream loop, manages compaction, processes commands, handles structured output; Effect service |
| `processor.ts`   | SessionProcessor (~523 lines) -- processes LLM stream events, manages tool calls, snapshots, doom loop detection; Effect service                                                                                     |
| `llm.ts`         | LLM namespace -- wraps AI SDK streamText, applies provider transforms, manages GitLab workflows; Effect service                                                                                                      |
| `system.ts`      | SystemPrompt -- provider-specific system prompts, environment info, skill prompts                                                                                                                                    |
| `compaction.ts`  | SessionCompaction (~441 lines) -- context window management, auto-compaction, pruning old tool outputs                                                                                                               |
| `instruction.ts` | Instruction -- loads AGENTS.md and custom instruction files                                                                                                                                                          |
| `overflow.ts`    | Overflow detection for context window                                                                                                                                                                                |
| `retry.ts`       | SessionRetry -- retry logic for transient LLM errors                                                                                                                                                                 |
| `revert.ts`      | SessionRevert -- undo/redo file changes via snapshot                                                                                                                                                                 |
| `summary.ts`     | SessionSummary -- diff summary generation                                                                                                                                                                            |
| `status.ts`      | SessionStatus -- busy/idle state tracking per session                                                                                                                                                                |
| `todo.ts`        | Todo namespace -- todo list management (tracks task items); Effect service                                                                                                                                           |
| `projectors.ts`  | Session-related sync event projectors                                                                                                                                                                                |

Prompt files (imported as .txt): `prompt/anthropic.txt`, `prompt/beast.txt`, `prompt/build-switch.txt`, `prompt/codex.txt`, `prompt/default.txt`, `prompt/gemini.txt`, `prompt/gpt.txt`, `prompt/kimi.txt`, `prompt/max-steps.txt`, `prompt/plan.txt`, `prompt/summary.txt`, `prompt/title.txt`, `prompt/trinity.txt`

### `share/` -- Session Sharing

| File            | Description                                                                             |
| --------------- | --------------------------------------------------------------------------------------- |
| `share-next.ts` | ShareNext namespace -- create/sync/remove shared sessions to remote API; Effect service |
| `share.sql.ts`  | Drizzle schema for share tracking table                                                 |

### `shell/` -- Shell Detection

| File       | Description                                                                               |
| ---------- | ----------------------------------------------------------------------------------------- |
| `shell.ts` | Shell namespace -- detects and configures user's shell (bash, zsh, fish, PowerShell, cmd) |

### `skill/` -- Skill System

| File           | Description                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`     | Skill namespace -- loads SKILL.md files from .opencode, .claude, .agents dirs + config paths; Effect service with InstanceState |
| `discovery.ts` | Discovery -- fetches skills from remote URLs                                                                                    |

### `snapshot/` -- Snapshot Tracking

| File       | Description                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | Snapshot namespace (~726 lines) -- git-based file snapshot tracking, diff computation, restore, revert; Effect service with InstanceState |

### `storage/` -- Database Layer

| File                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `db.ts`             | Database abstraction -- exports Client(), use(), transaction()    |
| `db.bun.ts`         | Bun SQLite driver                                                 |
| `db.node.ts`        | Node.js SQLite driver (better-sqlite3)                            |
| `schema.ts`         | Storage.Schema -- base schema utilities                           |
| `schema.sql.ts`     | Drizzle schema: Timestamps mixin                                  |
| `storage.ts`        | Storage namespace -- JSON file storage with locks; Effect service |
| `json-migration.ts` | JsonMigration -- migrates legacy JSON files to SQLite             |

### `sync/` -- Event Sourcing

| File           | Description                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------- |
| `index.ts`     | SyncEvent namespace -- event sourcing system with registry, projectors, and bus integration |
| `schema.ts`    | EventID branded type                                                                        |
| `event.sql.ts` | Drizzle schema: EventTable, EventSequenceTable                                              |

### `tool/` -- Built-in Tools (25+ tools)

| File                                      | Description                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tool.ts`                                 | Tool namespace -- `define()` and `defineEffect()` factories; wraps execution with truncation         |
| `schema.ts`                               | ToolID branded type                                                                                  |
| `registry.ts`                             | ToolRegistry -- assembles all tools, applies model-specific filtering, plugin tools; Effect service  |
| `deferred.ts`                             | Tool deferral system -- experimental: exclude tools from initial payload, discover via tool_search   |
| `bash.ts`                                 | BashTool -- shell command execution with timeout, tree-sitter parsing for file permission extraction |
| `edit.ts`                                 | EditTool -- exact string replacement in files                                                        |
| `write.ts`                                | WriteTool -- write entire file contents                                                              |
| `read.ts`                                 | ReadTool -- read file contents with line ranges                                                      |
| `glob.ts`                                 | GlobTool -- file pattern matching                                                                    |
| `grep.ts`                                 | GrepTool -- content search via ripgrep                                                               |
| `ls.ts`                                   | ListTool -- directory listing                                                                        |
| `task.ts`                                 | TaskTool -- spawn subagent sessions                                                                  |
| `todo.ts`                                 | TodoWriteTool -- manage task/todo list                                                               |
| `webfetch.ts`                             | WebFetchTool -- fetch web pages                                                                      |
| `websearch.ts`                            | WebSearchTool -- web search (Exa API)                                                                |
| `codesearch.ts`                           | CodeSearchTool -- code search (Exa API)                                                              |
| `skill.ts`                                | SkillTool -- load skill instructions                                                                 |
| `lsp.ts`                                  | LspTool -- LSP integration (diagnostics, symbols, hover)                                             |
| `batch.ts`                                | BatchTool -- experimental batch tool execution                                                       |
| `apply_patch.ts`                          | ApplyPatchTool -- unified diff patch application (for GPT models)                                    |
| `multiedit.ts`                            | MultiEditTool -- multiple edits in one call                                                          |
| `plan.ts`                                 | PlanExitTool -- experimental plan mode exit tool                                                     |
| `question.ts`                             | QuestionTool -- ask user questions during execution                                                  |
| `invalid.ts`                              | InvalidTool -- handles invalid/unknown tool calls                                                    |
| `external-directory.ts`                   | External directory access handling                                                                   |
| `truncate.ts`                             | Truncate -- output truncation to stay within limits                                                  |
| `truncation-dir.ts`                       | Truncation directory management                                                                      |
| `tool_search.ts` (referenced in registry) | ToolSearchTool -- experimental tool discovery                                                        |

### `util/` -- Utility Library (30+ files)

| File                    | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `abort.ts`              | Abort signal utilities                                                           |
| `archive.ts`            | Archive handling                                                                 |
| `color.ts`              | Color utilities                                                                  |
| `context.ts`            | AsyncLocalStorage-based context (used by Instance)                               |
| `data-url.ts`           | Data URL encoding/decoding                                                       |
| `defer.ts`              | Deferred promise pattern                                                         |
| `effect-http-client.ts` | Effect HTTP client with retry                                                    |
| `effect-zod.ts`         | Effect-to-Zod schema bridge                                                      |
| `error.ts`              | Error message extraction                                                         |
| `filesystem.ts`         | Filesystem utilities (exists, readText, write, readJson, writeJson, resolve)     |
| `flock.ts`              | File locking                                                                     |
| `fn.ts`                 | `fn()` -- Zod-validated function wrapper                                         |
| `format.ts`             | Formatting utilities                                                             |
| `glob.ts`               | Glob scanning wrapper                                                            |
| `hash.ts`               | Fast hashing                                                                     |
| `iife.ts`               | Immediately-invoked function expression helper                                   |
| `keybind.ts`            | Keybind parsing                                                                  |
| `lazy.ts`               | Lazy initialization pattern                                                      |
| `locale.ts`             | Locale utilities                                                                 |
| `lock.ts`               | Lock utilities                                                                   |
| `log.ts`                | Log -- structured logger with tags, timing, file output                          |
| `network.ts`            | Network utilities                                                                |
| `process.ts`            | Process -- spawn + run helpers                                                   |
| `queue.ts`              | Async queue                                                                      |
| `record.ts`             | isRecord type guard                                                              |
| `rpc.ts`                | Rpc -- RPC client/server over MessagePort (used by TUI worker)                   |
| `schema.ts`             | `withStatics()` -- adds static methods to Effect Schema branded types            |
| `scrap.ts`              | Web scraping utilities                                                           |
| `signal.ts`             | Signal utilities                                                                 |
| `timeout.ts`            | Timeout wrappers                                                                 |
| `token.ts`              | Token counting (tiktoken)                                                        |
| `update-schema.ts`      | `updateSchema()` -- makes all fields in Zod schema optional for patch operations |
| `which.ts`              | Command resolution (like `which`)                                                |
| `wildcard.ts`           | Wildcard/glob pattern matching                                                   |

### `worktree/` -- Git Worktree Management

| File       | Description                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | Worktree namespace (~612 lines) -- create/list/remove git worktrees for parallel development; Effect service with InstanceState |

---

## 3. KEY MODULES IN DETAIL

### Config/Flags System

- **Config** (`config/config.ts`): Central configuration with multi-source loading: managed/MDM (macOS plist), global (`~/.config/opencode/`), local (`.opencode/`), remote (well-known URLs), environment (`OPENCODE_CONFIG_CONTENT`). Zod schemas validate everything. The `Config.Service` is an Effect service with `InstanceState` for per-project config. Supports markdown-based config in `.opencode/{agent,command,mode,plugin}/*.md`.
- **Flag** (`flag/flag.ts`): 60+ env var flags. Some are static (read at module load), others are dynamic getters. Key categories: disable features (`OPENCODE_DISABLE_*`), experimental features (`OPENCODE_EXPERIMENTAL_*`), and configuration overrides.
- **TuiConfig** (`config/tui.ts`): Separate TUI config loaded from `tui.json` files.

### Session Management

- **Session** (`session/index.ts`): CRUD operations, fork, share/unshare, message management. Uses SyncEvent for event sourcing.
- **SessionPrompt** (`session/prompt.ts`): THE CORE -- 1950 lines. Handles: user prompts, command execution, shell integration, tool registry building, LLM stream orchestration, compaction triggers, structured output, permission enforcement, and plan mode.
- **SessionProcessor** (`session/processor.ts`): Processes LLM stream events. Handles: text chunks, reasoning, tool calls, snapshots, doom loop detection (3 consecutive failures), overflow detection.
- **LLM** (`session/llm.ts`): Wraps AI SDK's `streamText()`. Applies provider-specific transforms, handles GitLab workflow models, manages token limits.
- **SessionCompaction** (`session/compaction.ts`): Context window management. Auto-compacts when overflow detected. Prunes old tool outputs (minimum 20K tokens, protect last 40K). Uses the "compaction" agent.
- **MessageV2** (`session/message-v2.ts`): Full message schema with parts (text, tool, reasoning, file, snapshot, patch, compaction). Handles error conversion from various provider error types.

### Agent System

- **Agent** (`agent/agent.ts`): Defines 7 built-in agents:
  - **build**: Default primary agent, all tools allowed
  - **plan**: Read-only mode, disallows edit tools
  - **general**: Subagent for research and multi-step tasks
  - **explore**: Fast read-only subagent for codebase exploration
  - **compaction**: Hidden, handles context compaction
  - **title**: Hidden, generates session titles
  - **summary**: Hidden, generates summaries
- Custom agents loaded from config and `.opencode/agents/*.md` files.
- Each agent has its own permission ruleset.

### Tool System

- **Tool.define()** (`tool/tool.ts`): Factory for creating tools with Zod parameter validation and automatic output truncation.
- **ToolRegistry** (`tool/registry.ts`): Assembles all tools. Filters based on model (e.g., GPT gets `apply_patch` instead of `edit`/`write`). Loads custom tools from `tools/*.{js,ts}` and plugins.
- **25+ built-in tools**: bash, edit, write, read, glob, grep, ls, task, todo, webfetch, websearch, codesearch, skill, lsp, batch, apply_patch, plan, question, invalid, tool_search.
- **Tool deferral** (`tool/deferred.ts`): Experimental system to exclude tools from initial LLM payload and discover them via `tool_search`.

### CLI/TUI Components

- **CLI**: yargs-based with 20+ commands. Entry point in `index.ts`.
- **TUI**: SolidJS + `@opentui/solid` terminal UI. Two-process architecture: main thread spawns worker (`thread.ts`/`worker.ts`), worker runs HTTP server, main thread renders UI. Communication via RPC over MessagePort.
- **TUI Plugin System**: Plugins can register routes, keybinds, sidebar tabs, and UI slots.

### Permission System

- **Permission** (`permission/index.ts`): Three actions: allow, deny, ask. Rules are pattern-matched (glob-style) against tool names and file paths. Per-agent rulesets are merged from defaults + user config. Deferred resolution for "ask" via PubSub.
- **BashArity** (`permission/arity.ts`): Extracts file patterns from bash commands using tree-sitter parsing for permission evaluation.

---

## 4. EXPORTS AND INTERFACES

Every major module follows the same Effect service pattern:

1. Define an `Interface` type
2. Create `class Service extends ServiceMap.Service<...>()`
3. Define a `layer` using `Layer.effect(Service, Effect.gen(...))`
4. Define a `defaultLayer` composing dependencies
5. Create convenience async functions via `makeRuntime(Service, defaultLayer)`

### Module Dependency Graph (simplified)

```
SessionPrompt depends on:
  Bus, SessionStatus, Session, Agent, Provider, SessionProcessor,
  SessionCompaction, Plugin, Command, Permission, AppFileSystem,
  MCP, LSP, FileTime, ToolRegistry, LLM, Shell

SessionProcessor depends on:
  Session, Config, Bus, Snapshot, Agent, LLM, Permission, Plugin, SessionStatus

Agent depends on:
  Config, Auth, Skill, Provider

Config depends on:
  AppFileSystem, Auth, Account

ToolRegistry depends on:
  Config, Plugin, Question, Todo
```

---

## 5. SPECIAL PATTERNS

### Custom Effect Service Pattern (`makeRuntime`)

Every module uses `makeRuntime()` from `effect/run-service.ts` which creates a lazy `ManagedRuntime` with a shared `memoMap` for layer deduplication. This ensures services are singletons across the app.

### InstanceState Pattern

`InstanceState` from `effect/instance-state.ts` uses `ScopedCache` keyed by directory. Each project/directory gets isolated state, automatically cleaned up when the instance is disposed. Used by: Agent, Bus, Config, MCP, LSP, Plugin, Skill, Snapshot, Worktree, ToolRegistry, and more.

### AsyncLocalStorage Context (`Instance`)

`Instance` in `project/instance.ts` uses Node's `AsyncLocalStorage` (wrapped as `Context`) to maintain per-request project context. All service code accesses `Instance.directory`, `Instance.worktree`, `Instance.project` implicitly.

### Event Sourcing (SyncEvent)

`SyncEvent` in `sync/index.ts` provides event sourcing with projectors. Events are stored in SQLite (EventTable), projected to domain tables (SessionTable, MessageTable, etc.), and emitted to the Bus. This enables session sharing, undo/redo, and replay.

### ACP (Agent Client Protocol)

Full implementation of the ACP protocol allowing external IDEs to use OpenCode as a backend agent. Handles session management, permission bridging, tool call forwarding, and message streaming.

### TUI Plugin System

The TUI has its own plugin system (`cli/cmd/tui/plugin/`). Plugins can:

- Register custom routes
- Add keybinds
- Inject UI into named slots
- Add sidebar tabs
- Extend the home screen

### Provider SDK (Copilot)

A complete custom AI SDK provider for GitHub Copilot at `provider/sdk/copilot/` -- implements both chat completions and the newer responses API, with full OpenAI-compatible message conversion.

### Tool Deferral (Experimental)

`tool/deferred.ts` implements an experimental system where tools are excluded from the initial LLM API call and only added when discovered via the `tool_search` tool. This reduces initial prompt size.

### Managed Configuration (Enterprise)

`config/config.ts` supports enterprise-managed configuration via:

- macOS MDM profiles (`.mobileconfig` / managed preferences)
- System-wide config dirs (`/etc/opencode`, `/Library/Application Support/opencode`)
- Remote well-known URLs

---

**Total files analyzed**: ~260 TypeScript/TSX files across 44 directories.
