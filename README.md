# Fork OpenCode (Lightcode / commonriskpro) — Guía

Rama por defecto de desarrollo: **`dev`**. Este documento resume los cambios del fork respecto al flujo upstream: optimización de tokens, router offline de herramientas, agentes SDD (Gentle AI), TUI y flags de entorno.

---

## Tabla de contenidos

1. [Guía 5W (qué, por qué, cómo, cuándo, dónde)](#guía-5w-qué-por-qué-cómo-cuándo-dónde)
2. [Inicio rápido](#inicio-rápido)
3. [Arquitectura: pipeline de optimización](#arquitectura-pipeline-de-optimización)
4. [Wire-tier y system prompt](#wire-tier-y-system-prompt)
5. [Tier inicial de tools (`minimal` / `full`)](#tier-inicial-de-tools-minimal--full)
6. [Router offline de herramientas](#router-offline-de-herramientas)
7. [Caché del system prompt](#caché-del-system-prompt)
8. [Debug de requests (`debug_request`)](#debug-de-requests-debug_request)
9. [Inyección global de documentación](#inyección-global-de-documentación)
10. [Agentes SDD y Gentle AI](#agentes-sdd-y-gentle-ai) (incl. [Engram](#memoria-engram-mcp))
11. [Skill registry y plugins (orquestador)](#skill-registry-y-plugins-orquestador)
12. [TUI: contexto, logo y autocompletado `@`](#tui-contexto-logo-y-autocompletado-)
13. [Configuración: `.opencode` y `fork.opencode.env`](#configuración-opencode-y-forkopencodeenv)
14. [Build y tests](#build-y-tests)
15. [Archivos fuente relevantes](#archivos-fuente-relevantes)
16. [Documentación adicional](#documentación-adicional)
17. [Limitaciones conocidas](#limitaciones-conocidas)

---

## Guía 5W (qué, por qué, cómo, cuándo, dónde)

### Qué es

Este fork de [OpenCode](https://github.com/anomalyco/opencode) apunta a **menor coste por turno**, **control explícito de herramientas** sin llamadas extra al modelo y a un flujo **SDD** (Spec-Driven Development) con agentes y skills propios (**Gentle AI**).

| Pieza | Rol breve |
|--------|-----------|
| **Tier inicial de tools** (`minimal` / `full`) | Limita qué herramientas ve el modelo en el **primer** turno del hilo (cuando aún no hay mensaje `assistant`). |
| **Router offline de herramientas** | Recorta el mapa de tools según **reglas por texto** del último mensaje de usuario (regex / intenciones), sin embeddings. |
| **Wire-tier** | Decide si las instrucciones largas (AGENTS, URLs) van completas o “deferred” según tier y router. |
| **Agentes SDD** | Orquestador y subagentes (`sdd-explore`, `sdd-spec`, `sdd-apply`, …) con prompts y permisos en el repo. |
| **Métricas de contexto en TUI** | Muestra el **tamaño del prompt del último turno** (no la suma acumulada de toda la sesión). |
| **Flags y `fork.opencode.env`** | Portable root, router, tier, caché de system prompt, lecturas globales de docs, etc. |

**Qué no es:** el router no sustituye al modelo para “entender” la intención; las reglas son **explícitas** (palabras clave). Si algo no coincide, entran `base_tools`, `no_match_fallback` o el pool completo según config.

### Por qué

| Motivo | Explicación |
|--------|-------------|
| **Coste y tokens** | Enviar **todas** las definiciones de tools en cada request encarece el prompt. Recortar el mapa y acortar descripciones en T1 reduce bytes al modelo. |
| **Predecibilidad** | El subconjunto de tools queda acotado por **config + reglas**, reproducible entre sesiones. |
| **Primer turno barato** | Con `minimal`, el primer mensaje no arrastra un catálogo enorme de herramientas si no hace falta. |
| **Investigación y SDD** | Incluir `webfetch`/`websearch` en el tier minimal **cuando el agente y la sesión lo permiten** evita depender solo del router para tareas tipo `sdd-explore`. |
| **Transparencia en la TUI** | Mostrar **input + caché** del último turno alinea la UI con “cuánto contexto ocupa este prompt”, no con facturación acumulada. |

### Cómo funciona

En cada vuelta del bucle de chat (`packages/opencode/src/session/prompt.ts`):

1. **Registro completo de tools** (permisos del agente, sesión, toggles, MCP, structured output si aplica).
2. **`applyInitialToolTier`** — Si `initial_tool_tier === "minimal"` y el hilo **no tiene** aún ningún mensaje `assistant`, allowlist base más `bash` / `webfetch` / `websearch` según reglas; descripciones **slim**.
3. **`ToolRouter.apply`** — Si el router está activo y toca en este turno, filtra o amplía según el **último texto de usuario** y la config (`additive`, `base_tools`, `max_tools`, `no_match_fallback`, …). Puede generar **`promptHint`**.
4. **System prompt** — `SystemPromptCache` + instrucciones mergeadas (`wire-tier`) + hints del router o del tier minimal.
5. **Llamada al modelo** — Con el **historial completo** de la sesión (chat estándar; salvo compactación).

**Tokens en la sidebar:** `packages/opencode/src/cli/cmd/tui/util/session-usage.ts` — prompt del último turno ≈ `input + cache.read + cache.write`, con refuerzo vía `total` del proveedor si hace falta. Detalle en la sección [TUI](#tui-contexto-logo-y-autocompletado-) más abajo.

### Cuándo aplica cada cosa

| Situación | Comportamiento |
|-----------|----------------|
| **Primer turno** + `minimal` y aún **no** hay mensaje `assistant` | Tier minimal: allowlist reducida (+ web si permisos). Router **no** corre si `apply_after_first_assistant: true`. |
| **Primer turno** + `apply_after_first_assistant: false` y router activo | El router **sí** puede filtrar desde el primer mensaje; `wire-tier` puede mantener instrucciones completas. |
| **Tras el primer** mensaje `assistant` | El tier minimal **deja de aplicarse**. El router aplica según su config. |
| **Compactación** | Por umbral de tokens (`compaction` / `overflow`): resumen del hilo. Capa distinta del router. |
| **`debug_request: true`** | Logs `phase=wire` / `phase=usage`; por defecto desactivado en el JSON del repo. |

Por defecto en este repo: **`minimal` + `apply_after_first_assistant: true`** → el **primer** intercambio lo limita casi solo el tier; **desde el segundo** turno de usuario entra el router sobre el pool completo (salvo otras restricciones).

### Dónde está cada cosa

**Configuración habitual**

| Dónde | Para qué |
|--------|----------|
| **`.opencode/opencode.jsonc`** (raíz del workspace) | `experimental.*`, `agent.*`, `skills.paths`, prompts `{file:...}`. |
| **`fork.opencode.env`** (raíz del repo) | Variables del fork; opcional si `bin/opencode` carga el archivo solo. |
| **`gentle-ai/AGENTS.md`** | Orquestador SDD cuando el JSON apunta ahí. |
| **`gentle-ai/skills/**`** | Skills (`SKILL.md`, frontmatter `name:`). |
| **`.atl/skill-registry.md`** | Catálogo generado (triggers, rutas a `SKILL.md`, convenciones). Ver [Skill registry](#skill-registry-y-plugins-orquestador). |

**Código (desde raíz del repo)**

| Ruta | Responsabilidad |
|------|-----------------|
| `packages/opencode/src/session/prompt.ts` | Bucle, `resolveTools`, orden tier → router → system. |
| `packages/opencode/src/session/initial-tool-tier.ts` | Allowlist minimal y `minimalTierPromptHint`. |
| `packages/opencode/src/session/tool-router.ts` | Reglas offline. |
| `packages/opencode/src/session/wire-tier.ts` | Instrucciones mergeadas vs deferred. |
| `packages/opencode/src/session/system-prompt-cache.ts` | Caché del system prompt. |
| `packages/opencode/src/cli/cmd/tui/util/session-usage.ts` | Contexto en TUI. |
| `packages/opencode/src/agent/agent.ts` | Agentes SDD y permisos. |
| `packages/opencode/src/agent/prompt/sdd-*.txt` | Prompts por fase. |
| `gentle-ai/lib/skill-registry.ts` | Generación del índice `.atl/skill-registry.md` (escaneo de skills + convenciones). |
| `gentle-ai/plugins/skill-registry-plugin.ts` | Plugin: inyecta el registry al **orquestador** una vez por sesión. |
| `gentle-ai/plugins/background-agents.ts` | Plugin: `delegate` / `delegation_read` / `delegation_list` + reglas en system prompt. |

**Scripts y datos locales:** `./scripts/opencode-isolated.sh` — datos bajo `<repo>/.local-opencode` (`OPENCODE_PORTABLE_ROOT`).

**Más detalle por tema:** las secciones siguientes de este README ([Arquitectura](#arquitectura-pipeline-de-optimización), [Tier](#tier-inicial-de-tools-minimal--full), [Router](#router-offline-de-herramientas), etc.) amplían cada pieza. Especificación larga del router: `packages/opencode/docs/spec-offline-tool-router.md`.

### Primer uso: inicio rápido y CLI autocontenida

La guía **paso a paso** está en [Inicio rápido](#inicio-rápido) y el build en [Build y tests](#build-y-tests). Aquí va el mapa:

| Paso | Qué haces | Por qué importa |
|------|-----------|-----------------|
| 1 | Abrir la **raíz del repo** como workspace en el editor | `skills.paths` y `.opencode/opencode.jsonc` resuelven rutas desde esa raíz. |
| 2 | (Opcional) `source ./fork.opencode.env` en la shell | Carga variables del fork si no arrancas vía `bin/opencode` (que puede cargarlas solo). `OPENCODE_SKIP_FORK_ENV=1` las evita. |
| 3 | `cd packages/opencode && bun run build -- --single` | Genera el binario por plataforma bajo `packages/opencode/dist/opencode-*/bin/opencode` (el script aislado lo detecta). |
| 4 | Lanzar la CLI con **`./scripts/opencode-isolated.sh`** | Modo **autocontenido**: datos solo bajo `<repo>/.local-opencode`, sin usar el árbol global de OpenCode (véase tabla siguiente). |

**Si ya tienes OpenCode instalado (npm, Homebrew, curl, etc.):** el ejecutable suele estar en el `PATH` y, por defecto, guarda **configuración, estado y caché en rutas XDG** del usuario (p. ej. en macOS/Linux algo equivalente a `~/.config/opencode`, `~/.cache`, `~/.local/state` según plataforma). Eso es **independiente** de este repo: si lanzas `opencode` así, **no** estás usando el perfil portable del fork y puedes mezclar sesiones, modelos o credenciales con tu instalación habitual.

| Modo | Dónde viven datos y config | Cuándo ocurre |
|------|----------------------------|---------------|
| **Instalación global** (`opencode` en PATH) | Directorios estándar del usuario (XDG / Application Support, etc.) | Comando `opencode` sin variables de portable del fork. |
| **Fork autocontenido** | Solo bajo **`<clon>/.local-opencode/`** (`data/`, `cache/`, `config/`, `state/` por app) | `OPENCODE_PORTABLE_ROOT` apunta ahí (lo fija `fork.opencode.env` al usar el `bin/opencode` **del repo**, o **siempre** `scripts/opencode-isolated.sh`). |

**Recomendación:** para trabajar con **este** fork sin contaminar ni ser contaminado por el OpenCode global, usa **`./scripts/opencode-isolated.sh`** (o la ruta absoluta al script en tu clon). Así se fuerza `OPENCODE_PORTABLE_ROOT` y se ejecuta el launcher del repo (`packages/opencode/bin/opencode`), que además puede cargar `fork.opencode.env` y preferir el binario compilado en `dist/` tras el build. Desde cualquier directorio: `/ruta/al/clon/scripts/opencode-isolated.sh`. Opcional: `OPENCODE_BIN_PATH` para fijar un binario concreto. **Embeddings del router (Xenova):** el worker corre en un subproceso Node; en autocontenido, `opencode-isolated.sh` exporta `OPENCODE_ROUTER_EMBED_NODE` desde tu shell si existe `node`, y el launcher Node añade la misma ruta que `process.execPath` cuando `OPENCODE_PORTABLE_ROOT` está activo (así el binario Bun recibe la ruta aunque su `PATH` sea mínimo).

**Resumen:** el build sigue siendo necesario (`bun run build -- --single`); el script aislado no lo sustituye. `.local-opencode/` está en `.gitignore`. Detalle de comandos y tests: [Inicio rápido](#inicio-rápido) (incluye bloque *global vs autocontenido*) y [Build y tests](#build-y-tests).

### Quién (opcional)

Equipos que quieren **políticas de herramientas** afinadas, flujo **SDD** con skills en repo y **métricas de contexto** alineadas al último prompt. Upstream: [anomalyco/opencode](https://github.com/anomalyco/opencode). Fork: **commonriskpro**.

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

### OpenCode global vs. fork autocontenido

Muchos usuarios **ya tienen OpenCode instalado** en el sistema. Esa instalación usa por defecto las **rutas globales del usuario** (config/caché/estado fuera del repo). Si escribes solo `opencode` en la terminal, el shell puede estar ejecutando **ese** binario: leerá y escribirá ahí, no en el clon del fork.

Para usar **solo** el árbol portable de este repo (**`<raíz-del-clon>/.local-opencode`**, sin mezclar con el OpenCode global):

1. **Preferido:** arranca siempre con el script del clon (desde cualquier carpeta, con ruta absoluta si quieres):
   ```bash
   /ruta/a/lightcode/scripts/opencode-isolated.sh
   ```
   El script exporta `OPENCODE_PORTABLE_ROOT` y llama al `bin/opencode` del repositorio (véase `scripts/opencode-isolated.sh`).
2. **Alternativa:** exporta tú mismo la raíz portable y usa el launcher del repo tras el build:
   ```bash
   export OPENCODE_PORTABLE_ROOT="/ruta/a/lightcode/.local-opencode"
   /ruta/a/lightcode/packages/opencode/bin/opencode
   ```
3. El launcher **`packages/opencode/bin/opencode`** y el binario compilado resuelven la raíz del repo con **`fork.opencode.env`** cuando existe en el **directorio de trabajo actual** (típicamente `cd` a la raíz del clon) o vía `OPENCODE_REPO_ROOT` / ruta del ejecutable bajo `dist/` (véase `packages/opencode/src/util/fork-env.ts`). Ahí se puede fijar `OPENCODE_PORTABLE_ROOT` hacia `.local-opencode`. Con `OPENCODE_SKIP_FORK_ENV=1` no se carga ese archivo. Si en la terminal ejecutas **otro** `opencode` del `PATH`, no aplica ninguna de esto.

**Regla práctica:** si no estás seguro, no uses el `opencode` global para este proyecto; usa **`opencode-isolated.sh`** o el `bin/opencode` del clon con `OPENCODE_PORTABLE_ROOT` definido.

**MCP en modo portable (estricto):** con `OPENCODE_PORTABLE_ROOT`, la config global es solo **`<portable>/config/opencode/`**; **no** se lee `~/.config/opencode` ni el `mcp` de la instalación global. Los MCP deben declararse en el **repo** (`.opencode/opencode.jsonc`) y/o copiar lo que necesites a **`OPENCODE_PORTABLE_ROOT/config/opencode/opencode.jsonc`** si quieres datos solo bajo el árbol portable.

### Perfil en el repo (`.opencode/opencode.jsonc`)

Por defecto en este fork (rama `dev`):

- **`initial_tool_tier: minimal`** — primer turno con allowlist reducida (véase [Tier inicial](#tier-inicial-de-tools-minimal--full)); luego pool completo según permisos y router.
- **`tool_router.apply_after_first_assistant: true`** — el router offline **no** aplica hasta que exista un mensaje `assistant`; el primer turno lo fija solo el tier minimal (+ `webfetch`/`websearch` si el agente y la sesión los permiten).
- **`experimental.debug_request: false`** — sin logs `debug-request` salvo que lo actives.

El tool **`skill`** sigue en `base_tools` / reglas cuando el router corre; el modelo puede cargar skills por nombre.

**Otra configuración habitual:** `initial_tool_tier: full` + `tool_router.apply_after_first_assistant: false` — router desde el **primer** mensaje de usuario sobre el pool completo de tools; el “asistente offline” elige el subconjunto por keywords e inyecta `inject_prompt`.

---

## Arquitectura: pipeline de optimización

En cada turno del bucle de chat (`packages/opencode/src/session/prompt.ts`), el orden conceptual es:

1. **Registro de tools** — permisos del agente, sesión, toggles de usuario, MCP.
2. **`applyInitialToolTier`** — si `experimental.initial_tool_tier` es `minimal` **y** el hilo **aún no tiene** mensaje `assistant`, se reduce a `read`, `grep`, `glob`, `skill` (y opcionalmente `bash`; y `webfetch`/`websearch` si la sesión los permite, como el agente `sdd-explore`), con descripciones recortadas.
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
- **`minimal`** (solo si **no** hay assistant en el hilo): allowlist base `read`, `grep`, `glob`, `skill`; se añaden **`bash`** (según env/permiso), **`webfetch`** y **`websearch`** cuando el ruleset de la sesión los permite (no dependen solo del router).

**`minimalTierPromptHint`**: solo si el tier es **`minimal`** y aún no hay assistant: si `inject_prompt` está activo y el router no devolvió `promptHint`, se inyecta un bloque que lista la allowlist del primer turno. Con **`full`** + router desde T1, suele bastar el **`promptHint`** del router.

Precedencia env/config: `OPENCODE_INITIAL_TOOL_TIER` → `experimental.initial_tool_tier` → `full`.

---

## Router offline de herramientas

**Archivos:** `packages/opencode/src/session/tool-router.ts` (orquestación), `router-embed.ts` / `router-embed-impl.ts` (Xenova: intención + similitud por tool), `router-policy.ts` (puertas léxicas, cláusulas multi-acción, conflictos web/edit/grep, dependencia mínima de `read`).

- Activo con `OPENCODE_TOOL_ROUTER=1` **o** `experimental.tool_router.enabled: true`.
- **Intención local** (`local_intent_embed: true`): prototipos multilingües + fusión **top-N** dentro de `intent_merge_margin` (ver config); la intención **conversation** sigue siendo conservadora (sin tools cuando gana clara).
- **`keyword_rules`**: por defecto **`false`** (solo intención + embeddings + política). Con **`keyword_rules: true`** se unen las **regex `RULES`** del router al texto del usuario (etiquetas `edit/refactor`, `delete/remove`, `shell/run`, español `borra`, `eliminar`, etc.).
- **`base_tools`**: se unen cuando hay señal de routing (intención, reglas, augment, sticky o `no_match_fallback`), no fuerzan tools en señal cero; por defecto `read`, `task`, `skill`.
- **`max_tools`**: tope de tools “built-in” tras reglas (MCP puede añadirse aparte si `mcp_always_include` es true).
- **`apply_after_first_assistant`**:
  - **`true`** (recomendado con tier minimal): el router **no** se aplica hasta que exista un mensaje `assistant` → el primer turno lo gobierna solo el tier minimal.
  - **`false`**: el router filtra **desde el primer** mensaje del usuario (útil si no usas tier minimal).
- **`inject_prompt`**: si es true, se añade al system un bloque con intención detectada y lista de tool ids **cuando el router aplica**; en el primer turno con tier minimal, si el router no corre, entra **`minimalTierPromptHint`**.

**Especificación:** `packages/opencode/docs/spec-offline-tool-router.md`

**Eval offline (dataset JSONL + métricas sin modelo de chat):** `packages/opencode/docs/router-eval.md` — `bun run router:eval` desde `packages/opencode`. **Puerta de regresión estricta (subset revisado congelado):** `bun run router:eval:reviewed:gate` (exige **100%** pass en `router-eval-reviewed.jsonl`). El dataset **expanded** es exploratorio; ver docs para `router:eval:expanded:breakdown` y el advisory opcional. **Coste estimado de definiciones de tools (bytes/tokens, extras por coste):** `bun run router:eval:tool-costs` y `--breakdown` en el harness.

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
- **Prompt por defecto upstream del orquestador:** `packages/opencode/src/agent/prompt/sdd-orchestrator.txt`
- **Este fork:** `.opencode/opencode.jsonc` redefine `sdd-orchestrator` con prompt **`{file:../gentle-ai/AGENTS.md}`** y permisos (`task` solo hacia `sdd-*`, más **`delegate`** / **`delegation_*`** si usáis el plugin; `bash`/`edit`/`write` siguen el default allow para que el router offline pueda adjuntarlos por intención).
- **`sdd-init`** y prompts de fases suelen vivir solo en config apuntando a `gentle-ai/skills/.../SKILL.md`.
- **`sddSkillMap` en `llm.ts`**: inyecta líneas `@skill <nombre>` para agentes SDD; los nombres deben ser **skills registrados** (frontmatter `name:` en `SKILL.md`), no ids de tools como `write` o `edit`.

**Assets:** `gentle-ai/README.md`, carpeta `gentle-ai/skills/`.

### MCP: Engram + Context7

- **Engram** — memoria persistente (`engram mcp`). Requiere el binario **`engram`** en PATH. Guía: **[docs/engram-opencode.md](docs/engram-opencode.md)**.
- **Context7** — documentación actual de librerías (`npx -y @upstash/context7-mcp`). Requiere **Node/npx**; API key opcional `CONTEXT7_API_KEY` ([dashboard](https://context7.com/dashboard)). Guía: **[docs/context7-opencode.md](docs/context7-opencode.md)**.

Ambos están declarados en **`.opencode/opencode.jsonc`**. Si falta `engram` o `npx`, el servidor correspondiente puede fallar al conectar.

---

## Skill registry y plugins (orquestador)

El **skill registry** es un índice en **`.atl/skill-registry.md`**: tabla de triggers, nombres de skill y rutas absolutas a cada `SKILL.md`, más una sección de **convenciones de proyecto** (`AGENTS.md`, `.cursorrules`, etc.). Sirve para que el orquestador resuelva rutas **una vez por sesión** y las pase a los sub-agentes (ver `gentle-ai/AGENTS.md` y [docs/gentle-ai-parity-map.md](docs/gentle-ai-parity-map.md)).

| Acción | Cómo |
|--------|------|
| **Regenerar el archivo** | En la raíz del repo: `bun run skill-registry`. Opcional: `bun run gentle-ai/script/skill-registry.ts /ruta/al/proyecto`. Ejecuta tras instalar o quitar skills globales, o al cambiar convenciones indexadas. |
| **Inyección en runtime** | El plugin **`gentle-ai/plugins/skill-registry-plugin.ts`** (`SkillRegistryPlugin`) añade el contenido del registry al system prompt del agente **`sdd-orchestrator`** **solo la primera vez** de cada sesión (no en cada turno; no aplica en llamadas “small”). Si `.atl/skill-registry.md` no existe, el plugin **lo genera** antes de inyectar. |
| **Delegación en segundo plano** | El plugin **`gentle-ai/plugins/background-agents.ts`** (`BackgroundAgents`) expone `delegate`, `delegation_read` y `delegation_list`; los resultados largos se guardan bajo **`~/.local/share/opencode/delegations/<id-proyecto>/`**. |

**Implementación en el core:** el hook `experimental.chat.system.transform` recibe **`agent`** y **`small`** además de `sessionID` y `model` (`packages/plugin`, `packages/opencode/src/session/llm.ts`), para que los plugins no mezclen inyecciones pesadas con completions pequeños.

**Config en este repo:** `.opencode/opencode.jsonc` incluye `plugin` apuntando a ambos archivos; **`sdd-orchestrator`** declara permisos `delegate`, `delegation_read` y `delegation_list` junto a `task` → `sdd-*`.

**Engram:** el topic `skill-registry` vía `mem_save` sigue siendo opcional (skill o MCP); el script CLI solo escribe disco.

---

## TUI: contexto, logo y autocompletado `@`

- **Contexto (sidebar y barra inferior):** el número grande es el **tamaño aproximado del prompt del último turno** (`packages/opencode/src/cli/cmd/tui/util/session-usage.ts`): `input + cache.read + cache.write` del último mensaje `assistant`, con respeto a `total - output - reasoning` si el proveedor subdeclara el input. **No** es la suma acumulada de todos los turnos (eso sería volumen de facturación, no “contexto actual”). El **% used** usa la misma base frente al límite de contexto del modelo.
- Logo ASCII en bloque **LIGHT+CODE** (mismo estilo que OPEN+CODE: mitad atenuada / mitad resaltada): `packages/opencode/src/cli/logo.ts`, `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- Picker de agentes con `@`: solo **`sdd-orchestrator`** como primary visible además del flujo habitual; subagentes SDD permanecen ocultos en el picker según lógica en `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`

---

## Configuración: `.opencode` y `fork.opencode.env`

### `.opencode/opencode.jsonc` (resumen actual)

| Clave | Rol |
|--------|-----|
| `skills.paths` | `["gentle-ai/skills"]` (raíz del workspace = repo) |
| `experimental.initial_tool_tier` | `minimal` en el repo — primer turno allowlist acotada (+ web si permisos); `full` = sin recorte por tier |
| `experimental.debug_request` | `false` por defecto; `true` → logs wire/usage (`debug-request`) |
| `experimental.tool_router.enabled` | Router offline |
| `experimental.tool_router.apply_after_first_assistant` | `true` en el repo — router tras el primer `assistant`; `false` = router desde el primer user turn |
| `experimental.tool_router.inject_prompt` | `true` — texto de intención + tools en system |
| `experimental.tool_router.base_tools` / `max_tools` | Base y tope de recorte |
| `agent.sdd-orchestrator` | Primary SDD; prompt desde `gentle-ai/AGENTS.md`; permisos `delegate` / `delegation_*` para el plugin BackgroundAgents |
| `plugin` | En el repo: `gentle-ai/plugins/skill-registry-plugin.ts` y `gentle-ai/plugins/background-agents.ts` (rutas relativas al JSONC) |
| `mcp.engram` | Servidor local `engram mcp` — memoria persistente (`mem_save`, `mem_search`, …) |
| `mcp.context7` | Servidor local `npx -y @upstash/context7-mcp` — docs de librerías (`resolve-library-id`, `query-docs`) |

### `fork.opencode.env`

| Variable | Uso típico en el fork |
|----------|------------------------|
| `OPENCODE_PORTABLE_ROOT` | Datos locales bajo `<repo>/.local-opencode` |
| `OPENCODE_TOOL_ROUTER` | `1` — activa router |
| `OPENCODE_INITIAL_TOOL_TIER` | Opcional; si no se define, rige `experimental.initial_tool_tier` del JSON |
| `OPENCODE_DISABLE_GLOBAL_DOC_READS` | `1` — sin merge global de AGENTS/CLAUDE home |
| `OPENCODE_SYSTEM_PROMPT_CACHE_MS` | TTL más largo para caché de system |
| `OPENCODE_DEBUG_REQUEST` | Opcional; suele bastar `experimental.debug_request` en JSON |
| `ENGRAM_PROJECT` | Opcional; ancla el nombre de proyecto Engram (véase `docs/engram-opencode.md`) |
| `CONTEXT7_API_KEY` | Opcional; mejora límites de Context7 (véase `docs/context7-opencode.md`) |

---

## Build y tests

```bash
cd packages/opencode && bun run build -- --single
cd packages/opencode && bun typecheck
# Opcional: regenerar .atl/skill-registry.md (raíz del monorepo)
bun run skill-registry
```

Tests relevantes (desde `packages/opencode`, no desde la raíz del monorepo):

```bash
cd packages/opencode
bun test test/session/wire-tier.test.ts test/session/tool-router.test.ts test/session/initial-tool-tier.test.ts test/cli/session-usage.test.ts --preload ./test/preload.ts
bun test test/agent/agent.test.ts --preload ./test/preload.ts
```

Regenerar SDK JS si aplica: `./packages/sdk/js/script/build.ts` (véase `AGENTS.md` en la raíz).

---

## Archivos fuente relevantes

| Área | Ruta principal |
|------|----------------|
| Wire-tier | `packages/opencode/src/session/wire-tier.ts` |
| Tier minimal | `packages/opencode/src/session/initial-tool-tier.ts` |
| Métricas contexto TUI | `packages/opencode/src/cli/cmd/tui/util/session-usage.ts` |
| Router | `packages/opencode/src/session/tool-router.ts` |
| Bucle prompt + `resolveTools` | `packages/opencode/src/session/prompt.ts` |
| LLM stream + `sddSkillMap` + hook `experimental.chat.system.transform` | `packages/opencode/src/session/llm.ts` |
| Tipos de hooks de plugin | `packages/plugin/src/index.ts` |
| Caché system | `packages/opencode/src/session/system-prompt-cache.ts` |
| Skill registry (generador) | `gentle-ai/lib/skill-registry.ts`, `gentle-ai/script/skill-registry.ts` |
| Plugins Gentle AI | `gentle-ai/plugins/skill-registry-plugin.ts`, `gentle-ai/plugins/background-agents.ts` |
| Debug | `packages/opencode/src/session/debug-request.ts` |
| Instrucciones / global docs | `packages/opencode/src/session/instruction.ts` |
| Flags | `packages/opencode/src/flag/flag.ts` |
| Config schema | `packages/opencode/src/config/config.ts` |
| Agentes | `packages/opencode/src/agent/agent.ts` |

---

## Documentación adicional

- **Inicio rápido autocontenido (Linux y Windows / WSL):** [docs/INICIO-RAPIDO-AUTOCONTENIDO-WIN-LINUX.md](docs/INICIO-RAPIDO-AUTOCONTENIDO-WIN-LINUX.md) — pasos detallados para `OPENCODE_PORTABLE_ROOT`, build y arranque fuera de macOS.
- **Guía 5W** (resumen ejecutivo): [sección al inicio de este README](#guía-5w-qué-por-qué-cómo-cuándo-dónde); copia corta en `docs/LIGHTCODE-GUIA-5W.md` (redirige al README).
- Especificación router offline: `packages/opencode/docs/spec-offline-tool-router.md`
- Índice implementación: `packages/opencode/docs/offline-tool-router-implementation.md`
- Benchmarks offline (grid `exact_match`, rejilla ratio×min, fallos): [docs/tool-router-exact-match-benchmark.md](docs/tool-router-exact-match-benchmark.md)
- Debug request: `packages/opencode/docs/debug-request.md`
- Métricas de contexto (TUI): `packages/opencode/src/cli/cmd/tui/util/session-usage.ts` (véase [Guía 5W](#guía-5w-qué-por-qué-cómo-cuándo-dónde) y [TUI](#tui-contexto-logo-y-autocompletado-))
- Gentle AI (skills, AGENTS): `gentle-ai/README.md`
- Engram (MCP + CLI): [docs/engram-opencode.md](docs/engram-opencode.md)
- Context7 (MCP docs): [docs/context7-opencode.md](docs/context7-opencode.md)
- Multi-mode SDD (modelo por fase): [docs/multi-mode-sdd.md](docs/multi-mode-sdd.md)
- Mapa de paridad gentle-ai (bloques A–J, FAQ tokens/registry): [docs/gentle-ai-parity-map.md](docs/gentle-ai-parity-map.md)
- Spec paridad gentle-ai: [docs/gentle-ai-implementation-spec.md](docs/gentle-ai-implementation-spec.md)

---

## Limitaciones conocidas

- **`tool_router.fallback`** en JSON está descrito en el spec; la expansión automática a tools completas en error puede no estar cableada al 100% — revisar el spec §7.
- El router es **por palabras clave / regex**, no un modelo de embeddings; paráfrasis raras pueden no coincidir reglas.
- Tests de agente que tocan config real pueden requerir `--preload ./test/preload.ts` (véase `packages/opencode/test/preload.ts`).

---

*Última actualización de esta guía: alineada con el fork en rama `dev` (guía 5W en este README, tier minimal + web, métricas de contexto en TUI, router, SDD, skill registry + plugins del orquestador, flags y docs listados arriba).*

---

## Upstream OpenCode

Este repositorio es un fork de [OpenCode](https://github.com/anomalyco/opencode). Instalación por curl/npm/Homebrew, app de escritorio, agentes integrados y FAQ del proyecto original: [README.upstream.md](README.upstream.md).
