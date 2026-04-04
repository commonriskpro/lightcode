# OpenCode Feature Factorization

## Status: ✅ IMPLEMENTED (Core)

El sistema de Tool Deferral ha sido implementado. El resto de features están pendientes.

---

## P0: Tool Deferral System + Vanilla Mode ✅ IMPLEMENTED

### Changes Made

1. **Config Schema** (`src/config/config.ts`)
   - Added `experimental.tool_deferral` config
   - `enabled`: Enable/disable deferral mode
   - `always_load`: Tools to always load (not defer)
   - `search_tool`: Include ToolSearch tool

2. **ToolSearchTool** (`src/tool/tool_search.ts`)
   - New tool for loading deferred tool definitions
   - Searches registry by tool name
   - Returns full tool definition

3. **Tool Router** (`src/session/tool-router.ts`)
   - Added deferral mode detection
   - When `enabled: true`: Uses deferral mechanism
   - When `enabled: false` (default): Vanilla mode - all tools, no filtering

4. **Registry** (`src/tool/registry.ts`)
   - Added ToolSearchTool to default tool list

5. **resolveTools** (`src/session/prompt.ts`)
   - Applies deferral schema transformation
   - Replaces full schemas with deferred hint schemas

### Usage

```jsonc
// opencode.jsonc
{
  "experimental": {
    // Default: vanilla mode - all tools sent without filtering
    // "tool_router" options are ignored

    // Enable deferral mode:
    "tool_deferral": {
      "enabled": true,
      "always_load": ["read", "glob", "grep", "bash"],
      "search_tool": true,
    },
  },
}
```

### Behavior

| Config                                   | Mode         | Behavior                                    |
| ---------------------------------------- | ------------ | ------------------------------------------- |
| `tool_deferral.enabled: false` (default) | **Vanilla**  | All tools sent, no filtering, no Xenova     |
| `tool_deferral.enabled: true`            | **Deferral** | Deferred hint schemas, ToolSearch on-demand |

---

## P1: Enhanced Hook System

### Overview

Agregar Tool Deferral como modo alternativo al router offline con embeddings. Cuando `tool_deferral.enabled: true`, el sistema Xenova se desactiva y se usa el mecanismo de carga lazy de Claude Code.

### Nueva Configuración

```typescript
// En config/config.ts - experimental.tool_deferral
experimental: {
  tool_deferral: z.object({
    enabled: z.boolean()
      .optional()
      .default(false)
      .describe(
        "When true: disable offline Xenova router and use Claude Code's tool deferral mechanism. " +
        "Tools are marked as deferrable and loaded on-demand. This replaces the local embedding router."
      ),
    always_load: z.array(z.string())
      .optional()
      .describe("Tools that should always be loaded (never deferred)."),
    search_tool: z.boolean()
      .optional()
      .default(true)
      .describe("Include ToolSearch tool for discovering deferred tools."),
  }).optional(),
}
```

### Implementation Plan

