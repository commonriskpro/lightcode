# Arquitectura: código fuente Claude Code (`/Users/saturno/Downloads/src`)

Este documento describe la arquitectura observada en el árbol **src** proporcionado (cliente/CLI orientado a Anthropic, TUI con Ink/React). No es documentación oficial de producto; es un mapa estructural derivado del código.

---

## 1. Rol del paquete

- **Cliente de escritorio / terminal** que orquesta sesiones de chat con el modelo, herramientas (tools), permisos, MCP, tareas en segundo plano y opcionalmente **modo remoto / bridge**.
- **API de mensajes** alineada con **Anthropic** (`@anthropic-ai/sdk`, tipos `ContentBlockParam`, `ToolUseBlock`, etc.).
- **UI**: componentes **Ink** (React en terminal) bajo `screens/`, `ink/`, más estado global en React (`state/`).

---

## 2. Bucles centrales: consulta y motor

| Pieza | Rol |
|--------|-----|
| **`query.ts`** | Núcleo del bucle de inferencia: normalización de mensajes, adjuntos, compactación, reintentos, streaming de eventos, orquestación con `findToolByName`, hooks de permiso, integración con servicios de compactación (feature flags). |
| **`QueryEngine.ts`** | Capa superior: sesión, transcript, uso/coste, integración con `processUserInput`, prompts del sistema, plugins, memoria (`memdir`), modo coordinador (feature flag), historial de archivos, etc. |

Flujo típico: **entrada de usuario** → `processUserInput` → encolado / comandos → **`query`** → API del modelo → **tool use** → ejecución por tool → resultados → actualización de **AppState** y almacenamiento de sesión.

---

## 3. Modelo de herramientas (`Tool.ts` + `tools/`)

- **`Tool.ts`**: Contrato común (schemas, contexto de ejecución, permisos `PermissionMode`, progreso por tipo de tool, integración con `AppState`).
- **`tools/`**: Implementación **por carpeta** (patrón plugin interno), por ejemplo:
  - **Filesystem / código:** `FileReadTool`, `FileWriteTool`, `FileEditTool`, `GlobTool`, `GrepTool`, `BashTool`, `PowerShellTool`, `LSPTool`, `NotebookEditTool`.
  - **Web / investigación:** `WebFetchTool`, `WebSearchTool`.
  - **MCP:** `MCPTool`, `ReadMcpResourceTool`, `ListMcpResourcesTool`, `McpAuthTool`.
  - **Agentes / equipos:** `AgentTool`, `TaskCreateTool`, `TaskGetTool`, `TaskUpdateTool`, `TaskListTool`, `TaskOutputTool`, `TaskStopTool`, `TeamCreateTool`, `TeamDeleteTool`, `SendMessageTool`, etc.
  - **Producto:** `TodoWriteTool`, `SkillTool`, `AskUserQuestionTool`, `ConfigTool`, `BriefTool`, `ScheduleCronTool`, `SleepTool`, `SyntheticOutputTool`, `REPLTool`, `EnterPlanModeTool`, `ExitPlanModeTool`, worktrees (`EnterWorktreeTool` / `ExitWorktreeTool`), etc.

Cada tool suele traer **UI** colocalizada (p. ej. `tools/BashTool/UI.tsx`) para renderizar resultados en la TUI.

---

## 4. Estado de aplicación y tareas

- **`state/AppState.tsx`**: Estado global React (sesiones, mensajes, configuración de UI, etc.).
- **`Task.ts`** + **`tasks/`**: Abstracción de **tareas** asíncronas con tipos (`local_bash`, `local_agent`, `remote_agent`, `in_process_teammate`, `dream`, …), IDs con prefijos, estados terminal (`completed` / `failed` / `killed`), salida en disco (`outputFile`).

---

## 5. Entrada del usuario

- **`utils/processUserInput/`**: Texto libre, slash commands, bash inline, adjuntos.
- **`commands/`**: Comandos de producto (help, login, export, stats, session, …), muchos con pareja `index.ts` + `*.tsx` para UI Ink.

---

## 6. Integraciones y servicios

- **`services/`**: API Claude (`services/api`), límites, **MCP** (`MCPConnectionManager`, canales), voz, analytics, **MagicDocs**, **team memory sync**, **autoDream**, diagnósticos, etc.
- **`bridge/`**: Comunicación con REPL / control remoto (`bridgeMain`, `replBridge`, mensajes entrantes/salientes, secretos, capacidad).
- **`remote/`**: Sesiones remotas, WebSocket, adaptador de mensajes SDK, permisos remotos.

---

## 7. Contexto, memoria y plugins

- **`context/`**, **`utils/memory/`**, **`memdir/`**: Contexto de conversación y memoria en disco / prompts.
- **`plugins/`**, **`skills/`**: Extensión (skills empaquetados bajo `skills/bundled/`).

---

## 8. Persistencia y migraciones

- **`migrations/`**: Migraciones de ajustes (modelos por defecto, flags, MCP, etc.), típicamente sobre almacenamiento local (SQLite u otro según build).

---

## 9. Otros módulos relevantes

| Directorio | Rol |
|------------|-----|
| **`assistant/`** | Lógica asistente (submódulo dedicado). |
| **`coordinator/`** | Modo coordinador (feature-gated desde `QueryEngine`). |
| **`bootstrap/`** | Arranque y estado inicial. |
| **`cli/`** | Handlers CLI (auth, plugins, MCP, structured I/O). |
| **`constants/`** | Prompts, estilos, XML, GitHub app, etc. |
| **`types/`** | Mensajes, permisos, hooks, IDs. |
| **`vim/`** | Integración Vim. |
| **`server/`** | Servidor (si aplica al build). |
| **`QueryEngine.ts` / `query.ts`** | Corazón del pipeline de chat + tools. |

---

## 10. Resumen

La carpeta **src** es un **monolito de aplicación** con fuerte acoplamiento a **Anthropic Messages + tools**, **React/Ink** para TUI, **tareas** para trabajo en background, **MCP** y **bridge** para ampliar el entorno. La extensión horizontal está en **`tools/*`** y **`commands/*`**, no en un paquete SDK público aislado como en OpenCode.
