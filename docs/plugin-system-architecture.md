# OpenCode Plugin System Architecture

## 1. Plugin Interface/Type

**File:** `packages/plugin/src/index.ts`

```typescript
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>

export type PluginModule = {
  id?: string
  server: Plugin
  tui?: never
}

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}

export type PluginOptions = Record<string, unknown>
```

A plugin is a function that receives `PluginInput` (SDK client, project info, directory, worktree, Bun shell) and optionally `PluginOptions`, and returns a `Promise<Hooks>`.

---

## 2. All Available Hooks with Signatures

From `packages/plugin/src/index.ts` lines 189-276:

```typescript
export interface Hooks {
  // Bus event forwarding (not a trigger hook — called for every bus event)
  event?: (input: { event: Event }) => Promise<void>

  // Called with current config at plugin init time (not a trigger hook)
  config?: (input: Config) => Promise<void>

  // Register custom tools — keys become tool IDs
  tool?: {
    [key: string]: ToolDefinition
  }

  // Auth provider hook (OAuth/API key flows)
  auth?: AuthHook

  // Provider hook (custom models)
  provider?: ProviderHook

  // --- Trigger hooks (input, output) => Promise<void> pattern ---

  // Called when a new user message is received
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>

  // Modify LLM parameters (temperature, topP, topK, custom options)
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>

  // Inject custom HTTP headers into LLM requests
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>

  // Override permission decisions
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>

  // Modify parts before a slash command executes
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>

  // Intercept tool calls BEFORE execution (can modify args)
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>

  // Inject environment variables into shell execution
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>

  // Intercept tool calls AFTER execution (can modify output/title/metadata)
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>

  // Transform message history before sending to LLM
  "experimental.chat.messages.transform"?: (
    input: {},
    output: { messages: { info: Message; parts: Part[] }[] },
  ) => Promise<void>

  // Transform/modify the system prompt array
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] },
  ) => Promise<void>

  // Customize compaction behavior
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>

  // Post-process completed text parts from LLM
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>

  // Modify tool definitions (description + parameters) sent to LLM
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
}
```

### Trigger mechanism

In `src/plugin/index.ts` lines 235-248, the trigger function iterates over all loaded hooks sequentially, calling `hook[name](input, output)`. The `output` object is **mutable** — plugins modify it in place:

```typescript
const trigger = Effect.fn("Plugin.trigger")(function* (name, input, output) {
  const s = yield* InstanceState.get(state)
  for (const hook of s.hooks) {
    const fn = hook[name] as any
    if (!fn) continue
    yield* Effect.promise(async () => fn(input, output))
  }
  return output
})
```

---

## 3. Plugin Capabilities Matrix

| Capability                  | Supported? | How                                              |
| --------------------------- | ---------- | ------------------------------------------------ |
| **Add tools**               | ✅ Yes     | `Hooks.tool` — keys become tool IDs              |
| **Remove/filter tools**     | ❌ No      | No hook receives full tool dict                  |
| **Modify tool definitions** | ✅ Yes     | `"tool.definition"` hook                         |
| **Intercept tool calls**    | ✅ Yes     | `"tool.execute.before"` + `"tool.execute.after"` |
| **Modify system prompt**    | ✅ Yes     | `"experimental.chat.system.transform"`           |
| **Modify message history**  | ✅ Yes     | `"experimental.chat.messages.transform"`         |
| **Modify LLM params**       | ✅ Yes     | `"chat.params"`                                  |
| **Inject HTTP headers**     | ✅ Yes     | `"chat.headers"`                                 |
| **Override permissions**    | ✅ Yes     | `"permission.ask"`                               |
| **Access config**           | ✅ Yes     | `config` hook at init + SDK client               |
| **Custom auth**             | ✅ Yes     | `auth` hook                                      |
| **Custom provider/models**  | ✅ Yes     | `provider` hook                                  |
| **Inject tools mid-step**   | ❌ No      | `Hooks.tool` read once at init                   |

---

## 4. Built-in Plugins

From `src/plugin/index.ts` line 49:

```typescript
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin, PoeAuthPlugin]
```

- **CodexAuthPlugin** (`src/plugin/codex.ts`): OAuth auth for OpenAI Codex + `chat.headers` hook
- **CopilotAuthPlugin** (`src/plugin/github-copilot/copilot.ts`): GitHub Copilot auth
- **GitlabAuthPlugin**: External `opencode-gitlab-auth`
- **PoeAuthPlugin**: External `opencode-poe-auth`

---

## 5. Example: Simplest Plugin That Adds a Tool

From `packages/plugin/src/example.ts`:

```typescript
import { Plugin } from "./index.js"
import { tool } from "./tool.js"

export const ExamplePlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string().describe("foo"),
        },
        async execute(args) {
          return `Hello ${args.foo}!`
        },
      }),
    },
  }
}
```

### The `tool()` helper

From `packages/plugin/src/tool.ts`:

```typescript
export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}) {
  return input
}
tool.schema = z

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
}
```

---

## 6. Why Deferred Tools Cannot Be a Plugin

1. **No hook to partition/filter the tool dict.** Deferred tools need to REMOVE existing tools from the dict. Plugins can only ADD.

2. **No runtime tool injection.** `Hooks.tool` is read once at init. Deferred tools needs to add tools back mid-conversation when `tool_search` executes.

3. **No access to AI SDK tool wrapper.** Deferred tools works with `AITool` objects from `tool()` in the `ai` package. Plugin tools go through `fromPlugin()` which wraps them differently.

4. **No access to the mutable `tools` dict.** The `tool_search.execute` has a closure over the local `tools: Record<string, AITool>` in `resolveTools`. No plugin hook exposes this.

5. **Threshold logic needs total tool count.** The decision `tools.length >= threshold` considers ALL tools. A plugin doesn't know the total.

**Decision:** Keep deferred tools as core feature, not plugin.

---

## 7. Relevant File Paths

| File                                   | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `packages/plugin/src/index.ts`         | Plugin types, Hooks interface                 |
| `packages/plugin/src/tool.ts`          | `tool()` helper for plugin tools              |
| `packages/plugin/src/example.ts`       | Example plugin                                |
| `src/plugin/index.ts`                  | Plugin loading, trigger mechanism             |
| `src/plugin/codex.ts`                  | CodexAuthPlugin                               |
| `src/plugin/github-copilot/copilot.ts` | CopilotAuthPlugin                             |
| `src/tool/registry.ts`                 | Where plugin tools are loaded (lines 114-119) |
| `src/session/prompt.ts`                | Where plugin hooks are triggered              |
| `src/session/llm.ts`                   | Where system transform hook is called         |
