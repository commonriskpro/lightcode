# Arquitectura: Lightcode / fork OpenCode (este repositorio)

**Lightcode** es un **fork de [OpenCode](https://github.com/anomalyco/opencode)** orientado a menor coste por turno, **router offline de herramientas**, agentes **SDD** (Gentle AI) y mejoras de TUI. El repo es un **monorepo** (`bun` workspaces) cuyo núcleo es **`packages/opencode`**.

---

## 1. Monorepo (raíz)

| Ruta | Rol breve |
|------|-----------|
| **`package.json`** | Orquesta `turbo`, scripts `dev` / `build`, workspaces bajo `packages/*`. |
| **`packages/opencode`** | CLI `opencode`, motor de sesión, tools, proveedores, TUI. |
| **`packages/app`**, **`packages/web`** | Front web (Vite/Solid u stack del paquete). |
| **`packages/desktop`**, **`packages/desktop-electron`** | Apps de escritorio. |
| **`packages/sdk/js`** | SDK TypeScript generado (OpenAPI / tipos de config). |
| **`packages/ui`**, **`packages/util`**, **`packages/plugin`** | UI compartida, utilidades, sistema de plugins. |
| **`packages/console/*`** | Consola / funciones cloud (según despliegue). |
| **`gentle-ai/`**, **`.opencode/`** | Skills, plugins y configuración del fork (agentes SDD, router). |
| **`docs/`** | Documentación del fork (router, SDD, Engram, etc.). |

---

## 2. Entrada CLI (`packages/opencode/src/index.ts`)

- **yargs**: subcomandos (`run`, `serve`, `agent`, `mcp`, `tui` implícito, etc.).
- Inicialización de **log**, **DB** (Drizzle + SQLite local), **migraciones JSON**.
- **`Global.Path`**: rutas de config portable / proyecto.

---

## 3. Núcleo de sesión y prompt

| Módulo | Rol |
|--------|-----|
| **`session/prompt.ts`** | Bucle principal del chat: crea mensajes usuario, **`resolveTools`** (registro + MCP + permisos + **ToolRouter** + **applyExposure**), ensambla **system prompt** (`SystemPromptCache`, `InstructionPrompt`, wire-tier), llama al **LLM** (`session/llm.ts`). |
| **`session/llm.ts`** | Integración **Vercel AI SDK** (`streamText`), reparación de tool calls, compatibilidad LiteLLM. |
| **`session/tool-router.ts`** | Router **offline**: híbrido (embeddings locales Xenova / reglas / intent), **`additive`**, fallback vacío, tier `conversation` / `full`, hints inyectados. |
| **`session/router-policy.ts`** | Política determinista post-candidatos: hard gates opcionales, conflictos (p. ej. websearch/webfetch), dependencias `read`. |
| **`session/tool-exposure.ts`** | Modos de exposición (`per_turn_subset`, `session_accumulative_callable`, …): qué definiciones de tools se adjuntan al request. |
| **`session/compaction.ts`** | Compactación de contexto cuando el hilo crece. |
| **`session/message-v2.ts`** | Modelo de mensajes/parts (texto, tool, archivo, agente). |

---

## 4. Herramientas (`packages/opencode/src/tool/`)

- **`registry.ts`**: Registro central: tools nativos + plugins + tools por directorio `tool/` del proyecto; filtrado por modelo (p. ej. `websearch` solo ciertos proveedores).
- Tools típicos: `read`, `glob`, `grep`, `edit`, `write`, `bash`, `task`, `webfetch`, `websearch`, `codesearch`, `skill`, `apply_patch`, `todowrite`, `question`, …
- **No** hay un tool id `delete` dedicado: borrado vía **`bash`** o edición/patches.

---

## 5. Agentes (`packages/opencode/src/agent/`)

- **`agent.ts`**: Agentes nativos (`build`, `plan`, `explore`, **`sdd-orchestrator`**, **`sdd-*`**, `judgment-day`, …) con **`Permission.merge`**, prompts embebidos o desde archivo.
- Cada agente: `mode` (primary/subagent), `permission` (ruleset), opciones (`defer_heavy_prompt`, `compact_prompt`, …).

---

## 6. Permisos y configuración

- **`permission/index.ts`**: Rulesets (`allow` / `deny` / `ask`), evaluación por patrón, **`disabled()`** para filtrar ids de tools en `resolveTools`.
- **`config/config.ts`**: Schema grande (Zod): `permission`, `agent`, **`experimental.tool_router`** (`apply_hard_gates`, `additive`, `local_embed`, `exposure_mode`, …), MCP, providers.

---

## 7. Proveedores de modelo (`packages/opencode/src/provider/`)

- Abstracción multi-proveedor; transformación de schemas; integración Copilot/GitHub donde aplica.
- **`Flag`**: comportamiento por env (`OPENCODE_*`).

---

## 8. Plugins y MCP

- **`plugin/`**: Carga de plugins npm/path; hooks `tool.execute.before/after`, `tool.definition`.
- **`mcp/index.ts`**: Clientes MCP, tools dinámicos, timeouts.

---

## 9. Persistencia

- **`storage/db`**, **`session/session.sql`**: Sesiones, mensajes, permisos en SQLite (Drizzle).

---

## 10. TUI

- **`cli/cmd/tui/`**: Rutas, sesiones, sidebar de uso de tokens (último turno), autocompletado `@` agentes, integración OpenTUI según versión.

---

## 11. Paralelismo conceptual con otros productos

| Concepto OpenCode/Lightcode | Analogía aproximada |
|-----------------------------|---------------------|
| `session/prompt` + `resolveTools` | Bucle principal tipo `query` + registro de tools |
| `Permission` + `disabled` | Modo permiso / allowlist por tool |
| `ToolRouter` + `router-policy` | Selección de subconjunto de tools sin modelo extra |
| `Agent` + `task` | Agentes y delegación |
| `plugin` + MCP | Extensiones |

---

## 12. Documentación interna del fork

- **`README.md`** (raíz): guía del fork (tier minimal, router, wire-tier, SDD, debug).
- **`docs/lightcode-fork-vs-upstream.md`**, **`docs/CAMBIOS-FORK-ROUTER-Y-EVAL.md`**: diferencias respecto upstream.

Este repo prioriza **predecibilidad de coste** (menos tools en wire), **SDD** y **evaluación del router** (`packages/opencode/script/router-eval*.ts`).
