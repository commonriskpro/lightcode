# Mejoras inspiradas en Claude Code — aplicables a Lightcode (fork OpenCode)

Este documento cruza los análisis en **`opencode arch analysis.md`** (en la práctica: **OpenCode/Lightcode**: registry, router, wire-tier, SDD) y **`Claude Code Arch Analysis.md`** (cliente Anthropic: tools, hooks, deferral, orquestación). El objetivo es listar **features, archivos y patrones** del segundo que podrían **mejorar** este repo sin confundir ambos stacks.

**Nota:** El primer MD describe el motor **OpenCode** que Lightcode ya extiende (router offline, `Permission`, `ToolRouter`, `session/prompt`). Las “mejoras” útiles vienen sobre todo del **segundo** MD (Claude Code).

---

## 1. Resumen ejecutivo

| Área | En Claude Code (referencia) | En Lightcode hoy (orientativo) | Oportunidad |
|------|-----------------------------|----------------------------------|-------------|
| Catálogo de tools | 50+ tools base + MCP, `assembleToolPool` | Menos tools core + MCP + plugins | Añadir tools vía **plugin/MCP** o tools de proyecto; no copiar nombres propietarios. |
| Ejecución de tools | **Paralelo** (read-only) vs **serial** (writes) | Ejecución vía AI SDK en serie por turno | Particionar batches según “seguro concurrente” (ver §3). |
| Hooks | **PreToolUse / PostToolUse** con command, prompt, agent, http + permisos agregados | `Plugin.trigger` (`tool.execute.before/after`, chat) | Extender hooks de usuario tipo Claude o documentar equivalencias. |
| Carga de tools | **ToolSearchTool** + `defer_loading` / esquema bajo demanda | Router recorta **defs** (slim), no deferral API | Combinar router + “tool discovery” explícita (ver §4). |
| Descripciones | `tool.prompt()` dinámico por contexto | Descripciones estáticas + slim en router | Enriquecer por agente/tier sin inflar siempre el prompt. |
| Permisos | `alwaysAllow/Deny/Ask` por reglas + hooks | `Permission` ruleset + `disabled()` | Unificar UX “reglas + hook” si se añaden hooks externos. |
| Compactación | Pre/post compact hooks | `SessionCompaction` + Effect | Hooks de lifecycle opcionales al compactar. |

---

## 2. Features concretas a considerar

### 2.1 Orquestación paralela / serial de tool calls (`toolOrchestration`)

**Qué es en Claude Code:** Particionar `tool_use` en bloques **concurrentes** (grep, read, glob, bash read-only) vs **seriales** (edit, write, bash destructivo).

**Por qué en Lightcode:** Menos latencia cuando el modelo emite varias lecturas; menos condiciones de carrera si las escrituras van en cola.

**Dónde encajar:** Tras recibir los `tool-call` del stream en `session/processor` o capa previa a `execute`, agrupar por política (solo lectura vs mutación). Requiere clasificar tools (metadata en `Tool.Info` o tabla estática).

**Riesgo:** Cambio de semántica respecto a “orden estricto del modelo”; conviene flag `experimental.parallel_read_tools`.

---

### 2.2 Sistema de hooks estilo Claude (`PreToolUse` / `PostToolUse`)

**Qué es:** Hooks configurables (shell, prompt LLM secundario, agente, HTTP) que pueden **deny / ask / allow** y **modificar input** antes del tool.

**Qué tiene Lightcode:** `Plugin.trigger("tool.execute.before/after")` y permisos `Permission.ask`.

**Mejora:** Un **adaptador** que cargue `hooks.json` (o equivalente en `.opencode/`) y traduzca a llamadas al plugin bus o a scripts, **sin** copiar el runtime completo de Claude. Prioridad: **seguridad y auditabilidad** (quién puede ejecutar qué comando en pre-tool).

---

### 2.3 Tool deferral / “ToolSearch” (catálogo parcial en API)

**Qué es:** No enviar todos los esquemas; marcar tools como diferidas; el modelo usa **ToolSearch** para cargar el esquema cuando lo necesita.

**Qué tiene Lightcode:** **Tool router offline** + descripciones **slim** + `additive` + `session_accumulative_callable` — misma filosofía (menos tokens), distinta mecánica (no depende de error `defer_loading` del API Anthropic).

**Mejora:** Documentar en README que el router OpenCode **sustituye** el patrón deferral de Claude; opcionalmente añadir **mensaje de sistema** cuando un tool esté “bloqueado por router” para guiar al usuario (ya hay `promptHint`).

---

### 2.4 Metadatos ricos en tools (`isDestructive`, `isReadOnly`, `validateInput`)

