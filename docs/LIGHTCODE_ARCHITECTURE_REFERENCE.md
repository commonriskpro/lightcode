# LightCode v2 Arquitectura de Referencia

> **Estado:** Documento vivo — última actualización Abril 2026
> **Basado en:** Inspección directa del código fuente en `packages/opencode/src/`
> **Alcance:** Arquitectura completa + Sistema de Memoria exhaustivo

---

## 1. Visión General de Arquitectura

### 1.1 Stack Tecnológico

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│  packages/app      │  packages/desktop  │  packages/opencode (CLI)  │
│  React + Vite      │  Tauri (Rust)      │  Bun + TypeScript        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP/WebSocket
┌────────────────────────────▼────────────────────────────────────────┐
│                      SERVER LAYER                                    │
├─────────────────────────────────────────────────────────────────────┤
│  packages/opencode/src/server/server.ts (Hono + Bun)                 │
│  - REST API (sesiones, mensajes, herramientas)                       │
│  - WebSocket (/event, /global/event) para eventos en tiempo real   │
│  - Middleware: CORS, Basic Auth, Compresión                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                     RUNTIME LAYER                                    │
├─────────────────────────────────────────────────────────────────────┤
│  packages/opencode/src/                                             │
│  ├── session/     │ Proceso principal de conversación                │
│  ├── memory/      │ Sistema de memoria (CORE V3)                    │
│  ├── agent/      │ Definición de agentes                            │
│  ├── tool/       │ Registro y ejecución de herramientas             │
│  ├── provider/   │ Modelos LLM (Anthropic, OpenAI, Google, etc.)   │
│  ├── storage/    │ libSQL + Drizzle ORM                             │
│  └── effect/     │ Effect.ts para composición funcional             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                      STORAGE LAYER                                   │
├─────────────────────────────────────────────────────────────────────┤
│  packages/opencode/src/storage/db.ts                                │
│  - libSQL local con WAL mode                                        │
│  - Drizzle ORM                                                      │
│  - Migraciones en packages/opencode/migration/                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Flujo de Datos End-to-End

```
Usuario Input
     │
     ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ CLI/UI Layer    │───▶│ Server (Hono)    │───▶│ Session Prompt  │
│ run.ts:306-675  │    │ server.ts:39-312  │    │ prompt.ts:1551  │
└─────────────────┘    └──────────────────┘    └────────┬────────┘
                                                       │
                        ┌──────────────────────────────┘
                        ▼
          ┌─────────────────────────────────┐
          │      Memory.buildContext()       │
          │     provider.ts:61-111            │
          └─────────────┬───────────────────┘
                        │
          ┌─────────────┼─────────────┬──────────────┐
          ▼             ▼             ▼              ▼
   ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌────────────┐
   │ Working    │ │Observa-   │ │Semantic  │ │  Fork/     │
   │ Memory     │ │tional Mem │ │ Recall   │ │  Handoff   │
   │ (WM)       │ │ (OM)      │ │ (FTS5)   │ │ (DB)       │
   └────────────┘ └───────────┘ └──────────┘ └────────────┘
                        │
                        ▼
          ┌─────────────────────────────────┐
          │   System Prompt Assembly         │
          │   prompt.ts:1983-2012             │
          └─────────────┬───────────────────┘
                        │
                        ▼
          ┌─────────────────────────────────┐
          │      LLM.stream()                │
          │   llm.ts:1-500 (proveedor)       │
          └─────────────┬───────────────────┘
                        │
          ┌─────────────┴─────────────┐
          ▼                         ▼
   ┌─────────────────┐      ┌─────────────────┐
   │ Tool Execution  │      │ OM Observer     │
   │ registry.ts    │      │ prompt.ts:1643  │
   └────────┬────────┘      └────────┬────────┘
            │                        │
            ▼                        ▼
   ┌─────────────────────────────────────────┐
   │        Response → Usuario               │
   └─────────────────────────────────────────┘
```

### 1.3 Directorio de Paquetes

```
packages/
├── app/           → Frontend React (UI del IDE)
├── desktop/       → Tauri app wrapper
├── desktop-electron/ → Electron wrapper (legacy)
├── console/       → Backend cloud (SST)
├── web/           → Web components
├── opencode/      → CORE: CLI, Server, Runtime, Memory
├── plugin/        → Sistema de plugins
├── ui/            → Componentes UI compartidos
├── sdk/           → SDK JS para clientes
├── storybook/     → Documentación visual
├── util/          → Utilidades globales
├── function/     → Cloud functions
├── identity/      → Auth
├── slack/         → Integración Slack
├── script/        → Scripts de build
├── enterprise/    → Features enterprise
└── extensions/    → Extensiones VSCode, Zed
```

---

## 2. Capas de Arquitectura

### 2.1 CLI/UI Layer

**Entry point:** `packages/opencode/src/cli/cmd/run.ts`

```typescript
// run.ts:306 - entry del handler
handler: async (args) => {
  const directory = (() => {
    /* ... */
  })()
  const files = (() => {
    /* ... */
  })()

  // Bootstrap abre la base de datos, inicializa el servidor
  await bootstrap(process.cwd(), async () => {
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      return Server.Default().fetch(request)
    }) as typeof globalThis.fetch

    const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })
    await execute(sdk)
  })
}
```

**Flujo:**

1. Parsea argumentos (message, session, fork, model, agent, etc.)
2. Crea o reutiliza sesión via SDK
3. Suscribe a eventos WebSocket
4. Envía prompt o comando
5. Renderiza output (TUI o JSON)

### 2.2 Server Layer

**Archivo:** `packages/opencode/src/server/server.ts`

```
┌────────────────────────────────────────────────────────────┐
│                    Server.Default()                        │
├────────────────────────────────────────────────────────────┤
│  routes/                                                  │
│  ├── global.ts      → /global/* (auth, sessions list)    │
│  ├── instance/      → /session/* (per-instance)          │
│  ├── router.ts      → Workspace middleware              │
│  └── projector.ts   → Event projection                  │
├────────────────────────────────────────────────────────────┤
│  middleware/                                               │
│  ├── errorHandler.ts  → Error handling                    │
│  └── cors.ts         → CORS config                       │
├────────────────────────────────────────────────────────────┤
│  Routes principales:                                      │
│  POST /session/:id/prompt_async → async queue enqueue    │
│  POST /session/:id/steer_async  → active turn steering   │
│  POST /session/:id/message      → message-v2.ts          │
│  GET  /session/:id/events       → WebSocket /event       │
│  GET  /global/sessions          → session/index.ts       │
└────────────────────────────────────────────────────────────┘
```

### 2.3 Session Layer

**Archivos principales:**

- `packages/opencode/src/session/index.ts` (887 líneas)
- `packages/opencode/src/session/prompt.ts` (2592 líneas)
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/session/schema.ts`

```typescript
// session/index.ts:39 - Interface pública
export interface Interface {
  readonly create: (input?) => Effect.Effect<Info>
  readonly fork: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Info>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info>
  readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<MessageV2.WithParts[]>
  readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
  readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  // ... más métodos
}

// session/prompt.ts - Run loop principal
const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(function* (
  input: PromptInput,
) {
  const session = yield* sessions.get(input.sessionID)
  yield* Effect.promise(() => SessionRevert.cleanup(session))
  const message = yield* createUserMessage(input)
  yield* sessions.touch(input.sessionID)
  // ...
  return yield* loop({ sessionID: input.sessionID })
})
```

### Cola async y steer del turno activo

- `prompt_async` ya no intenta resolver la respuesta en la misma request: encola el turno y devuelve `204`
- `steer_async` representa una intervención sobre el turno activo; si no hay runner activo, cae a enqueue normal
- la cola FIFO se calcula por consumo real del turno (`assistant.parentID`), no por timestamps ni por ids
- la TUI representa esto con badges `QUEUED` y `STEERED`

### 2.4 Agent Layer

**Archivo:** `packages/opencode/src/agent/agent.ts`

```typescript
// agent.ts:108-243 - Agentes definidos
const agents: Record<string, Info> = {
  build: {
    name: "build",
    description: "The default agent. Executes tools based on configured permissions.",
    mode: "primary",
    native: true,
  },
  plan: {
    name: "plan",
    description: "Plan mode. Disallows all edit tools.",
    mode: "primary",
    native: true,
  },
  general: {
    name: "general",
    description: "General-purpose agent for researching complex questions...",
    mode: "subagent",
    native: true,
  },
  explore: {
    name: "explore",
    description: "Fast agent specialized for exploring codebases...",
    mode: "subagent",
    native: true,
  },
  // ...
}
```

### 2.5 Tool Layer

**Archivo:** `packages/opencode/src/tool/registry.ts`

```typescript
// registry.ts:161-193 - Registro de herramientas
const all = Effect.fn("ToolRegistry.all")(function* (custom: Tool.Info[]) {
  const cfg = yield* config.get()
  return [
    safe(invalid),
    ...(question ? [ask] : []),
    bash,
    safe(read),
    safe(glob),
    safe(grep),
    edit,
    defer(write, "Create or overwrite entire files"),
    defer(task, "Delegate focused subtasks to subagents..."),
    defer(safe(skill), "Load specialized workflow instructions..."),
    defer(safe(fetch), "Fetch URL content as markdown..."),
    defer(todo, "Create and manage todo lists"),
    defer(safe(search), "Web search via Exa"),
    defer(safe(code), "Search code via Context7"),
    defer(safe(recall), "Retrieve source messages..."),
    defer(safe(updateWorkingMemory), "Persist stable facts..."),
    defer(safe(updateUserMemory), "Persist user-wide preferences..."),
    // ...
  ]
})
```

### 2.6 Storage Layer

**Archivo:** `packages/opencode/src/storage/db.ts`

```typescript
// db.ts:85-116 - Inicialización de base de datos
export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply schema migrations
  const entries = migrations(path.join(import.meta.dirname, "../../migration"))
  migrate(db, entries)

  return db
})

