# OpenCode: Commands & TUI Architecture

## 1. Two Slash Command Systems

### System A: Server-side Commands (template-based, sent to the AI)

Defined in `packages/opencode/src/command/index.ts`. Prompt templates that get expanded and sent to the LLM.

**Command.Info type:**

```ts
// src/command/index.ts, line 33-48
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  source: z.enum(["command", "mcp", "skill"]).optional(),
  template: z.promise(z.string()).or(z.string()),
  subtask: z.boolean().optional(),
  hints: z.array(z.string()),
})
```

**Real example — built-in `/init` command:**

```ts
// src/command/index.ts, line 86-94
commands[Default.INIT] = {
  name: Default.INIT,
  description: "guided AGENTS.md setup",
  source: "command",
  get template() {
    return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
  },
  hints: hints(PROMPT_INITIALIZE),
}
```

**Config-based commands** (from `opencode.json` or `.opencode/commands/*.md`) loaded at lines 106-119:

```ts
for (const [name, command] of Object.entries(cfg.command ?? {})) {
  commands[name] = {
    name,
    agent: command.agent,
    model: command.model,
    description: command.description,
    source: "command",
    get template() {
      return command.template
    },
    subtask: command.subtask,
    hints: hints(command.template),
  }
}
```

**Config schema for commands** (`Config.Command` at line 502-508 of config.ts):

```ts
export const Command = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: ModelId.optional(),
  subtask: z.boolean().optional(),
})
```

### System B: TUI-side Command Palette (UI actions with optional slash aliases)

Registered in TUI via `useCommandDialog().register()`. UI-level actions — opening dialogs, toggling settings.

**CommandOption type** (from `dialog-command.tsx`, line 25-31):

```ts
export type CommandOption = DialogSelectOption<string> & {
  keybind?: string
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}

type Slash = {
  name: string
  aliases?: string[]
}
```

**Real example — `/models` slash command (app.tsx, line 503-514):**

```tsx
command.register(() => [
  {
    title: "Switch model",
    value: "model.list",
    keybind: "model_list",
    suggested: true,
    category: "Agent",
    slash: {
      name: "models",
    },
    onSelect: () => {
      dialog.replace(() => <DialogModel />)
    },
  },
])
```

**Real example — `/compact` slash command (session/index.tsx, line 444-469):**

```ts
{
  title: "Compact session",
  value: "session.compact",
  keybind: "session_compact",
  category: "Session",
  slash: {
    name: "compact",
    aliases: ["summarize"],
  },
  onSelect: (dialog) => {
    sdk.client.session.summarize(...)
    dialog.clear()
  },
}
```

### How Dispatch Works

In `prompt/index.tsx` `submit()`, dispatch now splits into three paths:

1. `/commandname` matching a server-side command → `sdk.client.session.command()`
2. normal prompt submit → `sdk.client.session.promptAsync()`
3. explicit steer while a turn is busy → `POST /session/:sessionID/steer_async`

If input starts with `/` and autocomplete was showing TUI slash commands, the autocomplete `onSelect` fires directly.

The autocomplete (`prompt/autocomplete.tsx`, line 359-386) merges both:

```ts
const commands = createMemo((): AutocompleteOption[] => {
  const results: AutocompleteOption[] = [...command.slashes()]  // TUI slash commands
  for (const serverCommand of sync.data.command) {              // Server commands
    results.push({ ... })
  }
  return results
})
```

---

## 2. Dialog/Picker Patterns

Uses a **dialog stack** managed by `useDialog()` from `@tui/ui/dialog`.

**Core pattern:**

1. Register a command with `command.register()`
2. In `onSelect`, call `dialog.replace(() => <SomeDialogComponent />)`
3. Most dialogs use `<DialogSelect>` from `@tui/ui/dialog-select.tsx`

**DialogSelect props** (dialog-select.tsx, line 16-33):

```ts
export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  flat?: boolean
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  keybind?: { keybind?: Keybind.Info; title: string; onTrigger: (option) => void }[]
  current?: T
}

export interface DialogSelectOption<T = any> {
  title: string
  value: T
  description?: string
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  onSelect?: (ctx: DialogContext) => void
}
```

**Full dialog example (DialogModel, dialog-model.tsx):**

```tsx
export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

  const options = createMemo(() => {
    return providerOptions.map(([model, info]) => ({
      value: { providerID: provider.id, modelID: model },
      title: info.name ?? model,
      category: provider.name,
      onSelect() { onSelect(provider.id, model) },
    }))
  })

  return (
    <DialogSelect<...>
      options={options()}
      title="Select model"
      keybind={[...]}
      current={local.model.current()}
    />
  )
}
```