**Qué es:** En Claude Code, `Tool` expone métodos para permisos y concurrencia.

**Mejora en Lightcode:** Opcional: extender `Tool.define` / `Tool.Info` con flags **`readOnly`**, **`destructive`**, o `validateInput` centralizado para alimentar §2.1 y mensajes de error homogéneos.

---

### 2.5 Plugin manifest unificado (commands + agents + skills + hooks + MCP)

**Qué es:** `manifest.json` con secciones para comandos, agentes, skills, hooks, MCP.

**Qué tiene Lightcode:** `plugin` en config, skills por paths, agentes en `opencode.jsonc`, MCP en config.

**Mejora:** Un **esquema de manifest** opcional que genere la misma config actual (un solo archivo por plugin de proyecto) para reducir fricción; no es obligatorio para el core.

---

### 2.6 Session hooks efímeros (`sessionHooks` Map)

**Qué es:** Hooks por `sessionId` en memoria, sin re-render global.

**Mejora:** Si Lightcode expone extensiones en TUI, un registro **por sesión** de callbacks (plugin o script) para eventos `SessionStart`, `BeforeCompact`, etc., alineado con `Bus` existente.

---

### 2.7 Contexto de prompt: Git + CLAUDE.md cacheado

**Qué es:** `getSystemContext` / `getUserContext` con memo por sesión.

**Mejora:** Lightcode ya tiene `SystemPrompt.environment` y `SystemPromptCache`; revisar **TTL** y **invalidación** al cambiar rama (hook git o watcher opcional).

---

## 3. Archivos / módulos de referencia (Claude Code) → equivalente Lightcode

| Referencia Claude Code (del MD) | Equivalente / destino en Lightcode |
|----------------------------------|-------------------------------------|
| `src/tools.ts` / `getAllBaseTools` | `packages/opencode/src/tool/registry.ts` |
| `src/services/tools/toolExecution.ts` | `session/processor` + ejecución en `session/prompt` / tool `execute` |
| `src/services/tools/toolOrchestration.ts` | *Nuevo módulo opcional* junto al processor |
| `src/services/tools/toolHooks.ts` | Extender `packages/opencode/src/plugin` o capa thin sobre `Permission` |
| `src/utils/hooks.ts` | Nuevo `hooks/` o extensión de plugin con tipos Zod |
| `src/context.ts` | `session/system.ts`, `SystemPromptCache`, `wire-tier` |
| `src/query.ts` | `session/prompt.ts` + `session/llm.ts` |
| `src/QueryEngine.ts` | Flujo TUI + `Session.loop` (no 1:1) |
| `src/state/AppState.tsx` | Menos relevante (OpenCode no centra todo en React); TUI en `cli/cmd/tui` |

---

## 4. “Extras” del primer MD (OpenCode) que ya son Lightcode

Estos puntos **ya están** en el fork; no son importaciones desde Claude Code, sino **continuidad**:

- Tool registry + filtros por modelo (`websearch` / `codesearch`).
- `ToolRouter` híbrido (embeddings + política + `apply_hard_gates` opcional).
- Wire-tier / `instructionMode` / caché de system prompt.
- Agentes SDD y `task` para subagentes.
- Plugins con hooks de chat y tools.

La mejora aquí es **afinar** (benchmarks router, permisos, documentación) más que sustituir por diseño Claude.

---

## 5. Qué no tiene sentido copiar tal cual

- **API Anthropic-only** (`defer_loading`, bloques concretos): Lightcode es **multi-proveedor** (AI SDK).
- **50+ tools** con nombres de producto Claude: mantener **superficie pequeña** y extender con MCP/plugins acorde a la filosofía del fork.
- **React AppState** como núcleo del motor: OpenCode usa **Effect/Bun/SQLite**; no conviene reescribir solo para parecerse a Claude Code.

---

## 6. Priorización sugerida (impacto / esfuerzo)

1. **Alta relación coste/beneficio:** flags en tools (**readOnly/destructive**) + **ejecución paralela de solo-lectura** (con flag).
2. **Media:** capa **hooks Pre/Post** compatible con manifest mínimo (shell + deny/ask), apoyada en `Plugin` + `Permission`.
3. **Media/baja:** **manifest** unificado de plugin de proyecto.
4. **Baja (documental):** equivalencias **router offline vs ToolSearch** en `README` del fork.

---

## 7. Referencias internas

- Arquitectura Lightcode/OpenCode: [lightcode-arquitectura.md](./lightcode-arquitectura.md)
- Comparación previa Claude vs Lightcode: [comparacion-claude-code-vs-lightcode.md](./comparacion-claude-code-vs-lightcode.md)