```typescript
// 1. En Tool.Info, agregar campos de deferral
export interface ToolInfo {
  id: string
  init: (ctx?) => Promise<{
    description: string
    parameters: ZodSchema
    shouldDefer?: boolean    // ⚡ NEW: Mark as deferred
    alwaysLoad?: boolean     // ⚡ NEW: Always send schema
    execute: ...
  }>
}

// 2. Modificar tool-router.ts para detectar modo deferral
export async function apply(cfg: Config.Experimental["tool_router"]) {
  // ⚡ NEW: Check if tool_deferral is enabled
  const deferralEnabled = cfg.experimental?.tool_deferral?.enabled

  if (deferralEnabled) {
    // Skip Xenova router, use deferral mechanism instead
    return applyDeferralMode(tools, allowedToolIds)
  }

  // Original: use Xenova embeddings
  return applyXenovaMode(tools, allowedToolIds, cfg)
}

// 3. applyDeferralMode implementation
function applyDeferralMode(tools: AITool[], allowedToolIds: Set<string>) {
  const alwaysLoad = cfg.experimental.tool_deferral?.always_load ?? []

  const result = {
    tools: {} as Record<string, AITool>,
    contextTier: "full" as const,
  }

  for (const [id, tool] of Object.entries(tools)) {
    if (!allowedToolIds.has(id)) continue

    const shouldDefer = !alwaysLoad.includes(id)

    if (shouldDefer) {
      // Send minimal schema with defer_loading hint
      result.tools[id] = createDeferredToolDefinition(tool)
    } else {
      result.tools[id] = tool
    }
  }

  return result
}

// 4. Crear deferred tool schema
function createDeferredToolDefinition(tool: AITool): AITool {
  return {
    ...tool,
    // El schema real se reemplaza por un hint
    parameters: {
      type: "object",
      properties: {
        __deferred: {
          type: "boolean",
          description: "Set to true to load the full tool definition via ToolSearch"
        }
      },
      required: []
    }
  }
}

// 5. ToolSearchTool - busca y carga herramientas deferidas
export const ToolSearchTool = Tool.define("tool_search", async () => ({
  description: [
    "Search for and load deferred tool definitions by name or description.",
    "",
    "Use this when you need a tool that was not attached to this message.",
    "The model will retry the original tool call after loading.",
    "",
    "Deferred tools are tools that were not included in the initial tool list",
    "to save tokens. Load them on-demand when needed.",
  ].join("\n"),
  parameters: z.object({
    query: z.string().describe("Search query to find the tool"),
  }),
  async execute(params) {
    // Buscar tools deferidas que coincidan con el query
    // Cargar sus schemas completos
    // Retornar el schema cargado
  }
}))
```

### Files to Modify

- `src/config/config.ts` - Add `experimental.tool_deferral` schema
- `src/tool/tool.ts` - Add `shouldDefer`/`alwaysLoad` to Tool.Info
- `src/session/tool-router.ts` - Add deferral mode detection
- `src/tool/registry.ts` - Handle deferred tool loading

### Files to Create

- `src/tool/tool_search.ts` - NEW: ToolSearchTool implementation

### Decision Logic

```
                        ┌─────────────────────────────────────┐
                        │     Request Incoming                │
                        └─────────────────────────────────────┘
                                          │
                                          ▼
                        ┌─────────────────────────────────────┐
                        │  experimental.tool_deferral.enabled │
                        └─────────────────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
           ┌────────────────┐  ┌──────────────────┐  ┌────────────────────┐
           │   false        │  │    true          │  │   undefined        │
           │  (default)    │  │  (deferral)      │  │   (fallback to     │
           │               │  │                  │  │    Xenova)         │
           └───────┬────────┘  └────────┬─────────┘  └─────────┬──────────┘
                   │                    │                       │
                   ▼                    ▼                       ▼
           ┌────────────────┐  ┌──────────────────┐  ┌────────────────────┐
           │ Use Xenova     │  │ Use Deferral     │  │ Use Xenova         │
           │ Router         │  │ Mechanism        │  │ Router             │
           │                │  │                  │  │                    │
           │ - intent embed│  │ - shouldDefer    │  │ (default behavior) │
           │ - keyword rules│ │ - ToolSearch     │  │                    │
           │ - exact match  │ │ - lazy loading   │  │                    │
           └────────────────┘  └──────────────────┘  └────────────────────┘
```

### Example Configuration

```jsonc
// opencode.jsonc
{
  "experimental": {
    // Option 1: Use Xenova router (default, current behavior)
    "tool_router": {
      "mode": "hybrid",
      "local_intent_embed": true,
      "local_embed": true,
    },

    // Option 2: Use Tool Deferral (replaces Xenova)
    "tool_deferral": {
      "enabled": true,
      "always_load": ["read", "glob", "grep", "bash"],
      "search_tool": true,
    },
  },
}
```

### Comparison with Xenova

| Aspect           | Xenova Router              | Tool Deferral              |
| ---------------- | -------------------------- | -------------------------- |
| **Token usage**  | Low (filtered before send) | High (all tools initially) |
| **Latency**      | Fast (local computation)   | Medium (may need re-fetch) |
| **Complexity**   | High (embeddings + rules)  | Low (simple deferral)      |
| **Accuracy**     | Good (semantic matching)   | Excellent (LLM decides)    |
| **Dependencies** | @huggingface/transformers  | None extra                 |

