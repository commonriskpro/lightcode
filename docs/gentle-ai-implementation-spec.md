# Implementation spec: Gentle-AI parity (Engram + docs)

**Status:** implemented (MCP en `.opencode/opencode.jsonc` + [engram-opencode.md](./engram-opencode.md))  
**Parent doc:** [gentle-ai-parity-map.md](./gentle-ai-parity-map.md)  
**References:** [gentle-ai intended usage](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/intended-usage.md), [Engram README](https://github.com/Gentleman-Programming/engram)

---

## 1. Intent

Hacer que el fork **cumpla en la práctica** el contrato de memoria y proyecto que ya describen `gentle-ai/AGENTS.md` y los comandos SDD en `.opencode/commands/`: herramientas MCP `mem_*` disponibles, proyecto Engram estable, y documentación operativa para CLI Engram.

**Fuera de alcance de este spec (explícito):**

- Bloque **A** (instalador tipo gentle-ai): diferido.
- Bloque **H** (artifact store openspec/hybrid): no incluido salvo una nota en docs si aplica más adelante.
- Bloque **F** (skill registry automático): no incluido.
- Bloque **G** (sync con Gentleman-Skills): solo una línea de “opcional” en docs si cabe.

---

## 2. Goals (must)

| ID | Goal |
|----|------|
| G1 | Tras configurar Engram, una sesión OpenCode con `sdd-orchestrator` o subagentes SDD puede invocar **MCP tools** equivalentes a las que citan los prompts (`mem_save`, `mem_search`, `mem_get_observation`, etc., según exponga el servidor). |
| G2 | El archivo de proyecto **`.opencode/opencode.jsonc`** incluye una entrada **`mcp`** funcional para Engram (o documenta un fragmento **copy-paste** oficial mantenido en repo si no se commitea secretos). |
| G3 | Documentación en el fork describe **instalación de Engram**, **`engram setup opencode`** vs config manual, variable **`ENGRAM_PROJECT`** / flag **`--project`**, y **`engram projects consolidate`** para anti-drift (Bloque **J**). |
| G4 | Documentación describe **CLI usuario** (Bloque **C**): `engram tui`, `engram sync`, `engram search`, cuándo conviene commitear `.engram/`, con enlaces al repo Engram. |

---

## 3. Non-goals (this spec)

- Vendorar el binario `engram` dentro del monorepo.
- Cambiar el contenido de `gentle-ai/AGENTS.md` salvo que un diff mínimo sea necesario para alinear nombres de tools (solo si hay divergencia real tras prueba).

---

## 4. Technical design

### 4.1 MCP según schema OpenCode (este fork)

En `packages/opencode/src/config/config.ts`, `mcp` es un **record** de servidores. Cada servidor es:

- **`type: "local"`** con `command: string[]`, opcional `environment`, `enabled`, `timeout`.
- **`type: "remote"`** con `url`, headers, oauth, etc.

Engram expone MCP por **stdio** con el CLI:

- Comando típico: `engram` con argumentos `mcp` (véase [Engram README — CLI](https://github.com/Gentleman-Programming/engram)).
- Acepta **`--project`** o **`ENGRAM_PROJECT`** para anclar el nombre de proyecto ([misma fuente](https://github.com/Gentleman-Programming/engram)).

**Ejemplo estructural** (valores exactos validados en implementación):

```jsonc
"mcp": {
  "engram": {
    "type": "local",
    "command": ["engram", "mcp"],
    "environment": {
      "ENGRAM_PROJECT": "my-stable-project-key"
    },
    "enabled": true
  }
}
```

**Nota:** El upstream Engear recomienda `engram setup opencode` para integración asistida; el implementador debe comprobar si ese comando escribe en `~/.config/opencode` o en `.opencode` del proyecto y documentar el flujo **fork** (workspace = raíz del repo, `skill.paths`, etc.).

### 4.2 Inventario de tools MCP (Engram)

Según documentación pública de Engram, el servidor expone entre otras: `mem_save`, `mem_update`, `mem_delete`, `mem_search`, `mem_get_observation`, `mem_context`, `mem_session_summary`, …

**Criterio de aceptación:** tras arrancar OpenCode con MCP habilitado, el panel/listado de tools del runtime incluye el prefijo del servidor Engram y las herramientas anteriores son invocables (permisos mediante).

Los comandos en `.opencode/commands/sdd-*.md` y `gentle-ai/AGENTS.md` deben seguir siendo coherentes: donde citan `mem_search` + `mem_get_observation` por IDs, el flujo debe ser posible sin errores de “tool not found”.

### 4.3 Proyecto estable (Bloque J)

- Preferir un **`ENGRAM_PROJECT` explícito** alineado con cómo el equipo nombra el repo (p. ej. slug del remoto git en minúsculas, como sugiere la doc de intended usage para anti-drift).
- Documentar **`engram projects list`** y **`engram projects consolidate`** para limpiar variantes históricas.

---

## 5. Work breakdown

### Fase 0 — Investigación breve (blocking)

- [x] Ejecutar `engram mcp` — `tools/list` devuelve `mem_save`, `mem_search`, `mem_get_observation`, … (sin prefijo en el servidor).
- [x] `engram setup opencode` escribe global `~/.config/opencode/`; este fork usa **`.opencode/opencode.jsonc`** en el repo (documentado en [engram-opencode.md](./engram-opencode.md)).

### Fase 1 — Config (G2, G1)

- [x] Entrada **`mcp.engram`** en **`.opencode/opencode.jsonc`** (`type: "local"`, `timeout: 30000`).
- [x] `ENGRAM_PROJECT` opcional vía `environment` en JSON o **`fork.opencode.env`** (comentario de ejemplo).
- [x] `experimental.tool_router.mcp_always_include` permanece `true`.

### Fase 2 — Documentación (G3, G4, J)

- [x] **`docs/engram-opencode.md`** + sección en **`README.md`** + tabla **`fork.opencode.env`**.
- [x] Enlace desde [gentle-ai-parity-map.md](./gentle-ai-parity-map.md) (spec + guía).

### Fase 3 — Verificación (acceptance)

- [ ] Smoke manual: arrancar OpenCode TUI/CLI y confirmar tools Engram en sesión (depende de tu entorno).
- [ ] Smoke manual: `mem_save` → nueva sesión → recuperar vía `mem_search` / `mem_get_observation`.
- [ ] Opcional: test automatizado de parseo de config `mcp`.

---

## 6. Acceptance criteria (summary)

| Criterio | Verificación |
|----------|----------------|
| AC1 | Con config fusionada, OpenCode lista servidor MCP Engram sin error de arranque. |
| AC2 | Al menos `mem_save`, `mem_search` y `mem_get_observation` están disponibles y ejecutables con permisos por defecto del fork. |
| AC3 | README o `docs/engram-opencode.md` cubre setup + proyecto estable + sync/tui + enlaces oficiales. |
| AC4 | Ningún cambio rompe `bun typecheck` en `packages/opencode` (si se toca código TypeScript; idealmente este spec solo toca jsonc + md). |

---

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `engram` no está en PATH en CI o en máquinas nuevas | Docs explícitas; opcional comprobación en contributing (“install Engram for full SDD memory”). |
| Timeout MCP por defecto (p. ej. 5s) insuficiente para `mem_search` en DB grande | Subir `timeout` en entrada `mcp.engram` si se observa en pruebas. |
| `ENGRAM_PROJECT` distinto entre máquinas genera memoria duplicada | Documentar `engram projects consolidate` y convención de nombre único. |
| Router / tier oculta MCP en el primer turno | Ya `mcp_always_include: true`; retest al implementar. |

---

## 8. Optional follow-ups (not part of MVP)

- Registrar plugin **`gentle-ai/plugins/background-agents.ts`** (`BackgroundAgents`) en `opencode.jsonc` según API de plugins del fork.
- Añadir `model` por agente en `opencode.jsonc` (multi-mode SDD explícito).
- Bloque **H**: parametrizar artifact store en comandos SDD.

**Hecho después del MVP:** **Context7** MCP (`mcp.context7`) alineado con [gentle-ai components](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/components.md) — ver `docs/context7-opencode.md`.

---

## 9. References

- [Engram — README](https://github.com/Gentleman-Programming/engram) — MCP, `engram mcp`, sync, TUI.  
- [Engram — Agent setup](https://github.com/Gentleman-Programming/engram/blob/main/docs/AGENT-SETUP.md) (ruta en repo upstream).  
- [gentle-ai — intended usage](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/intended-usage.md).  
- Config MCP local: `packages/opencode/src/config/config.ts` (`McpLocal`).