// db.ts:130-142 - Uso de base de datos con contexto
export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof Context.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}
```

---

## 3. Sistema de Memoria (Exhaustivo)

### 3.1 Arquitectura General del Sistema de Memoria

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MEMORY PROVIDER (provider.ts)                    │
│              API unificada: Memory.buildContext()                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │   WORKING MEMORY   │  │ OBSERVATIONAL    │  │ SEMANTIC      │   │
│  │    (structured)    │  │    MEMORY        │  │    RECALL     │   │
│  │                    │  │   (narrative)     │  │   (search)    │   │
│  │ • facts            │  │                  │  │               │   │
│  │ • goals            │  │ • observations   │  │ • FTS5 search │   │
│  │ • constraints      │  │ • reflections    │  │ • topic_key   │   │
│  │ • decisions        │  │ • current_task   │  │ • dedupe      │   │
│  │ • preferences      │  │ • continuation   │  │ • recent()    │   │
│  └────────┬───────────┘  └────────┬─────────┘  └──────┬────────┘   │
│           │                       │                   │            │
│           │         ┌─────────────┴──────────────┐    │            │
│           │         ▼                            ▼    ▼            │
│           │    ┌─────────────────────────────────────┐              │
│           │    │         OM (Observational)         │              │
│           │    │   ┌─────────┐  ┌─────────┐         │              │
│           │    │   │ OMBuf   │  │Observer │         │              │
│           │    │   │(buffer) │  │(extract)│         │              │
│           │    │   └─────────┘  └─────────┘         │              │
│           │    │   ┌─────────┐  ┌─────────┐         │              │
│           │    │   │Reflector│  │ Record  │         │              │
│           │    │   │(compress│  │  (DB)   │         │              │
│           │    │   └─────────┘  └─────────┘         │              │
│           │    └─────────────────────────────────────┘              │
│           │                                                         │
│           ▼                                                         ▼
│  ┌─────────────────────────────────────────────────────────────────┐
│  │                     SCOPE MODEL (contracts.ts)                  │
│  │   thread > agent > project > user > global_pattern              │
│  │   Precedencia: scope más específico wins                         │
│  └─────────────────────────────────────────────────────────────────┘
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐
│  │                     HANDOOK / FORK (handoff.ts)                  │
│  │   • writeFork() - contexto de fork padre→hijo                   │
│  │   • writeHandoff() - snapshot WM + OM en handoff               │
│  │   • getHandoff() / getFork() - recuperación post-restart        │
│  └─────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Memory Provider (API Central)

**Archivo:** `packages/opencode/src/memory/provider.ts`

```typescript
// provider.ts:1-30 - Exports del módulo
export namespace Memory {
  // Scope factories
  export function userScope(id = DEFAULT_USER_SCOPE_ID): ScopeRef {
    return { type: "user", id }
  }

  // buildContext: composición de todas las capas
  export async function buildContext(opts: ContextBuildOptions): Promise<MemoryContext> {
    const wBudget = opts.workingMemoryBudget ?? 2000
    const oBudget = opts.observationsBudget ?? 4000
    const rBudget = opts.semanticRecallBudget ?? 2000

    const allScopes = [opts.scope, ...(opts.ancestorScopes ?? [])]

    // Carga paralela de todas las capas
    const [wRecords, omRec, ftsArtifacts] = await Promise.all([
      Promise.resolve(WorkingMemory.getForScopes(opts.scope, opts.ancestorScopes ?? [])),
      Promise.resolve(
        opts.scope.type === "thread"
          ? (OM.get(opts.scope.id as SessionID) as ObservationRecord | undefined)
          : undefined,
      ),
      opts.semanticQuery
        ? (await getBackend()).search(opts.semanticQuery, allScopes, 10) // HybridBackend (FTS5 + embeddings via RRF)
        : Promise.resolve([] as MemoryArtifact[]),
    ])

    // Fallback: si hybrid search devuelve 0, usar FTS5Backend.recent()
    const artifacts = ftsArtifacts.length === 0 && opts.semanticQuery ? fts.recent(allScopes, 5) : ftsArtifacts

    // Formateo con token budgets
    const rawWM = WorkingMemory.format(wRecords, wBudget)
    const workingMemory = rawWM ? wrapWorkingMemory(rawWM, opts.scope.type) : undefined

    const rawObs = omRec ? formatObservations(omRec, oBudget) : undefined
    const observations = rawObs ?? undefined

    const rawRecall = artifacts.length ? format(artifacts, rBudget) : undefined
    const semanticRecall = rawRecall ? wrapSemanticRecall(rawRecall) : undefined

    return {
      recentHistory: undefined,
      workingMemory,
      observations,
      semanticRecall,
      continuationHint: omRec?.suggested_continuation ?? undefined,
      totalTokens,
    }
  }

  // Working Memory API
  export function setWorkingMemory(scope: ScopeRef, key: string, value: string, format?): void
  export function setUserMemory(key: string, value: string, format?, id?): void
  export function getWorkingMemory(scope: ScopeRef, key?: string): WorkingMemoryRecord[]

  // Observational Memory API
  export function getObservations(sessionId: string): ObservationRecord | undefined

  // Semantic Recall API
  export function searchArtifacts(query: string, scopes: ScopeRef[], limit?): MemoryArtifact[]
  export function indexArtifact(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): string

  // Handoff/Fork API
  export function getHandoff(childSessionId: string): AgentHandoff | undefined
  export function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): string
  export function getForkContext(sessionId: string): ForkContext | undefined
  export function writeForkContext(ctx: Omit<ForkContext, "id" | "time_created">): void
}
```

### 3.3 Contratos y Tipos

**Archivo:** `packages/opencode/src/memory/contracts.ts`

```typescript
// contracts.ts:8-36 - Modelo de Scopes
/**
 * Memory scope types — ordered from most specific to least specific.
 * Precedence in getForScopes(): thread > agent > project > user > global_pattern.
 *
 * Operational status:
 * - "thread"         OPERATIONAL — per-session memory
 * - "agent"          OPERATIONAL — per-agent memory across sessions
 * - "project"        OPERATIONAL — shared across all agents/sessions
 * - "user"           OPERATIONAL — user-wide durable memory
 * - "global_pattern" DORMANT — reserved for cross-project patterns
 */
export type MemoryScope = "thread" | "agent" | "project" | "user" | "global_pattern"

export interface ScopeRef {
  type: MemoryScope
  id: string
}

// contracts.ts:40-53 - MemoryContext
export interface MemoryContext {
  recentHistory: string | undefined // assembler por caller
  workingMemory: string | undefined // structured state
  observations: string | undefined // compressed narrative
  semanticRecall: string | undefined // similarity-based
  continuationHint: string | undefined // from OM
  totalTokens: number
}

// contracts.ts:55-64 - ContextBuildOptions
export interface ContextBuildOptions {
  scope: ScopeRef
  ancestorScopes?: ScopeRef[]
  recentHistoryLimit?: number
  workingMemoryBudget?: number
  observationsBudget?: number
  semanticRecallBudget?: number
  semanticQuery?: string
  includeGlobalPatterns?: boolean
}
```

### 3.4 Working Memory (Almacenamiento Estructurado)

**Archivo:** `packages/opencode/src/memory/working-memory.ts`

```typescript
// working-memory.ts:30-79 - Namespace WorkingMemory
export namespace WorkingMemory {
  /**
   * Get working memory records for a chain of scopes.
   * Returns records from all scopes in precedence order: most-specific first.
   * When the same key appears in multiple scopes, most specific wins.
   *
   * Precedence: thread > agent > project > user > global_pattern
   */
  export function getForScopes(primary: ScopeRef, ancestors: ScopeRef[]): WorkingMemoryRecord[] {
    const all = [primary, ...ancestors].flatMap((s) => get(s))
    // Deduplicate by logical key name across scopes
    // Bug fix: previous key was "${scope_type}:${key}" - wrong!
    // Fixed: key is just "r.key" so thread overrides project correctly
    const seen = new Set<string>()
    return all.filter((r) => {
      if (seen.has(r.key)) return false
      seen.add(r.key)
      return true
    })
  }