---

## P1: Enhanced Hook System

### Overview

Agregar la capacidad de marcar herramientas como "deferidas" - no enviar su schema inicialmente, sino cargarlo bajo demanda cuando el modelo intenta usarla.

### Implementation Plan

```typescript
// 1. Extender Tool.Info interface
export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: (ctx?: InitContext) => Promise<{
    description: string
    parameters: Parameters
    shouldDefer?: boolean    // ⚠️ NEW: Mark as deferred
    alwaysLoad?: boolean     // ⚠️ NEW: Always send schema
    execute: ...
  }>
}

// 2. Modificar tool registry para manejar deferral
export async function tools(model, agent) {
  const allTools = await getAllTools()

  return allTools.map(tool => ({
    ...tool,
    // Si shouldDefer=true, no enviar el schema completo
    // En su lugar, enviar un "defer_loading" hint
  }))
}

// 3. Crear ToolSearchTool
const ToolSearchTool = Tool.define("tool_search", async () => ({
  description: "Search and load deferred tools...",
  parameters: z.object({
    query: z.string()
  }),
  async execute(params) {
    // Buscar tools deferidas que coincidan con el query
    // Cargar sus schemas
    // Retornar el schema cargado
  }
}))
```

### Files to Modify

- `src/tool/tool.ts` - Add shouldDefer/alwaysLoad
- `src/tool/registry.ts` - Handle deferred tools
- `src/tool/tool_search.ts` - NEW file for ToolSearchTool
- `src/session/prompt.ts` - Integrate with resolveTools

### Dependencies

- Requiere integración con el provider/AI SDK para manejar el "defer loading" hint
- Probablemente necesite cambios en `src/provider/transform.ts`

---

## P1: Enhanced Hook System

### Overview

Agregar más tipos de hooks: HTTP hooks, Session hooks (efímeros), y mejorar la estructura de permisos.

### Implementation Plan

```typescript
// 1. Nuevos tipos de hooks (extender plugin/index.ts)
type HookType =
  | { type: "command"; command: string }
  | { type: "http"; url: string; method: string; headers?: Record<string, string> }
  | { type: "prompt"; prompt: string }
  | { type: "agent"; agent: string }
  | { type: "callback"; fn: Function }

// 2. Session hooks (ephemeral)
interface SessionHook {
  sessionId: string
  event: string
  matcher: string
  hooks: HookType[]
}

// 3. Hook execution con HTTP support
async function executeHook(hook: HookType, input: any) {
  switch (hook.type) {
    case "command":
      return execCommand(hook.command)
    case "http":
      return fetch(hook.url, {
        method: hook.method,
        headers: hook.headers,
        body: JSON.stringify(input),
      })
    case "prompt":
      return evaluateWithLLM(hook.prompt, input)
    case "agent":
      return delegateToAgent(hook.agent, input)
  }
}
```

### Files to Modify

- `src/plugin/index.ts` - Add new hook types
- `src/plugin/hooks/session.ts` - NEW: Session-scoped hooks
- `src/plugin/hooks/http.ts` - NEW: HTTP hooks

---

## P1: Tool Concurrency Partitioning

### Overview

Ejecutar herramientas "concurrency-safe" (read-only) en paralelo, y las que modifican estado en serie.

### Implementation Plan

```typescript
// En tool execution pipeline
async function partitionToolCalls(toolCalls: ToolCall[]): Promise<PartitionResult> {
  const safe: ToolCall[] = []
  const unsafe: ToolCall[] = []

  for (const call of toolCalls) {
    const tool = await getTool(call.name)
    if (tool.isConcurrencySafe?.(call.args)) {
      safe.push(call)
    } else {
      unsafe.push(call)
    }
  }

  return { safe, unsafe }
}

// Definir isConcurrencySafe en cada tool
const ReadTool = Tool.define("read", async () => ({
  // ...
  isConcurrencySafe: (input) => true, // ⚠️ Always safe - read only
}))

const BashTool = Tool.define("bash", async () => ({
  // ...
  isConcurrencySafe: (input) => {
    // Safe for git commands, grep, etc.
    // Unsafe for rm, mv, npm install, etc.
    return isReadOnlyCommand(input.command)
  },
}))
```