**Available dialog primitives:**

- `DialogConfirm` — yes/no confirmation
- `DialogPrompt` — text input dialog
- `DialogAlert` — informational alert
- `DialogSelect` — filterable list picker (most common)

---

## 3. Feature Flags

### Environment-variable flags (from `src/flag/flag.ts`)

| Flag                                                | Type                    | Description                                               |
| --------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `OPENCODE_EXPERIMENTAL`                             | boolean                 | Master toggle — enables several experimental features     |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER`                 | Effect Config (boolean) | File watcher                                              |
| `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER`         | Effect Config (boolean) | Disable file watcher                                      |
| `OPENCODE_EXPERIMENTAL_ICON_DISCOVERY`              | boolean                 | Icon discovery (also enabled by master)                   |
| `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT`      | boolean                 | Disable copy-on-select (default true on Windows)          |
| `OPENCODE_ENABLE_EXA` / `OPENCODE_EXPERIMENTAL_EXA` | boolean                 | Enable Exa (also enabled by master)                       |
| `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`     | number                  | Bash default timeout                                      |
| `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`            | number                  | Output token max                                          |
| `OPENCODE_EXPERIMENTAL_OXFMT`                       | boolean                 | Oxfmt formatter (also enabled by master)                  |
| `OPENCODE_EXPERIMENTAL_LSP_TY`                      | boolean                 | LSP Ty                                                    |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL`                    | boolean                 | LSP tool (also enabled by master)                         |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE`                   | boolean                 | Plan mode (also enabled by master)                        |
| `OPENCODE_EXPERIMENTAL_WORKSPACES`                  | boolean                 | Workspaces (also enabled by master)                       |
| `OPENCODE_EXPERIMENTAL_MARKDOWN`                    | boolean                 | Markdown rendering (default true unless explicitly false) |
| `OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS`              | boolean                 | Deferred tools (also enabled by master)                   |
| `OPENCODE_DEFERRED_TOOLS_THRESHOLD`                 | number                  | Deferred tools threshold (default: 15)                    |
| `OPENCODE_ENABLE_EXPERIMENTAL_MODELS`               | boolean                 | Experimental models                                       |

### Config-level experimental options (from `Config.Info.experimental`)

```ts
// config.ts lines 1024-1062
experimental: z.object({
  disable_paste_summary: z.boolean().optional(),
  batch_tool: z.boolean().optional(),
  deferred_tools: z.boolean().optional(),
  openTelemetry: z.boolean().optional(),
  primary_tools: z.array(z.string()).optional(),
  continue_loop_on_deny: z.boolean().optional(),
  mcp_timeout: z.number().int().positive().optional(),
  // Memory system
  autodream: z.boolean().optional(), // AutoDream consolidation on session idle
  autodream_model: z.string().optional(), // model for AutoDream (default: google/gemini-2.5-flash)
  observer: z.boolean().optional(), // intra-session observer at 30k tokens
  observer_model: z.string().optional(), // model for Observer (default: google/gemini-2.5-flash)
}).optional()
```

### Toggleable via `/features` TUI command

The `/features` dialog (`dialog-feature.tsx`) exposes config-toggleable features using `sdk.client.global.config.update()`. Features with only an `env` field are shown as read-only (env only) and cannot be toggled.

| Feature ID              | Toggle via Space | Model picker via Enter | Notes                       |
| ----------------------- | :--------------: | :--------------------: | --------------------------- |
| `deferred_tools`        |        ✅        |           —            | also toggleable via env var |
| `batch_tool`            |        ✅        |           —            |                             |
| `continue_loop_on_deny` |        ✅        |           —            |                             |
| `markdown`              |  ❌ (env only)   |           —            | read-only in UI             |
| `open_telemetry`        |        ✅        |           —            |                             |
| `autodream`             |        ✅        |  ✅ (AutoDream model)  | native libSQL-backed flow   |
| `observer`              |        ✅        |  ✅ (Observer model)   | native OM pipeline          |

---

## 4. Submit vs Steer Semantics

This was one of the biggest TUI behavior changes and the old docs were wrong.

### Normal submit

- Prompt input submits through `promptAsync()`
- Server route: `POST /session/:sessionID/prompt_async`
- Behavior: create a user message, return immediately, let the session loop drain it later

### Steer current turn

- Command palette action: `Steer current turn`
- Inline transcript action on queued prompts: `⎈ STEER`
- Server route: `POST /session/:sessionID/steer_async`
- Behavior when busy:
  - capture steer text
  - mark the chosen queued prompt as `STEERED` in UI via a synthetic hidden assistant marker
  - cancel the active runner
  - restart the loop with the steer injected into the current turn
- Behavior when idle:
  - degrade to normal enqueue behavior instead of failing

### Why queue detection changed

Queued prompts are not inferred from timestamps anymore. The session loop computes pending work from user messages that have not yet been consumed by a finished assistant reply. That boundary is determined by `assistant.parentID`.

This fixed three classes of bugs at once:

- wrong queued badge removal order
- wrong visual ordering of pending prompts
- steer accidentally behaving like just another queued turn

---

## 5. Runtime Flag Toggling

**There is NO existing mechanism for runtime flag toggling.**

- All `Flag.*` values in `flag.ts` are computed **once at module load time** from `process.env`. They are `const` from `truthy()` or `number()` calls.
- Some flags use `Object.defineProperty` with getters for dynamic access (lines 94-158): `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_TUI_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_PURE`, `OPENCODE_PLUGIN_META_FILE`, `OPENCODE_CLIENT`. These re-read from `process.env` on each access — but they are NOT experimental flags.
- Two flags use `Effect.Config.boolean(...)`: `OPENCODE_EXPERIMENTAL_FILEWATCHER` and `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER`. Resolved once when the Effect runtime starts.
- The `config.experimental` field in `opencode.json` IS persisted and can be changed by editing the config file.
- `Config.updateGlobal()` (line 1507-1526) writes back to `opencode.jsonc`/`opencode.json` then calls `invalidate()`.
- **The `/features` dialog uses `sdk.client.global.config.update()` to toggle `config.experimental.*` fields at runtime.** Features with `config` key are togglable; those with only `env` are read-only in the UI.

---

## 6. File Paths

### Command system (server-side templates)

- `packages/opencode/src/command/index.ts` — Command service, registration, list/get
- `packages/opencode/src/command/template/initialize.txt` — `/init` template
- `packages/opencode/src/command/template/review.txt` — `/review` template

### TUI command palette (UI-level slash commands)

- `packages/opencode/src/cli/cmd/tui/component/dialog-command.tsx` — `CommandProvider`, `useCommandDialog()`, `CommandOption` type
- `packages/opencode/src/cli/cmd/tui/app.tsx` — Main app, registers `/sessions`, `/new`, `/models`, `/agents`, `/mcps`, `/connect`, `/status`, `/themes`, `/help`, `/exit`, `/workspaces`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — Session route, transcript rendering, `QUEUED` / `STEERED` badges, inline `⎈ STEER`, session commands
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — Prompt component, registers commands, handles `promptAsync()` vs `steer_async` dispatch in `submit()`
- `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` — Autocomplete, merges TUI slashes + server commands

### Dialog/picker UI primitives

- `packages/opencode/src/cli/cmd/tui/ui/dialog.tsx` — Dialog provider/context
- `packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx` — `DialogSelect` (filterable list picker)
- `packages/opencode/src/cli/cmd/tui/ui/dialog-confirm.tsx` — Confirmation dialog
- `packages/opencode/src/cli/cmd/tui/ui/dialog-prompt.tsx` — Text input dialog
- `packages/opencode/src/cli/cmd/tui/ui/dialog-alert.tsx` — Alert dialog
- `packages/opencode/src/cli/cmd/tui/ui/dialog-help.tsx` — Help dialog

### Specific dialog components

- `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx` — Model picker
- `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx` — Agent picker
- `packages/opencode/src/cli/cmd/tui/component/dialog-mcp.tsx` — MCP toggle dialog
- `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx` — Session list
- `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx` — Provider connect
- `packages/opencode/src/cli/cmd/tui/component/dialog-theme-list.tsx` — Theme picker
- `packages/opencode/src/cli/cmd/tui/component/dialog-variant.tsx` — Variant picker

### Feature flags

- `packages/opencode/src/flag/flag.ts` — All environment-based flags

### Config system

- `packages/opencode/src/config/config.ts` — Config schema, loading, `update()`, `updateGlobal()`, `invalidate()`

### TUI events

- `packages/opencode/src/cli/cmd/tui/event.ts` — `TuiEvent` definitions

### Plugin API

- `packages/opencode/src/cli/cmd/tui/plugin/api.tsx` — Plugin API wrapping command.register/trigger/show
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts` — Plugin runtime delegating to the API

### Server routes

- `packages/opencode/src/server/routes/tui.ts` — TUI HTTP endpoints
- `packages/opencode/src/server/routes/session.ts` — sync prompt route, `prompt_async`, `steer_async`