  /**
   * Upsert a working memory key in a scope.
   * If key exists: update value, increment version, update time_updated
   * If key doesn't exist: insert new record
   */
  export function set(scope: ScopeRef, key: string, value: string, format = "markdown"): void {
    const safe = scope.type === "global_pattern" ? stripPrivate(value) : value
    const now = nowMs()

    Database.transaction(() => {
      const existing = Database.use((db) =>
        db
          .select({ id: WorkingMemoryTable.id, version: WorkingMemoryTable.version })
          .from(WorkingMemoryTable)
          .where(
            and(
              eq(WorkingMemoryTable.scope_type, scope.type),
              eq(WorkingMemoryTable.scope_id, scope.id),
              eq(WorkingMemoryTable.key, key),
            ),
          )
          .get(),
      )

      if (existing) {
        Database.use((db) =>
          db
            .update(WorkingMemoryTable)
            .set({ value: safe, format, version: existing.version + 1, time_updated: now })
            .where(eq(WorkingMemoryTable.id, existing.id))
            .run(),
        )
      } else {
        Database.use((db) =>
          db
            .insert(WorkingMemoryTable)
            .values({
              id: newId(),
              scope_type: scope.type,
              scope_id: scope.id,
              key,
              value: safe,
              format,
              version: 1,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      }
    })
  }

  // Formateo para injection en prompt
  export function format(records: WorkingMemoryRecord[], budget: number): string | undefined {
    if (!records.length) return undefined

    const parts: string[] = []
    let used = 0

    for (const r of records) {
      const entry = `### ${r.key} (${r.scope_type})\n${r.value}`
      const est = Token.estimate(entry)
      if (used + est > budget) break
      parts.push(entry)
      used += est
    }

    if (!parts.length) return undefined
    return parts.join("\n\n")
  }
}
```

### 3.5 Schema SQL de Working Memory

**Archivo:** `packages/opencode/src/memory/schema.sql.ts`

```sql
-- working-memory.ts:13-35
CREATE TABLE memory_working (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,        -- thread|agent|project|user|global_pattern
  scope_id TEXT NOT NULL,          -- ID del scope (session ID, agent name, project ID, etc)
  key TEXT NOT NULL,               -- clave logical (e.g., "goals", "constraints")
  value TEXT NOT NULL,             -- contenido
  format TEXT DEFAULT 'markdown',  -- markdown|json
  version INTEGER DEFAULT 1,      -- version counter
  time_created INTEGER NOT NULL,   -- timestamp
  time_updated INTEGER NOT NULL    -- timestamp
);

-- Índices
UNIQUE INDEX idx_wm_scope_key ON memory_working (scope_type, scope_id, key);
INDEX idx_wm_scope ON memory_working (scope_type, scope_id);
INDEX idx_wm_updated ON memory_working (time_updated);
```

### 3.6 Herramientas de Working Memory

**Archivo:** `packages/opencode/src/tool/memory.ts`

```typescript
// memory.ts:23-65 - UpdateWorkingMemoryTool
export const UpdateWorkingMemoryTool = Tool.define("update_working_memory", {
  "Store or update a persistent fact, goal, constraint, or architectural decision in working memory.",
  // ...
  parameters: {
    scope: enum("thread", "agent", "project"),  // scope type
    key: string,                                  // short identifier
    value: string,                                // content
    label: optional(string),                      // description
  }
})

// execution: Memory.setWorkingMemory(scopeRef, key, value)

// memory.ts:71-108 - UpdateUserMemoryTool
export const UpdateUserMemoryTool = Tool.define("update_user_memory", {
  "Durable user-wide memory content. Keep it concise, stable, and non-sensitive.",
  // ...
  parameters: {
    key: string,           -- short identifier
    value: string,         -- content
  }
})

// execution: Memory.setUserMemory(key, value)
```

### 3.7 Semantic Recall (Búsqueda Híbrida: FTS5 + Embeddings via RRF)

**Archivos:**

- `packages/opencode/src/memory/fts5-backend.ts` — FTS5 lexical backend
- `packages/opencode/src/memory/embedding-backend.ts` — libSQL native vector backend
- `packages/opencode/src/memory/hybrid-backend.ts` — RRF composition (k=60)

```typescript
// fts5-backend.ts - class FTS5Backend (async RecallBackend implementation)

/**
 * Index a memory artifact.
 * Implements:
 * 1. Topic-key upsert (same topic_key → revision_count++)
 * 2. Hash dedupe within 15-min window (same hash → duplicate_count++)
 * 3. Insert new artifact if no match
 *
 * When routed through HybridBackend.index(), the EmbeddingBackend
 * additionally persists the embedding on `memory_artifacts.embedding`.
 */
async index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): Promise<string> {
  const content =
    artifact.content.length > MAX_CONTENT_LENGTH
      ? artifact.content.slice(0, MAX_CONTENT_LENGTH) + "... [truncated]"
      : artifact.content

  const hash = hashContent(content)
  const topicKey = normalizeTopicKey(artifact.topic_key)
  const now = Date.now()

  Database.transaction(() => {
    // 1. Topic-key upsert
    if (topicKey) {
      const existing = Database.use((db) =>
        db
          .select({ id: MemoryArtifactTable.id, revision_count: MemoryArtifactTable.revision_count })
          .from(MemoryArtifactTable)
          .where(
            and(
              eq(MemoryArtifactTable.topic_key, topicKey),
              eq(MemoryArtifactTable.scope_type, artifact.scope_type),
              eq(MemoryArtifactTable.scope_id, artifact.scope_id),
              isNull(MemoryArtifactTable.deleted_at),
            ),
          )
          .orderBy(sql`${MemoryArtifactTable.time_updated} DESC`)
          .limit(1)
          .get(),
      )

      if (existing) {
        // Update with revision_count++
        Database.use((db) =>
          db
            .update(MemoryArtifactTable)
            .set({
              title: artifact.title,
              content,
              type: artifact.type,
              normalized_hash: hash,
              revision_count: existing.revision_count + 1,
              last_seen_at: now,
              time_updated: now,
            })
            .where(eq(MemoryArtifactTable.id, existing.id))
            .run(),
        )
        return
      }
    }

    // 2. Hash dedupe within 15-min window
    const windowStart = now - DEDUPE_WINDOW_MS // 15 * 60 * 1000
    const dup = Database.use((db) =>
      db
        .select({ id: MemoryArtifactTable.id, duplicate_count: MemoryArtifactTable.duplicate_count })
        .from(MemoryArtifactTable)
        .where(
          and(
            eq(MemoryArtifactTable.normalized_hash, hash),
            eq(MemoryArtifactTable.scope_type, artifact.scope_type),
            eq(MemoryArtifactTable.scope_id, artifact.scope_id),
            eq(MemoryArtifactTable.type, artifact.type),
            isNull(MemoryArtifactTable.deleted_at),
            sql`${MemoryArtifactTable.time_created} >= ${windowStart}`,
          ),
        )
        .orderBy(sql`${MemoryArtifactTable.time_created} DESC`)
        .limit(1)
        .get(),
    )

    if (dup) {
      // Increment duplicate_count
      Database.use((db) =>
        db
          .update(MemoryArtifactTable)
          .set({ duplicate_count: dup.duplicate_count + 1, last_seen_at: now, time_updated: now })
          .where(eq(MemoryArtifactTable.id, dup.id))
          .run(),
      )
      return
    }

    // 3. Insert new artifact
    const id = nowId()
    Database.use((db) =>
      db
        .insert(MemoryArtifactTable)
        .values({
          id,
          scope_type: artifact.scope_type,
          scope_id: artifact.scope_id,
          type: artifact.type,
          title: artifact.title,
          content,
          topic_key: topicKey,
          normalized_hash: hash,
          revision_count: 1,
          duplicate_count: 1,
          last_seen_at: now,
          deleted_at: null,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
  })

  return resultId
}

/**
 * Search memory artifacts using FTS5 full-text search.
 * TWO-PASS strategy for production-quality recall:
 *
 * Pass 1: High-precision AND mode (all tokens quoted, exact match)
 *   "auth" "JWT" "tokens" → document must contain ALL tokens exactly
 *   Best for short, precise queries. High precision, lower recall.
 *
 * Pass 2: High-recall prefix-OR mode (fallback when AND returns 0)
 *   auth* OR JWT* OR tokens* → document needs ANY prefix match
 *   Catches "authentication" from "auth*", "authorization" from "auth*"
 *   Much higher recall for natural language queries.
 */
export function search(query: string, scopes: ScopeRef[], limit = 10): MemoryArtifact[] {
  if (!query.trim() || !scopes.length) return []

  const results: ArtifactSearchResult[] = []
  const seen = new Set<string>()

  // Direct topic_key match (Engram-style: "/" in query = topic_key lookup)
  if (query.includes("/")) {
    const topicResults = Database.use((db) =>
      db
        .select()
        .from(MemoryArtifactTable)
        .where(and(eq(MemoryArtifactTable.topic_key, query.trim()), isNull(MemoryArtifactTable.deleted_at)))
        .orderBy(sql`${MemoryArtifactTable.time_updated} DESC`)
        .limit(limit)
        .all(),
    )
    for (const r of topicResults) {
      if (!seen.has(r.id)) {
        results.push({ ...r, rank: -1000 })
        seen.add(r.id)
      }
    }
  }

  // FTS5 two-pass search strategy
  const ftsQueryAnd = sanitizeFTS(query) // "auth" "JWT" "tokens"
  const ftsQueryOr = sanitizeFTSPrefix(query) // auth* OR JWT* OR tokens*

  // Pass 1: AND mode
  if (ftsQueryAnd) {
    try {
      const andResults = runFTSQuery(ftsQueryAnd)
      for (const r of andResults) {
        if (!seen.has(r.id)) {
          results.push(r)
          seen.add(r.id)
        }
      }
    } catch (err) {
      /* ignore FTS errors */
    }

    // Pass 2: OR mode fallback — only if AND returned 0 new results
    if (results.length === 0 && ftsQueryOr) {
      try {
        const orResults = runFTSQuery(ftsQueryOr)
        for (const r of orResults) {
          if (!seen.has(r.id)) {
            results.push(r)
            seen.add(r.id)
          }
        }
      } catch (err) {
        /* ignore FTS errors */
      }
    }
  }

  return results.slice(0, limit) as MemoryArtifact[]
}

// Helper: sanitizar queries para FTS5
function sanitizeFTS(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(" ") // implicit AND
}

function sanitizeFTSPrefix(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .map((t) => `${t}*`)
    .join(" OR ")
}
```

### 3.8 Schema SQL de Semantic Recall

```sql
-- schema.sql.ts:39-69
CREATE TABLE memory_artifacts (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,           -- thread|agent|project|user|global_pattern
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL,                 -- observation|working_memory|handoff|pattern|decision
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,                    -- para upserts y lookups
  normalized_hash TEXT,              -- SHA256 para deduplicación
  revision_count INTEGER DEFAULT 1,  -- increments on topic_key upsert
  duplicate_count INTEGER DEFAULT 1, -- increments on hash dedupe
  last_seen_at INTEGER,
  deleted_at INTEGER,                -- soft delete
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- Tabla virtual FTS5 para full-text search
CREATE VIRTUAL TABLE memory_artifacts_fts USING fts5(
  title, content,
  content='memory_artifacts',
  content_rowid='rowid'
);

-- Índices
INDEX idx_art_scope ON memory_artifacts (scope_type, scope_id);
INDEX idx_art_topic ON memory_artifacts (topic_key, scope_type, scope_id);
INDEX idx_art_type ON memory_artifacts (type);
INDEX idx_art_hash ON memory_artifacts (normalized_hash, scope_type, scope_id);
INDEX idx_art_deleted ON memory_artifacts (deleted_at);
INDEX idx_art_created ON memory_artifacts (time_created);
```

### 3.9 Observational Memory (OM) - Sistema de Captura de Contexto

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OM (Observational Memory)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    OMBuf (buffer.ts)                          │ │
│  │                                                               │ │
│  │  type State = { tok: number; pending: boolean; lastInterval } │ │
│  │                                                               │ │
│  │  check(sid, tok, obsTokens?) → "idle" | "buffer" | "activate"│ │
│  │              │ "block"                                        │ │
│  │                                                               │ │
│  │  Thresholds:                                                  │ │
│  │    - INTERVAL = 6,000 tokens (fire "buffer" once)            │ │
│  │    - TRIGGER = 80,000-140,000 (adaptive, "activate")         │ │
│  │    - BLOCK_AFTER = 180,000 tokens ("block" - sync)           │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│                              │                                      │
│              ┌───────────────┼───────────────┐                     │
│              ▼               ▼               ▼                     │
│  ┌──────────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │     "idle"       │ │  "buffer"  │ │ "activate"  │ "block"       │
│  │   no-op          │ │  async     │ │ fork async  │ fork blocking │
│  └──────────────────┘ │  Observer  │ │ +Reflector  │ +Reflector    │
│                        └─────────────┘ └─────────────┘               │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 Observer (observer.ts)                        │ │
│  │                                                               │ │
│  │  run({sid, msgs, prev, priorCurrentTask})                    │ │
│  │                                                               │ │
│  │  1. Filter msgs to user|assistant                             │ │
│  │  2. Extract text + completed tool outputs                     │ │
│  │  3. Call LLM with PROMPT (extract observations)               │ │
│  │  4. Parse output: <observations>, <current-task>,           │ │
│  │                 <suggested-response>                           │ │
│  │  5. Wrap in observation group markers                        │ │
│  │  6. Return ObserverResult                                    │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 Record (record.ts)                             │ │
│  │                                                               │ │
│  │  addBuffer(buf): insert buffer chunk                         │ │
│  │  addBufferSafe(buf, sid, msgIds): ATOMIC buffer+observed      │ │
│  │  activate(sid): condense buffers → merge → delete buffers    │ │
│  │  reflect(sid, txt): compress observations → reflections      │ │
│  │  get(sid): retrieve observation record                       │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │               Reflector (reflector.ts)                        │ │
│  │                                                               │ │
│  │  run(sid):                                                    │ │
│  │  1. If observation_tokens > 120,000:                         │ │
│  │  2. Call LLM with compression prompt (5 levels)             │ │
│  │  3. Compress observations → reflections                      │ │
│  │  4. Preserve completion markers ✅                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.10 OMBuf - Buffer de Acumulación de Tokens

**Archivo:** `packages/opencode/src/session/om/buffer.ts`

```typescript
// buffer.ts:27-64 - OMBuf.check
export namespace OMBuf {
  const INTERVAL = 6_000
  const BLOCK_AFTER = 180_000
  const DEFAULT_RANGE: ThresholdRange = { min: 80_000, max: 140_000 }

  export function check(
    sid: SessionID,
    tok: number,
    obsTokens?: number,
    configThreshold?: number | ThresholdRange,
    blockAfter?: number,
  ): "buffer" | "activate" | "block" | "idle" {
    const s = ensure(sid)
    s.tok += tok

    // Dynamic threshold: shrink as observations grow
    const base = configThreshold ?? DEFAULT_RANGE
    const trigger =
      obsTokens !== undefined ? calculateDynamicThreshold(base, obsTokens) : typeof base === "number" ? base : base.max

    const limit = blockAfter ?? BLOCK_AFTER

    if (s.tok >= limit) return "block"
    if (s.tok >= trigger) return "activate"

    // Fire "buffer" only on new INTERVAL boundary
    const intervals = Math.floor(s.tok / INTERVAL)
    const lastIntervals = Math.floor(s.lastInterval / INTERVAL)
    if (intervals > lastIntervals) {
      s.lastInterval = s.tok
      return "buffer"
    }
    return "idle"
  }

  // Dynamic threshold calculation
  export function calculateDynamicThreshold(threshold: number | ThresholdRange, obsTokens: number): number {
    if (typeof threshold === "number") return threshold
    return Math.max(threshold.min, threshold.max - obsTokens)
  }
}
```

### 3.11 Observer - Extracción de Observaciones

**Archivo:** `packages/opencode/src/session/om/observer.ts`

```typescript
// observer.ts:245-329 - Observer.run
export namespace Observer {
  const PROMPT = `You are an observation agent. Extract facts from the conversation below as a structured observation log.

  ## Assertion vs Question
  - 🔴 User assertions (FACTS the user stated): "I work at Acme", "the app uses PostgreSQL"
  - 🟡 User requests/questions: "Can you help me...", "What's the best way to..."

  ## STATE CHANGES
  When a user indicates a change from X to Y, frame it explicitly:
  - "User will use Svelte (replacing React)"
  - "User now works at NewCo (previously OldCo)"
  - Mark the old value superseded: "~old fact~ → new fact"

  ## Temporal Anchoring
  - Resolve relative dates to absolute (e.g. "yesterday" → 2026-04-03)
  - Include timestamps when messages carry them

  ## Output Format
  <observations>
  Date: [resolved date]
  * 🔴 HH:MM [user assertion — specific, with preserved details]
  * 🟡 HH:MM [user request — only if it reveals intent]
  </observations>

  <current-task>
  State what the agent is currently working on (1-2 sentences).
  </current-task>

  <suggested-response>
  Hint for the agent's next message to continue naturally (1 sentence).
  </suggested-response>`

  export async function run(input: {
    sid: SessionID
    msgs?: MessageV2.WithParts[]
    prev?: string
    prevBudget?: number | false
    priorCurrentTask?: string
  }): Promise<ObserverResult | undefined> {
    const cfg = await Config.get()
    if (cfg.experimental?.observer === false) return undefined

    const modelStr = cfg.experimental?.observer_model ?? "google/gemini-2.5-flash"

    // Resolve model via Provider
    const parsed = Provider.parseModel(modelStr)
    const model = await Provider.getModel(parsed.providerID, parsed.modelID).catch(...)
    if (!model) return undefined

    const language = await Provider.getLanguage(model).catch(...)
    if (!language) return undefined

    // Build context: filter msgs to user|assistant, extract text+tool outputs
    const context = (input.msgs ?? [])
      .filter((m) => m.info.role === "user" || m.info.role === "assistant")
      .map((m) => {
        const role = m.info.role === "user" ? "User" : "Assistant"
        const parts = m.parts.flatMap((p): string[] => {
          if (p.type === "text") return p.text ? [p.text] : []
          if (p.type === "tool" && p.state.status === "completed") {
            const sanitized = sanitizeToolResult(p.state.output)
            const raw = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized)
            const out = raw.length > cap ? raw.slice(0, cap) + "\n... [truncated]" : raw
            return [`[Tool: ${p.tool}]\n${out}`]
          }
          return []
        })
        return `[${role}]: ${parts.join("\n")}`
      }).filter(Boolean).join("\n\n")

    if (!context.trim()) return undefined

    // Call LLM
    let system = PROMPT
    if (input.prev) {
      const budget = input.prevBudget ?? cfg.experimental?.observer_prev_tokens
      const prev = budget === false ? stripped : truncateObsToBudget(stripped, budget ?? 2000)
      if (prev) system += `\n\n## Previous Observations\n${prev}`
    }

    const result = await generateText({ model: language, system, prompt: context })

    if (!result?.text) return undefined
    if (detectDegenerateRepetition(result.text)) return undefined

    const out = parseObserverOutput(result.text)
    // Wrap in observation group markers
    if (first && last && out.observations) {
      out.observations = wrapInObservationGroup(out.observations, `${first}:${last}`)
    }
    return out
  }
}
```

### 3.12 Reflector - Compresión de Observaciones

**Archivo:** `packages/opencode/src/session/om/reflector.ts`

```typescript
// reflector.ts:102-175 - Reflector.run
export namespace Reflector {
  export const threshold = 120_000 // tokens

  const COMPRESSION_GUIDANCE: Record<CompressionLevel, string> = {
    0: "", // no guidance (first attempt)
    1: "Slightly more compression...",
    2: "Much more aggressive compression...",
    3: "Maximum compression...",
    4: "Extreme compression (collapse all tool calls)...",
  }

  const PROMPT = `You are a memory consolidation agent. Condense the observation log below into a tighter version.
  
  Rules:
  - PRESERVE all 🔴 user assertions (hard facts)
  - CONDENSE 🟡 user requests that are clearly resolved or superseded
  - Condense OLDER observations more aggressively than recent ones
  - Merge related bullets into single summary bullets
  - Preserve timestamps for important events
  - Output in same format as input (bullet list with 🔴/🟡 markers)
  - Preserve ✅ completion markers — they signal resolved tasks`

  export async function run(sid: SessionID): Promise<void> {
    const rec = OM.get(sid)
    if (!rec?.observations) return

    const cfg = await Config.get()
    const t = cfg.experimental?.observer_reflection_tokens ?? 120_000
    if ((rec.observation_tokens ?? 0) <= t) return

    if (cfg.experimental?.observer === false) return

    const modelStr = cfg.experimental?.observer_model ?? "google/gemini-2.5-flash"
    // ... resolve model

    let best: { text: string; tok: number } | undefined
    let level = startLevel(model?.api?.id ?? "") as CompressionLevel

    const rendered = renderObservationGroupsForReflection(rec.observations)

    while (level <= 4) {
      const system = PROMPT + COMPRESSION_GUIDANCE[level]
      const result = await generateText({ model: language, system, prompt: rendered })

      if (!result?.text || detectDegenerateRepetition(result.text)) {
        level = (level + 1) as CompressionLevel
        continue
      }

      const tok = result.text.length >> 2 // char/4 heuristic
      if (!best || tok < best.tok) best = { text: result.text, tok }

      // Check if compression target met
      if (validateCompression(result.text, t)) {
        const reconciled = reconcileObservationGroupsFromReflection(result.text, rec.observations)
        OM.reflect(sid, reconciled)
        return
      }

      level = (level + 1) as CompressionLevel
    }

    // Exhausted levels: persist best result
    if (best) {
      OM.reflect(sid, reconcileObservationGroupsFromReflection(best.text, rec.observations))
    }
  }
}
```

### 3.13 Record - CRUD de Observaciones

**Archivo:** `packages/opencode/src/session/om/record.ts`

```typescript
// record.ts:18-186 - OM namespace
export namespace OM {
  export function get(sid: SessionID): ObservationRecord | undefined {
    return Database.use((db) => db.select().from(ObservationTable).where(eq(ObservationTable.session_id, sid)).get())
  }

  export function addBufferSafe(buf: ObservationBuffer, sid: SessionID, msgIds: string[]): void {
    Database.transaction(() => {
      // Step 1: persist observation buffer chunk
      Database.use((db) => db.insert(ObservationBufferTable).values(buf).run())

      // Step 2: atomically merge msgIds into observed_message_ids
      const rec = Database.use((db) =>
        db.select().from(ObservationTable).where(eq(ObservationTable.session_id, sid)).get(),
      )

      if (rec) {
        const merged = mergeIds(rec.observed_message_ids ?? null, msgIds)
        Database.use((db) =>
          db
            .update(ObservationTable)
            .set({ observed_message_ids: merged, time_updated: Date.now() })
            .where(eq(ObservationTable.id, rec.id))
            .run(),
        )
      } else {
        // Insert placeholder with observed IDs
        Database.use((db) => db.insert(ObservationTable).values(placeholder).run())
      }
    })
  }

  export async function activate(sid: SessionID): Promise<void> {
    const bufs = buffers(sid)
    if (!bufs.length) return

    const rec = get(sid)
    const chunks = bufs.map((b) => b.observations)

    // Condense via LLM
    const merged = await Observer.condense(chunks, rec?.observations ?? undefined)

    const obs = range ? wrapInObservationGroup(merged, range) : merged
    const tok = Token.estimate(obs)

    if (rec) {
      const updated: ObservationRecord = {
        ...rec,
        observations: obs,
        last_observed_at: latest.ends_at,
        generation_count: rec.generation_count + bufs.length,
        observation_tokens: tok,
        observed_message_ids: mergeIds(rec.observed_message_ids ?? null, ids),
        time_updated: Date.now(),
      }
      Database.use((db) => db.update(ObservationTable).set(updated).where(eq(ObservationTable.id, rec.id)).run())
    } else {
      // Insert new
      Database.use((db) => db.insert(ObservationTable).values(next).run())
    }

    // Clear buffers
    Database.use((db) => db.delete(ObservationBufferTable).where(eq(ObservationBufferTable.session_id, sid)).run())
  }

  export function reflect(sid: SessionID, txt: string): void {
    Database.use((db) =>
      db
        .update(ObservationTable)
        .set({ reflections: txt, time_updated: Date.now() })
        .where(eq(ObservationTable.session_id, sid))
        .run(),
    )
  }
}
```

### 3.14 Schema SQL de Observational Memory

**Archivo:** `packages/opencode/src/session/session.sql.ts`

```sql
-- session.sql.ts:105-128 - ObservationTable
CREATE TABLE session_observation (
  id TEXT PRIMARY KEY,                    -- SessionID
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  observations TEXT,                     -- Observaciones generadas por OM
  reflections TEXT,                      -- Reflexiones comprimidas
  current_task TEXT,                    -- Tarea actual
  suggested_continuation TEXT,           -- Hint para continuar
  last_observed_at INTEGER,              -- Timestamp del último observe
  observed_message_ids TEXT,            -- JSON array de IDs ya observados
  generation_count INTEGER DEFAULT 0,   -- Cuántas veces se ha observado
  observation_tokens INTEGER DEFAULT 0, -- Tokens en observaciones
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- session.sql.ts:130-148 - ObservationBufferTable
CREATE TABLE session_observation_buffer (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  observations TEXT NOT NULL,           -- Chunk de observaciones
  message_tokens INTEGER NOT NULL,      -- Tokens del mensaje original
  observation_tokens INTEGER NOT NULL, -- Tokens del chunk
  starts_at INTEGER NOT NULL,           -- Timestamp inicio
  ends_at INTEGER NOT NULL,             -- Timestamp fin
  first_msg_id TEXT,
  last_msg_id TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
```

### 3.15 Handoff y Fork - Contexto de Sesiones Hijas

**Archivo:** `packages/opencode/src/memory/handoff.ts`

```typescript
// handoff.ts:27-119 - Handoff namespace
export namespace Handoff {
  /**
   * Write durable fork context.
   * Transactional — the fork is only live after this write succeeds.
   * Upsert on session_id: safe to call multiple times.
   */
  export function writeFork(ctx: { sessionId: string; parentSessionId: string; context: string }): void {
    const id = newId("fork")
    const now = Date.now()

    Database.transaction(() => {
      Database.use((db) =>
        db
          .insert(ForkContextTable)
          .values({
            id,
            session_id: ctx.sessionId,
            parent_session_id: ctx.parentSessionId,
            context: ctx.context,
            time_created: now,
          })
          .onConflictDoUpdate({
            target: ForkContextTable.session_id,
            set: {
              parent_session_id: ctx.parentSessionId,
              context: ctx.context,
              time_created: now,
            },
          })
          .run(),
      )
    })
  }

  /**
   * Write an agent handoff record (parent → child).
   * Includes snapshots of working memory and observations.
   */
  export function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): string {
    const id = newId("handoff")
    const now = Date.now()

    Database.transaction(() => {
      Database.use((db) =>
        db
          .insert(AgentHandoffTable)
          .values({
            id,
            parent_session_id: h.parent_session_id,
            child_session_id: h.child_session_id,
            context: h.context,
            working_memory_snap: h.working_memory_snap,
            observation_snap: h.observation_snap,
            metadata: h.metadata,
            time_created: now,
          })
          .onConflictDoUpdate({
            target: AgentHandoffTable.child_session_id,
            set: {
              parent_session_id: h.parent_session_id,
              context: h.context,
              working_memory_snap: h.working_memory_snap,
              observation_snap: h.observation_snap,
              metadata: h.metadata,
              time_created: now,
            },
          })
          .run(),
      )
    })

    return id
  }

  export function getFork(sessionId: string): ForkContext | undefined
  export function getHandoff(childSessionId: string): AgentHandoff | undefined
}
```

### 3.16 Integración en Prompt.ts (Hot Path)

**Archivo:** `packages/opencode/src/session/prompt.ts`

```typescript
// prompt.ts:157-181 - loadRuntimeMemory
async function loadRuntimeMemory(
  sessionID: SessionID,
  agentName: string,
  msgs: MessageV2.WithParts[],
): Promise<{
  recall: string | undefined
  workingMemory: string | undefined
  durableObservations: string | undefined
}> {
  const memCtx = await Memory.buildContext({
    scope: { type: "thread", id: sessionID },
    ancestorScopes: [
      { type: "agent", id: agentName }, // ← agente activo
      { type: "project", id: Instance.project.id }, // ← proyecto
      Memory.userScope(), // ← usuario
    ],
    semanticQuery: lastUserText(msgs),
  })

  const durable = durableChildHydration(sessionID)

  return {
    recall: memCtx.semanticRecall,
    workingMemory: appendBlock(memCtx.workingMemory, "durable-child-working-memory", durable.workingMemory),
    durableObservations: durable.observations,
  }
}

// prompt.ts - indexSessionArtifacts (async, awaited at session loop exit)
async function indexSessionArtifacts(sessionID: SessionID): Promise<void> {
  const finalObs = OM.get(sessionID)
  const obsContent = finalObs?.reflections ?? finalObs?.observations
  if (!obsContent || obsContent.length <= 100) return

  try {
    // Index as MemoryArtifact (project scope) via HybridBackend
    // (FTS5 write + embedding write when embedder is configured)
    await Memory.indexArtifact({
    scope_type: "project",
    scope_id: Instance.project.id,
    type: "observation",
    title: obsTitle,
    content: obsContent,
    topic_key: `session/${sessionID}/observations`,
    normalized_hash: null,
    revision_count: 1,
    duplicate_count: 1,
    last_seen_at: null,
    deleted_at: null,
  })
}

// prompt.ts:1918-1936 - Memory assembly en runLoop
// ─── Memory Assembler ──────────────────────────────────────
// At step===1: load recall + working memory via Memory.buildContext().
// Every turn: load observations (they change as Observer fires).
if (step === 1) {
  const mem = yield * Effect.promise(() => loadRuntimeMemory(sessionID, agent.name, msgs))
  recall = mem.recall
  workingMem = mem.workingMemory
  durableObs = mem.durableObservations
}

// Load observations every turn — they update during the session
obs = yield * Effect.promise(() => SystemPrompt.observations(sessionID))
obs = appendBlock(obs, "durable-child-context", durableObs)
```

---

## 4. Diagramas de Flujo

### 4.1 Run Loop Completo

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RUN LOOP (prompt.ts:1583-2047)                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  while(true) {       │
                    │    step++            │
                    └──────────┬────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │ 1. Load messages (MessageV2)    │
              │ 2. Find lastUser, lastAssistant │
              │ 3. Extract subtasks              │
              └───────────────┬────────────────┘
                              │
                              ▼
              ┌────────────────────────────────┐
              │ 4. Check exit condition         │
              │   - assistant.finish = "stop"   │
              │   - no tool calls pending       │
              └───────────────┬────────────────┘
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
        ┌──────────────┐              ┌───────────────┐
        │ EXIT LOOP   │              │ CONTINUE      │
        │ break       │              │               │
        └──────────────┘              └───────┬───────┘
                                              │
                                              ▼
              ┌─────────────────────────────────────────────┐
              │ 5. OM Coordinator (prompt.ts:1643-1754)     │
              │                                              │
              │   tok = lastFinished.tokens.input + output  │
              │   sig = OMBuf.check(sid, tok, obsTokens)    │
              │                                              │
              │   sig === "buffer"  → fork async Observer    │
              │   sig === "activate" → fork async activate  │
              │   sig === "block"   → sync activate         │
              │   sig === "idle"    → no-op                 │
              └───────────────────────┬─────────────────────┘
                                      │
                                      ▼
              ┌─────────────────────────────────────────────┐
              │ 6. Memory Assembly (prompt.ts:1918-1936)   │
              │                                              │
              │   if (step === 1) {                          │
              │     mem = loadRuntimeMemory(...)            │
              │     recall = mem.recall                      │
              │     workingMem = mem.workingMemory          │
              │   }                                          │
              │                                              │
              │   obs = SystemPrompt.observations(sid)      │
              │   // Observaciones se cargan cada turn     │
              └───────────────────────┬─────────────────────┘
                                      │
                                      ▼
              ┌─────────────────────────────────────────────┐
              │ 7. Build Prompt (prompt.ts:1978-2012)       │
              │                                              │
              │   system = [                                 │
              │     env,                                     │
              │     skills,                                  │
              │     instructions,                            │
              │     deferredSection?,                        │
              │   ]                                          │
              │                                              │
              │   // Memory injection                        │
              │   recall → system[2] (si hay)               │
              │   observations → system[1]                  │
              │   workingMemory → system[1]                  │
              │   volatile → system[last]                    │
              │                                              │
              │   messages = modelMsgs + [maxSteps?]        │
              └───────────────────────┬─────────────────────┘
                                      │
                                      ▼
              ┌─────────────────────────────────────────────┐
              │ 8. Call LLM (llm.ts)                        │
              │                                              │
              │   result = handle.process({                 │
              │     user, agent, permission, sessionID,    │
              │     system, messages, tools, model,         │
              │     recall, observations, workingMemory,    │
              │   })                                        │
              │                                              │
              │   // Result: "stop" | "continue"            │
              └───────────────────────┬─────────────────────┘
                                      │
              ┌───────────────┬───────┴───────────────┬───────┐
              ▼               ▼                       ▼       ▼
        ┌──────────┐   ┌──────────────┐      ┌──────────┐ ┌─────────┐
        │ "break"  │   │ "continue"   │      │ subtask  │ │ tool    │
        │          │   │              │      │ handler  │ │ calls   │
        └──────────┘   └──────────────┘      └──────────┘ └─────────┘
              │               │                     │         │
              └───────────────┴─────────────────────┴─────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │  } // while(true)  │
                    └─────────────────────┘
```

### 4.2 Memory.buildContext() Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│              Memory.buildContext(opts) → MemoryContext              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Parse options       │
                    │ - scope             │
                    │ - ancestorScopes    │
                    │ - budgets (WM, OM, SR)│
                    │ - semanticQuery     │
                    └──────────┬────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
    │ WORKING      │   │ OBSERVATIONAL│   │ SEMANTIC    │
    │ MEMORY       │   │ MEMORY (OM)  │   │ RECALL      │
    │              │   │              │   │             │
    │ getForScopes │   │ if thread:   │   │ if query:   │
    │ (scope chain)│   │   OM.get()   │   │   search()  │
    └──────┬───────┘   └──────┬───────┘   └──────┬──────┘
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                FALLBACK CHECK                               │
    │  if (ftsArtifacts.length === 0 && semanticQuery)          │
    │    artifacts = fts.recent(allScopes, 5)                   │
    └──────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                FORMAT WITH BUDGETS                          │
    │                                                              │
    │  workingMemory = format(WM_records, wBudget)               │
    │  observations = format(OM_record, oBudget)                 │
    │  semanticRecall = format(artifacts, rBudget)               │
    │                                                              │
    │  totalTokens = sum(token estimates)                        │
    └──────────────────────────────┬───────────────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                WRAP FOR PROMPT                              │
    │                                                              │
    │  <working-memory scope="thread"> ... </working-memory>     │
    │  <memory-recall> ... </memory-recall>                       │
    └─────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                        ┌─────────────────┐
                        │ MemoryContext  │
                        │                │
                        │ - recentHistory│
                        │ - workingMemory│
                        │ - observations │
                        │ - semanticRecall│
                        │ - continuationHint│
                        │ - totalTokens   │
                        └─────────────────┘
```

### 4.3 OM Threshold Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│              OM Coordinator (prompt.ts:1643-1754)                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Check token delta   │
                    │ tok = input + output│
                    └──────────┬────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ OMBuf.check()       │
                    │                     │
                    │ INTERVAL = 6000     │
                    │ TRIGGER = 80-140k   │
                    │ BLOCK_AFTER = 180k  │
                    │                     │
                    │ Returns:            │
                    │   - "idle"          │
                    │   - "buffer"        │
                    │   - "activate"      │
                    │   - "block"         │
                    └──────────┬────────────┘
                               │
        ┌──────────────┬──────┴──────┬──────────────┐
        ▼              ▼             ▼              ▼
┌─────────────┐  ┌────────────┐ ┌────────────┐ ┌────────────┐
│   "idle"    │  │  "buffer"  │ │ "activate" │ │  "block"   │
│             │  │            │ │            │ │            │
│   no-op     │  │ fork async │ │ fork async │ │ fork sync  │
│             │  │ Observer   │ │ activate   │ │ activate   │
│             │  │            │ │ +Reflector │ │ +Reflector │
└─────────────┘  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
                      │              │              │
                      ▼              ▼              ▼
              ┌─────────────┐ ┌────────────┐ ┌────────────┐
              │ Fork async  │ │Fork async  │ │Fork sync   │
              │ Observer.run│ │ OM.activate│ │ OM.activate│
              │  +addBuffer │ │ +Reflector │ │ +Reflector │
              └─────────────┘ └─────┬──────┘ └─────┬──────┘
                                    │              │
                                    ▼              ▼
                            ┌─────────────────────────────────┐
                            │         OM.activate(sid)       │
                            │                                 │
                            │  1. Condense buffers (LLM)     │
                            │  2. Merge → observations       │
                            │  3. Update last_observed_at    │
                            │  4. Clear buffers              │
                            │  5. If obs_tokens > 120k:      │
                            │       → Reflector.run()        │
                            └─────────────────────────────────┘
```

### 4.4 Fork/Handoff Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FORK / HANDOVER FLOW                             │
└─────────────────────────────────────────────────────────────────────┘

PARENT SESSION
      │
      ▼
┌─────────────────┐
│ fork() called   │
│ (session/index) │
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. Write fork context to DB (handoff.ts)                     │
│                                                              │
│    Memory.writeForkContext({                                 │
│      session_id: childID,                                    │
│      parent_session_id: parentID,                            │
│      context: JSON.stringify({                              │
│        taskDescription,                                      │
│        currentTask,                                          │
│        suggestedContinuation,                                │
│        workingMemorySnapshot,                                │
│      }),                                                     │
│    })                                                        │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. Clone messages up to messageID                            │
│    (session/index.ts:511-546)                                │
│    - Copy messages to new session ID                          │
│    - Copy parts with new IDs                                  │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
CHILD SESSION STARTS
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. Durable child hydration (prompt.ts:107-155)               │
│                                                              │
│    const handoff = Memory.getHandoff(sessionID)             │
│    const fork = Memory.getForkContext(sessionID)            │
│                                                              │
│    // Extrae working_memory_snap de handoff                  │
│    // Extrae observation_snap de handoff                     │
│    // Extrae context de fork                                 │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. Memory.buildContext() (prompt.ts:166-180)                │
│                                                              │
│    const memCtx = await Memory.buildContext({               │
│      scope: { type: "thread", id: sessionID },             │
│      ancestorScopes: [                                      │
│        { type: "agent", id: agentName },                    │
│        { type: "project", id: projectID },                 │
│        Memory.userScope(),                                   │
│      ],                                                      │
│      semanticQuery: lastUserText(msgs),                     │
│    })                                                        │
│                                                              │
│    // Combina con durableChildHydration()                     │
│    // workingMemory = memCtx.workingMemory + handoff WM     │
│    // observations = fork/handff observations               │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. Inject en system prompt                                    │
│                                                              │
│    <durable-fork-working-memory>                             │
│    <durable-handoff-working-memory>                          │
│    <durable-fork>                                             │
│    <durable-handoff>                                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Puntos Fuertes del Sistema de Memoria

### 5.1 Arquitectura Multicapa Bien Definida

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FORTALEZAS                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. SEPARACIÓN CLARA DE RESPONSABILIDADES                          │
│     ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌────────────┐  │
│     │ Working    │  │Observa-   │  │ Semantic   │  │  Fork/     │  │
│     │ Memory     │  │tional     │  │ Recall     │  │  Handoff   │  │
│     │ (facts,    │  │ Memory    │  │ (search,  │  │ (cross-    │  │
│     │  goals,    │  │(narrative)│  │  recall)  │  │  session)  │  │
│     │  prefs)    │  │           │  │            │  │            │  │
│     └────────────┘  └───────────┘  └────────────┘  └────────────┘  │
│                                                                      │
│     Cada capa tiene un propósito distinto y no se mezclan.         │
│                                                                      │
│  2. PRECEDENCIA DE SCOPES CORRECTA                                 │
│     thread > agent > project > user > global_pattern               │
│                                                                      │
│     El código en working-memory.ts:68-79 implementa              │
│     correctamente "most specific wins":                            │
│                                                                      │
│     const seen = new Set<string>()                                 │
│     return all.filter((r) => {                                     │
│       if (seen.has(r.key)) return false  // skip duplicates      │
│       seen.add(r.key)                                               │
│       return true                                                  │
│     })                                                             │
│                                                                      │
│  3. GRACEFUL DEGRADATION                                           │
│     - FTS5 falla → fallback a recent()                            │
│     - OM disabled → skip observation                               │
│     - Model fails → return empty/undefined                         │
│     - DB write fails → throw (no datos corruptos)                  │
│                                                                      │
│  4. TRANSACCIONES ATÓMICAS                                        │
│     - addBufferSafe() en record.ts:70-110                         │
│     - writeFork() / writeHandoff() en handoff.ts                  │
│     - Ningún dato visible hasta que la transacción completa       │
│                                                                      │
│  5. TWO-PASS FTS5 SEARCH                                          │
│     - Pass 1: AND mode (alta precisión)                            │
│     - Pass 2: OR prefix mode (alto recall)                         │
│     - Resuelve el problema de "authentication" no matchea "auth" │
│                                                                      │
│  6. FLEXIBILIDAD DE SCHEMA                                         │
│     - topic_key permite upserts (revisiones)                       │
│     - normalized_hash permite deduplicación                        │
│     - soft delete (deleted_at) sin borrar datos                   │
│     - Timestamps para tracking temporal                           │
│                                                                      │
│  7. DYNAMIC THRESHOLDS                                             │
│     - OMBuf calcula thresholds adaptivos                          │
│     - Total budget (messages + obs) se mantiene limitado           │
│     - Evita explosion de tokens en sesiones largas               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Feature Highlights

| Feature                    | Implementación                     | Archivo                      |
| -------------------------- | ---------------------------------- | ---------------------------- |
| **Scope precedence**       | `getForScopes()` con dedup por key | `working-memory.ts:68-79`    |
| **Two-pass FTS5**          | AND mode → OR mode fallback        | `semantic-recall.ts:261-317` |
| **Atomic OM writes**       | `addBufferSafe()` transaction      | `record.ts:70-110`           |
| **Topic-key upserts**      | revision_count increment           | `semantic-recall.ts:110-147` |
| **Hash dedup**             | 15-min window dedupe               | `semantic-recall.ts:150-181` |
| **Dynamic thresholds**     | calculateDynamicThreshold          | `buffer.ts:20-23`            |
| **Reflection compression** | 5 niveles de compresión            | `reflector.ts:27-86`         |
| **Continuation hint**      | synthetic user message             | `prompt.ts:1950-1976`        |
| **Fork recovery**          | durableChildHydration              | `prompt.ts:107-155`          |

---

## 6. Puntos Débiles y Limitaciones

### 6.1 Limitaciones Conocidas

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DEBILIDADES                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. TOKEN ESTIMATION HEURISTIC                                      │
│     - Usa char/4 como aproximación (>> 2)                          │
│     - No es preciso para todos los providers                       │
│     - Afecta: budgets, observation_tokens, recall cap             │
│     - Archivos:                                                     │
│       * provider.ts:181 (formatObservations)                       │
│       * observer.ts:272 (observer_max_tool_result_tokens)         │
│       * system.ts:58-61 (capRecallBody)                           │
│                                                                      │
│  2. OM STATE IN-MEMORY (no persiste entre restart)                 │
│     - OMBuf.state es Map<SessionID, State>                        │
│     - Se pierde al reiniciar el proceso                            │
│     - consequence: mensajes ya observados se re-ofrecen al LLM    │
│     - Mitigación: observed_message_ids en DB (persistente)       │
│     - Archivo: buffer.ts:7 (state Map)                            │
│                                                                      │
│  3. SCOPES PARCIALMENTE OPERACIONALES                              │
│     - thread, project: plenamente operativos                      │
│     - agent: operativa, expuesta en tool                            │
│     - user: operativa, requiere update_user_memory explícito       │
│     - global_pattern: DORMANT (no implementado)                   │
│     - Archivo: contracts.ts:15-28                                   │
│                                                                      │
│  4. SIN VECTOR EMBEDDINGS                                          │
│     - FTS5 es full-text, no semántico                              │
│     - No puede encontrar "autenticación" por similaridad         │
│     - Solo exacta o prefijo                                       │
│     - Alternativa futura: vector/embedding backend               │
│     - Contrato definido en contracts.ts:167-172                   │
│                                                                      │
│  5. LÍMITES DE TAMAÑO                                              │
│     - MAX_CONTENT_LENGTH = 50,000 chars (semantic-recall.ts:23)  │
│     - Truncation agrega "... [truncated]"                         │
│     - Puede perder contexto relevante                             │
│                                                                      │
│  6. NO HAY CROSS-PROJECT RECALL                                    │
│     - scope_type limita búsqueda al proyecto actual              │
│     - user scope es solo para preferencias, no recall             │
│     - global_pattern está dormant                                 │
│                                                                      │
│  7. RUN LOOP MONOLÍTICO                                            │
│     - 452 líneas de while(true) en prompt.ts:1583-2047           │
│     - 12+ preocupaciones mezcladas                                │
│     - Difícil de extender sin romper                               │
│     - Nota: el código tiene comentarios claros de secciones      │
│                                                                      │
│  8. OBSERVATION BUFFER PATH PODRÍA SER REDUNDANTE                 │
│     - activate() ya hace condense                                 │
│     - addBuffer() solo persist chunk, no condensa                │
│     - La separación buffer→activate 是否 necesaria?             │
│     - Archivo: record.ts:112-159                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Técnicas de Mitigación Existentes

| Problema          | Mitigación Actual              | Eficacia |
| ----------------- | ------------------------------ | -------- |
| Token estimation  | char/4 heuristic               | Media    |
| OM in-memory      | observed_message_ids en DB     | Alta     |
| FTS5 precision    | Two-pass search                | Alta     |
| Large content     | Truncation + fallback          | Media    |
| Scope limitations | Ancestor chain en buildContext | Alta     |

### 6.3 Áreas de Mejora Futura

1. **Vector embeddings** - Para búsqueda semántica real
2. **Cross-project recall** - Activar global_pattern
3. **Compression más agresiva** - Reducir observation_tokens
4. **Streaming observations** - Para sesiones muy largas
5. **Persistence de OM state** -between restarts

---

## 7. Referencias de Código

### 7.1 Archivos Principales del Sistema de Memoria

| Archivo                                           | Líneas | Propósito              |
| ------------------------------------------------- | ------ | ---------------------- |
| `packages/opencode/src/memory/provider.ts`        | 184    | API unificada Memory   |
| `packages/opencode/src/memory/contracts.ts`       | 187    | Tipos y contratos      |
| `packages/opencode/src/memory/working-memory.ts`  | 197    | Working memory service |
| `packages/opencode/src/memory/semantic-recall.ts` | 403    | FTS5 search + index    |
| `packages/opencode/src/memory/handoff.ts`         | 119    | Fork/handoff DB        |
| `packages/opencode/src/memory/schema.sql.ts`      | 128    | Drizzle schema         |
| `packages/opencode/src/session/om/record.ts`      | 186    | OM CRUD                |
| `packages/opencode/src/session/om/observer.ts`    | 330    | Observación LLM        |
| `packages/opencode/src/session/om/reflector.ts`   | 175    | Compresión             |
| `packages/opencode/src/session/om/buffer.ts`      | 125    | Threshold state        |
| `packages/opencode/src/session/om/groups.ts`      | ~200   | Observation groups     |
| `packages/opencode/src/tool/memory.ts`            | ~110   | WM tools               |

### 7.2 Integración en Session Prompt

| Sección                           | Líneas            | Descripción             |
| --------------------------------- | ----------------- | ----------------------- |
| `prompt.ts:loadRuntimeMemory`     | 157-181           | Carga memoria runtime   |
| `prompt.ts:indexSessionArtifacts` | 183-210           | Indexa OM al final      |
| `prompt.ts:1918-1936`             | Memory assembly   | Memory assembly en loop |
| `prompt.ts:1643-1754`             | OM coordinator    | Threshold pipeline      |
| `prompt.ts:1950-1976`             | Continuation hint | Synthetic message       |
| `system.ts:observations`          | 128-136           | Wrapper observations    |
| `system.ts:wrapRecall`            | 67-69             | Wrapper recall          |
| `system.ts:wrapWorkingMemory`     | 83-85             | Wrapper WM              |

### 7.3 Esquema de Base de Datos

```sql
-- Tablas de memoria
memory_working          -- Working memory estructurado
memory_artifacts       -- Semantic recall artifacts
memory_artifacts_fts   -- FTS5 virtual table
memory_agent_handoffs  -- Handoff records
memory_fork_contexts   -- Fork context
memory_links           -- Links entre artifacts (no usado)

-- Tablas de sesión (relacionadas)
session                -- Sesiones
message                -- Mensajes
part                   -- Partes de mensajes
session_observation    -- Observational Memory
session_observation_buffer -- Buffers de observación
```

---

## 8. Glosario

| Término                       | Definición                                                  |
| ----------------------------- | ----------------------------------------------------------- |
| **Working Memory**            | Memoria estructurada: facts, goals, constraints, decisiones |
| **Observational Memory (OM)** | Memoria narrativa: observaciones generadas por LLM          |
| **Semantic Recall**           | Búsqueda de artifacts cross-session via FTS5                |
| **Scope**                     | Contexto de persistencia: thread, agent, project, user      |
| **Precedence**                | Regla: scope más específico wins (thread > project)         |
| **OMBuf**                     | Buffer de tokens que controla thresholds de observación     |
| **Observer**                  | LLM que extrae observaciones de mensajes                    |
| **Reflector**                 | LLM que comprime observaciones largas                       |
| **Handoff**                   | Snapshot de contexto al crear sesión hija                   |
| **Fork**                      | Copia de sesión desde un punto específico                   |

---

## 9. Links Relacionados

- `docs/LIGHTCODE_MEMORY_PRODUCTION_SPEC.md` - Especificación de producción
- `docs/LIGHTCODE_MEMORY_PRODUCTION_VALIDATION.md` - Validación de tests
- `docs/memory-architecture.md` - Arquitectura histórica (Engram-based)
- `packages/opencode/AGENTS.md` - Reglas de Effect para el proyecto

---

> **Nota:** Este documento se genera desde inspección directa del código. Los números de línea y paths son precisos a la fecha de generación (Abril 2026). El sistema de memoria está en evolución continua.