### Files to Modify

- `src/tool/tool.ts` - Add isConcurrencySafe
- `src/session/processor.ts` - Add parallel execution for safe tools

---

## P2: Agent Swarms

### Overview

Soporte para múltiples agentes trabajando coordinadamente en una tarea.

### Implementation Plan

```typescript
// Nuevos tools
const TeamCreateTool = Tool.define("team_create", async () => ({
  description: "Create a team of agents",
  parameters: z.object({
    name: z.string(),
    agents: z.array(z.string()),
  }),
  async execute(params) {
    // Crear swarm de agentes
  },
}))

const SendMessageTool = Tool.define("send_message", async () => ({
  description: "Send message to team member",
  parameters: z.object({
    to: z.string(),
    message: z.string(),
  }),
  async execute(params) {
    // Enviar mensaje a otro agente
  },
}))

const ListPeersTool = Tool.define("list_peers", async () => ({
  description: "List connected team members",
  // ...
}))
```

### Files to Create/Modify

- `src/tool/team.ts` - NEW: Team/Swarm tools
- `src/agent/agent.ts` - Add swarm modes

---

## P2: Workflow Scripts

### Overview

Permitir definir scripts de automatización reutilizables.

### Implementation Plan

```typescript
// Estructura de un workflow
interface Workflow {
  name: string
  description: string
  steps: WorkflowStep[]
}

interface WorkflowStep {
  name: string
  tool: string
  args: Record<string, any>
  condition?: string
}

// Tools para gestionar workflows
const WorkflowRunTool = Tool.define("workflow_run", async () => ({
  description: "Run a predefined workflow",
  parameters: z.object({
    name: z.string(),
    inputs: z.record(z.any()).optional(),
  }),
}))

const WorkflowListTool = Tool.define("workflow_list", async () => ({
  // List available workflows
}))
```

---

## P3: Cron Jobs

### Overview

Agregar herramientas para programar tareas periódicas.

### Implementation Plan

```typescript
const CronCreateTool = Tool.define("cron_create", async () => ({
  description: "Create a scheduled task",
  parameters: z.object({
    name: z.string(),
    schedule: z.string(), // cron expression
    action: z.string(),
  }),
}))

const CronListTool = Tool.define("cron_list", async () => ({
  description: "List scheduled tasks",
}))

const CronDeleteTool = Tool.define("cron_delete", async () => ({
  description: "Delete a scheduled task",
}))
```

---

## P3: Web Browser Tool

### Overview

Automación de navegador para interacción con sitios web.

### Implementation Plan

```typescript
const WebBrowserTool = Tool.define("browser", async () => ({
  description: "Control a web browser",
  parameters: z.object({
    action: z.enum(["goto", "click", "type", "screenshot", "extract"]),
    url: z.string().optional(),
    selector: z.string().optional(),
    text: z.string().optional(),
  }),
}))
```

---

## Implementation Order

```
Phase 1: Foundation (P0 + P1)
├── P0: Tool Deferral System
│   ├── Add shouldDefer/alwaysLoad to Tool.Info
│   ├── Create ToolSearchTool
│   └── Integrate with resolveTools
│
└── P1: Enhanced Hook System
    ├── Add HTTP hook type
    ├── Add session hooks
    └── Improve permission resolution

Phase 2: Execution Optimization (P1)
└── P1: Tool Concurrency Partitioning
    ├── Add isConcurrencySafe to tools
    └── Implement parallel execution

Phase 3: Multi-Agent (P2)
├── P2: Agent Swarms
└── P2: Workflow Scripts

Phase 4: Advanced Tools (P3)
├── P3: Cron Jobs
└── P3: Web Browser Tool
```

---

## Notes

- Tool Deferral y Offline Routing NO son mutuamente excluyentes - se pueden usar juntos
- Tool Concurrency Partitioning tiene el mejor ratio esfuerzo/beneficio
- Agent Swarms requiere diseño cuidadoso de la arquitectura de comunicación entre agentes
