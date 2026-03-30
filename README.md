# Fork OpenCode (Lightcode / commonriskpro) — Guía

Rama por defecto de desarrollo: **`dev`**. Este documento resume los cambios del fork respecto al flujo upstream: optimización de tokens, router offline de herramientas, agentes SDD (Gentle AI), TUI y flags de entorno.

---

## Tabla de contenidos

1. [Inicio rápido](#inicio-rápido)
2. [Arquitectura: pipeline de optimización](#arquitectura-pipeline-de-optimización)
3. [Wire-tier y system prompt](#wire-tier-y-system-prompt)
4. [Tier inicial de tools (`minimal` / `full`)](#tier-inicial-de-tools-minimal--full)
5. [Router offline de herramientas](#router-offline-de-herramientas)
6. [Caché del system prompt](#caché-del-system-prompt)
7. [Debug de requests (`debug_request`)](#debug-de-requests-debug_request)
8. [Inyección global de documentación](#inyección-global-de-documentación)
9. [Agentes SDD y Gentle AI](#agentes-sdd-y-gentle-ai)
10. [TUI: logo y autocompletado `@`](#tui-logo-y-autocompletado-)
11. [Configuración: `.opencode` y `fork.opencode.env`](#configuración-opencode-y-forkopencodeenv)
12. [Build y tests](#build-y-tests)
13. [Archivos fuente relevantes](#archivos-fuente-relevantes)
14. [Documentación adicional](#documentación-adicional)
15. [Limitaciones conocidas](#limitaciones-conocidas)

---

## Inicio rápido

1. Abre el **repositorio como workspace** en el editor (la raíz debe resolver `gentle-ai/skills` vía `skills.paths` en `.opencode/opencode.jsonc`).
2. Opcional: carga variables del fork (solo las que no estén ya definidas):
   ```bash
   # Al arrancar `bin/opencode` desde el repo suele cargarse solo; para shell manual:
   set -a && source ./fork.opencode.env && set +a
   ```
   Para **no** cargar el archivo: `OPENCODE_SKIP_FORK_ENV=1`.
3. Build del binario local:
   ```bash
   cd packages/opencode && bun run build -- --single
   ```
4. CLI autocontenida (datos en `<repo>/.local-opencode`): `./scripts/opencode-isolated.sh` (véase sección [Build](#build-y-tests)).

### Perfil por defecto: router offline desde el **primer** prompt

En `.opencode/opencode.jsonc` el fork está alineado para que **desde el primer mensaje de usuario**:

- **`initial_tool_tier: full`** — no hay allowlist minimal fija; el pool base son los tools permitidos por el agente + MCP.
- **`tool_router.apply_after_first_assistant: false`** — el **router offline** filtra tools e inyecta en el system la línea de intención + lista de tool ids (`inject_prompt`).

Así el “asistente offline” (reglas por keywords sobre tu texto) elige qué tools incluir en la petición al modelo. El tool **`skill`** sigue en `base_tools` / reglas: el modelo puede cargar skills por nombre con el tool `skill`.

**Alternativa** (más barato en T1): `initial_tool_tier: minimal` + `apply_after_first_assistant: true` — primer turno solo `read`/`grep`/`glob`/`skill`; el router empieza tras el primer mensaje del assistant.

---

## Arquitectura: pipeline de optimización

En cada turno del bucle de chat (`packages/opencode/src/session/prompt.ts`), el orden conceptual es:

1. **Registro de tools** — permisos del agente, sesión, toggles de usuario, MCP.
2. **`applyInitialToolTier`** — si `experimental.initial_tool_tier` es `minimal` **y** el hilo **aún no tiene** mensaje `assistant`, se reduce a `read`, `grep`, `glob`, `skill` (y opcionalmente `bash` con `OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH`), con descripciones recortadas.
3. **`ToolRouter.apply`** — router offline por reglas (regex / “intent buckets”) sobre el **último mensaje de usuario**; recorta el mapa de tools y puede generar **`promptHint`** para el system.
4. **System prompt** — `SystemPromptCache.getParts` + líneas opcionales (router, tier minimal, structured output, etc.).

La política de **instrucciones mergeadas** (AGENTS.md, URLs, etc.) se coordina con **`wire-tier.ts`**. Si el router filtra el primer turno (`apply_after_first_assistant: false`), `mergedInstructionBodies` puede mantener instrucciones completas en T1 para que el modelo tenga contexto junto al subconjunto de tools.

---

## Wire-tier y system prompt

**Archivo:** `packages/opencode/src/session/wire-tier.ts`

- **`threadHasAssistant`**: el hilo ya tiene al menos un mensaje con rol `assistant`.
- **`includeInstructionBodies`**: con `initial_tool_tier: minimal`, las instrucciones mergeadas se omiten en el primer turno (hasta que exista assistant).
- **`routerFiltersFirstTurn`**: solo aplica si el router está activo **y** `tool_router.apply_after_first_assistant === false` (el router filtra también el primer turno del usuario).
- **`mergedInstructionBodies`**: decide si `SystemPromptCache` debe incluir cuerpos completos de instrucciones o el texto corto “deferred”.

Con **`apply_after_first_assistant: false`** y router activo, el **router recorta desde el primer turno**; con **`apply_after_first_assistant: true`**, el router espera al primer assistant (combinación habitual con **`initial_tool_tier: minimal`**).

---

## Tier inicial de tools (`minimal` / `full`)

**Archivo:** `packages/opencode/src/session/initial-tool-tier.ts`

- **`full`**: no recorta por tier; el mapa sigue siendo el de permisos + MCP.
- **`minimal`** (solo si **no** hay assistant en el hilo): allowlist fija `read`, `grep`, `glob`, `skill` (± `bash`).

**`minimalTierPromptHint`**: solo si el tier es **`minimal`** y aún no hay assistant: si `inject_prompt` está activo y el router no devolvió `promptHint`, se inyecta un bloque que lista la allowlist del primer turno. Con **`full`** + router desde T1, suele bastar el **`promptHint`** del router.

Precedencia env/config: `OPENCODE_INITIAL_TOOL_TIER` → `experimental.initial_tool_tier` → `full`.

---

## Router offline de herramientas

**Archivo:** `packages/opencode/src/session/tool-router.ts`

- Activo con `OPENCODE_TOOL_ROUTER=1` **o** `experimental.tool_router.enabled: true`.
- **Reglas** con etiquetas de intención (p. ej. `edit/refactor`, `delete/remove`, `shell/run`, español `borra`, `eliminar`, etc.).
- **`base_tools`**: siempre se intentan incluir primero (por defecto `read`, `task`, `skill`).
- **`max_tools`**: tope de tools “built-in” tras reglas (MCP puede añadirse aparte si `mcp_always_include` es true).
- **`apply_after_first_assistant`**:
  - **`true`** (recomendado con tier minimal): el router **no** se aplica hasta que exista un mensaje `assistant` → el primer turno lo gobierna solo el tier minimal.
  - **`false`**: el router filtra **desde el primer** mensaje del usuario (útil si no usas tier minimal).
- **`inject_prompt`**: si es true, se añade al system un bloque con intención detectada y lista de tool ids **cuando el router aplica**; en el primer turno con tier minimal, si el router no corre, entra **`minimalTierPromptHint`**.

**Especificación:** `packages/opencode/docs/spec-offline-tool-router.md`

---

## Caché del system prompt

**Archivo:** `packages/opencode/src/session/system-prompt-cache.ts`

- Partes cacheadas: entorno + skills + cuerpos de instrucciones (o texto deferred).
- TTL por defecto 30s; el fork puede subirlo con **`OPENCODE_SYSTEM_PROMPT_CACHE_MS`** (p. ej. `120000` en `fork.opencode.env`).
- La clave incluye si las instrucciones van “completas” o “deferred” (coordinado con `mergedInstructionBodies`).

---

## Debug de requests (`debug_request`)

**Archivos:** `packages/opencode/src/session/debug-request.ts`, integración en `llm.ts` y `processor.ts`.

Activo con **`OPENCODE_DEBUG_REQUEST=1`** o **`experimental.debug_request: true`**.

- **`phase=wire`**: `toolsBytes`, `promptBytes`, `systemBytes`, más `initial_tool_tier`, `thread_has_assistant`, `tool_router`.
- **`phase=usage`**: tokens y coste reportados por el proveedor.

**Guía breve:** `packages/opencode/docs/debug-request.md`

---

## Inyección global de documentación

- **`OPENCODE_DISABLE_GLOBAL_DOC_READS=1`** o **`experimental.disable_global_doc_reads: true`**
- Efecto: no se mergean rutas globales de instrucción (`~/.config/.../AGENTS.md`, `OPENCODE_CONFIG_DIR/AGENTS.md`, `~/.claude/CLAUDE.md`) y se añade una línea al system desaconsejando lecturas proactivas de `README.md`, `CLAUDE.md`, `package.json`.

**Archivos:** `packages/opencode/src/session/instruction.ts`, `packages/opencode/src/session/llm.ts`, `packages/opencode/src/flag/flag.ts`

---

## Agentes SDD y Gentle AI

- **Nativos** en `packages/opencode/src/agent/agent.ts`: `sdd-orchestrator` (primary), subagentes `sdd-explore`, `sdd-spec`, `sdd-apply`, `sdd-verify`, `sdd-propose`, `sdd-design`, `sdd-tasks`, `sdd-archive`, etc.
- **Prompt del orquestador:** `packages/opencode/src/agent/prompt/sdd-orchestrator.txt`
- **Override de proyecto:** `.opencode/opencode.jsonc` redefine p. ej. `sdd-orchestrator` con prompt `{file:../gentle-ai/AGENTS.md}` y permisos (`task` solo hacia `sdd-*`; `bash`/`edit`/`write` siguen el default allow para que el router offline pueda adjuntarlos por intención).
- **`sdd-init`** y prompts de fases suelen vivir solo en config apuntando a `gentle-ai/skills/.../SKILL.md`.
- **`sddSkillMap` en `llm.ts`**: inyecta líneas `@skill <nombre>` para agentes SDD; los nombres deben ser **skills registrados** (frontmatter `name:` en `SKILL.md`), no ids de tools como `write` o `edit`.

**Assets:** `gentle-ai/README.md`, carpeta `gentle-ai/skills/`.

---

## TUI: logo y autocompletado `@`

- Logo ASCII con marca **commonriskpro** junto al logo opencode: `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- Picker de agentes con `@`: solo **`sdd-orchestrator`** como primary visible además del flujo habitual; subagentes SDD permanecen ocultos en el picker según lógica en `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`

---

## Configuración: `.opencode` y `fork.opencode.env`

### `.opencode/opencode.jsonc` (resumen actual)

| Clave | Rol |
|--------|-----|
| `skills.paths` | `["gentle-ai/skills"]` (raíz del workspace = repo) |
| `experimental.initial_tool_tier` | `full` — pool completo antes del router; usar `minimal` para ahorrar en T1 |
| `experimental.debug_request` | Logs de wire/usage (poner `false` en producción si molesta) |
| `experimental.tool_router.enabled` | Router offline |
| `experimental.tool_router.apply_after_first_assistant` | `false` — router desde el primer user turn |
| `experimental.tool_router.inject_prompt` | `true` — texto de intención + tools en system |
| `experimental.tool_router.base_tools` / `max_tools` | Base y tope de recorte |
| `agent.sdd-orchestrator` | Primary SDD; prompt desde `gentle-ai/AGENTS.md` |

### `fork.opencode.env`

| Variable | Uso típico en el fork |
|----------|------------------------|
| `OPENCODE_PORTABLE_ROOT` | Datos locales bajo `<repo>/.local-opencode` |
| `OPENCODE_TOOL_ROUTER` | `1` — activa router |
| `OPENCODE_INITIAL_TOOL_TIER` | `full` — alineado con JSON |
| `OPENCODE_DISABLE_GLOBAL_DOC_READS` | `1` — sin merge global de AGENTS/CLAUDE home |
| `OPENCODE_SYSTEM_PROMPT_CACHE_MS` | TTL más largo para caché de system |
| `OPENCODE_DEBUG_REQUEST` | Opcional; suele bastar `experimental.debug_request` en JSON |

---

## Build y tests

```bash
cd packages/opencode && bun run build -- --single
cd packages/opencode && bun typecheck
```

Tests relevantes (desde `packages/opencode`, no desde la raíz del monorepo):

```bash
cd packages/opencode
bun test test/session/wire-tier.test.ts test/session/tool-router.test.ts test/session/initial-tool-tier.test.ts --preload ./test/preload.ts
bun test test/agent/agent.test.ts --preload ./test/preload.ts
```

Regenerar SDK JS si aplica: `./packages/sdk/js/script/build.ts` (véase `AGENTS.md` en la raíz).

---

## Archivos fuente relevantes

| Área | Ruta principal |
|------|----------------|
| Wire-tier | `packages/opencode/src/session/wire-tier.ts` |
| Tier minimal | `packages/opencode/src/session/initial-tool-tier.ts` |
| Router | `packages/opencode/src/session/tool-router.ts` |
| Bucle prompt + `resolveTools` | `packages/opencode/src/session/prompt.ts` |
| LLM stream + `sddSkillMap` | `packages/opencode/src/session/llm.ts` |
| Caché system | `packages/opencode/src/session/system-prompt-cache.ts` |
| Debug | `packages/opencode/src/session/debug-request.ts` |
| Instrucciones / global docs | `packages/opencode/src/session/instruction.ts` |
| Flags | `packages/opencode/src/flag/flag.ts` |
| Config schema | `packages/opencode/src/config/config.ts` |
| Agentes | `packages/opencode/src/agent/agent.ts` |

---

## Documentación adicional

- Especificación router offline: `packages/opencode/docs/spec-offline-tool-router.md`
- Índice implementación: `packages/opencode/docs/offline-tool-router-implementation.md`
- Debug request: `packages/opencode/docs/debug-request.md`
- Gentle AI (skills, AGENTS): `gentle-ai/README.md`

---

## Limitaciones conocidas

- **`tool_router.fallback`** en JSON está descrito en el spec; la expansión automática a tools completas en error puede no estar cableada al 100% — revisar el spec §7.
- El router es **por palabras clave / regex**, no un modelo de embeddings; paráfrasis raras pueden no coincidir reglas.
- Tests de agente que tocan config real pueden requerir `--preload ./test/preload.ts` (véase `packages/opencode/test/preload.ts`).

---

*Última actualización de esta guía: alineada con el fork en rama `dev` (token pipeline, SDD, TUI, flags y docs listados arriba).*

---

## Upstream OpenCode

Este repositorio es un fork de [OpenCode](https://github.com/anomalyco/opencode). Instalación por curl/npm/Homebrew, app de escritorio, agentes integrados y FAQ del proyecto original: [README.upstream.md](README.upstream.md).
