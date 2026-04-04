# Comparación: arquitectura Claude Code (`src`) vs Lightcode (fork OpenCode)

Documento de síntesis entre el árbol **`/Users/saturno/Downloads/src`** (cliente tipo Claude Code) y **`lightcode-fallback`** (fork OpenCode). Sirve para ubicar equivalencias y diferencias de diseño, no para afirmar paridad de producto.

---

## 1. Propósito y ecosistema

| Aspecto | Claude Code (`src`) | Lightcode (este repo) |
|--------|---------------------|-------------------------|
| **Origen** | Código de aplicación cliente Anthropic (estructura interna). | Fork open source de **OpenCode** (CLI/TUI/SDK multi-proveedor). |
| **API de chat** | **Anthropic Messages** (`@anthropic-ai/sdk`) de forma explícita. | **Vercel AI SDK** + adaptadores por proveedor; no está fijado a un solo vendor. |
| **Distribución** | App/bundle (según producto); monolito `src`. | Monorepo npm/bun: CLI `opencode`, web, desktop, SDK generado. |

---

## 2. UI y entrada de usuario

| Claude Code (`src`) | Lightcode |
|---------------------|-----------|
| **Ink + React** (`screens/`, `ink/`, componentes por tool). | **TUI** en `packages/opencode/src/cli/cmd/tui/` (OpenTUI / rutas propias del fork). |
| **`AppState`** React centralizado. | Estado vía **Effect**, **Session**, **Bus** de eventos; menos UI React en el núcleo del motor. |
| **`processUserInput`**, slash commands extensos. | Comandos CLI y flujo de prompt en **`session/prompt`**; `@` agentes en TUI. |

---

## 3. Bucles de inferencia

| Claude Code | Lightcode |
|-------------|-----------|
| **`query.ts`**: streaming, compactación, tool loop. | **`session/prompt.ts`** + **`session/llm.ts`**: loop, `streamText`, `resolveTools`. |
| **`QueryEngine.ts`**: orquestación alta (transcript, coste, memoria, plugins). | **`Session`**, **`SessionProcessor`**, **`Plugin`**: hooks en ejecución de tools. |

**Idea equivalente:** “un turno = armar mensajes + tools + llamar al modelo + ejecutar tools”.

---

## 4. Herramientas (tools)

| Claude Code | Lightcode |
|-------------|-----------|
| **`Tool.ts`**: tipo rico (permisos, progreso, `AppState`). | **`Tool`** en `packages/opencode/src/tool/tool.ts` + **`ToolRegistry`**. |
| Muchas carpetas bajo **`tools/`** (nombres tipo `FileReadTool`, `TaskCreateTool`, …). | Tools como **`read`**, **`write`**, **`bash`**, **`task`**, **`websearch`**, MCP dinámico. |
| Herramientas **específicas de producto** (equipos, cron, worktrees, plan mode, REPL). | Enfoque **extensible por plugin** y **MCP**; agentes **SDD** en config (`agent.*`). |

**Diferencia notable:** en Claude Code el **surface de tools del producto** es muy amplio y nombra features de negocio; en OpenCode/Lightcode el **catálogo base** es más corto y se amplía con **plugins/MCP** y permisos.

---

## 5. Reducción de tools en el prompt

| Claude Code | Lightcode |
|-------------|-----------|
| Lógica repartida (skills search, clasificadores, features). | **`experimental.tool_router`**: embeddings locales, reglas, **`router-policy`**, **`apply_hard_gates`**, **`applyExposure`**. |
| Objetivo: UX y límites de producto. | Objetivo explícito del fork: **menos tokens por turno** y evaluación reproducible (`docs/tool-router-*.md`, scripts `router-eval`). |

---

## 6. Tareas y delegación

| Claude Code | Lightcode |
|-------------|-----------|
| **`Task.ts`** + **`tasks/`**: `local_bash`, `remote_agent`, `dream`, etc. | **`task` tool** + subagentes (`explore`, `sdd-*`); menos tipos de tarea en el núcleo. |
| Estado de tareas en **`AppState`**. | Delegación en sesiones/hilos y permisos de `task` por agente. |

---

## 7. MCP y extensiones

| Ambos | |
|-------|---|
| Integración **MCP** (servidores, recursos, permisos). | En Claude Code: managers en **`services/mcp`**; en Lightcode: **`packages/opencode/src/mcp/`** + filtros por intent en el router. |

---

## 8. Persistencia

| Claude Code | Lightcode |
|-------------|-----------|
| **`migrations/`** (ajustes, modelos, flags). | **SQLite + Drizzle** en el proyecto; sesiones y mensajes versionados. |

---

## 9. Cuándo usar qué mental model

- **Pensar “Claude Code”:** React/Ink, `query`/`QueryEngine`, tools con carpeta propia y UI gemela, tareas tipadas en `AppState`.
- **Pensar “Lightcode/OpenCode”:** Bun/Effect, `resolveTools` + **ToolRouter** + permisos, monorepo, fork documentado en **`README.md`** y **`docs/`**.

---

## 10. Referencias cruzadas

- Detalle **solo Claude Code `src`:** [claude-code-src-arquitectura.md](./claude-code-src-arquitectura.md)
- Detalle **solo Lightcode:** [lightcode-arquitectura.md](./lightcode-arquitectura.md)
