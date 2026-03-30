# Engram + OpenCode en este fork

**Hermana (docs de librerías):** [Context7 en este fork](./context7-opencode.md) — no confundir con memoria de proyecto.

[Engram](https://github.com/Gentleman-Programming/engram) es memoria persistente para agentes MCP (`mem_save`, `mem_search`, `mem_get_observation`, …). Los flujos **SDD** (`gentle-ai/AGENTS.md`, `.opencode/commands/sdd-*.md`) asumen que esas herramientas existen.

---

## Instalación del binario

- macOS (Homebrew): `brew install gentleman-programming/tap/engram`
- Otras plataformas: [docs/INSTALLATION.md](https://github.com/Gentleman-Programming/engram/blob/main/docs/INSTALLATION.md)

Comprueba: `engram version`

---

## Configuración en este repo (recomendado)

El archivo **`.opencode/opencode.jsonc`** ya declara el servidor MCP local:

```jsonc
"mcp": {
  "engram": {
    "type": "local",
    "command": ["engram", "mcp"],
    "enabled": true,
    "timeout": 30000
  }
}
```

- **`timeout`:** 30s para búsquedas o escrituras lentas en DB grandes.
- Sin `engram` en **PATH**, OpenCode puede fallar al arrancar el servidor MCP; instala el binario antes de usar SDD con memoria.

### Proyecto estable (`ENGRAM_PROJECT`)

Engram asocia observaciones a un **nombre de proyecto**. Para evitar duplicados entre variantes (`my-app` vs `My-App`), puedes fijar el identificador:

1. **En el JSON** (solo este workspace), añade bajo `engram`:

   ```jsonc
   "environment": {
     "ENGRAM_PROJECT": "tu-slug-estable"
   }
   ```

2. **O** exporta en el shell / **`fork.opencode.env`** (comentado de ejemplo en ese archivo):  
   `ENGRAM_PROJECT=tu-slug-estable`  
   El proceso que lanza OpenCode debe heredar la variable para que `engram mcp` la vea.

Opcionalmente, en `command` puedes pasar perfiles de herramientas, p. ej. `["engram", "mcp", "--tools=agent"]` (menos tools, más superficie mínima); por defecto en este repo se usa el perfil completo del servidor. Ver `engram help` en tu versión.

Limpieza de nombres viejos: **`engram projects list`** y **`engram projects consolidate`** (interactivo). Detalle: README de Engram y [ARCHITECTURE.md](https://github.com/Gentleman-Programming/engram/blob/main/docs/ARCHITECTURE.md).

---

## `engram setup opencode` (global) vs esta repo

El comando oficial **`engram setup opencode`** (véase [AGENT-SETUP.md — OpenCode](https://github.com/Gentleman-Programming/engram/blob/main/docs/AGENT-SETUP.md)) suele:

1. Copiar un **plugin** a `~/.config/opencode/plugins/engram.ts` (seguimiento de sesión, protocolo de memoria).
2. Añadir MCP a **`~/.config/opencode/opencode.json`** (global).

Este fork usa **`.opencode/opencode.jsonc` en la raíz del workspace** para MCP; no sustituye automáticamente tu global. Puedes:

- Confiar solo en el **`mcp` del proyecto** (lo mínimo para herramientas `mem_*`), o
- Ejecutar **`engram setup opencode`** y revisar conflictos con tu config global; si hace falta, fusiona entradas `mcp` / `plugin` manualmente.

Algunos flujos del plugin recomiendan **`engram serve`** en segundo plano para HTTP de sesión; léelo en [PLUGINS.md](https://github.com/Gentleman-Programming/engram/blob/main/docs/PLUGINS.md) si quieres esa capa extra.

---

## Herramientas MCP (nombres)

El servidor expone herramientas con nombres como **`mem_save`**, **`mem_search`**, **`mem_get_observation`**, **`mem_context`**, **`mem_session_summary`**, etc. OpenCode puede mostrarlas con prefijo según el conector MCP del cliente; el comportamiento esperado por **Gentle AI** está alineado con esa API.

Hemos verificado localmente que `engram mcp` responde a `tools/list` con esos nombres (sin prefijo en el servidor).

---

## CLI para ti (no solo para el modelo)

| Comando | Uso |
|---------|-----|
| `engram tui` | Explorar y buscar memorias en terminal. |
| `engram sync` | Exportar chunk para git; luego `git add .engram/` si queréis versionar memorias del equipo. |
| `engram sync --import` | En otra máquina, tras clonar un repo con `.engram/`. |
| `engram sync --status` | Estado del sync. |
| `engram search "<query>"` | Búsqueda rápida desde shell. |
| `engram projects list` | Proyectos y conteos. |
| `engram projects consolidate` | Unificar nombres de proyecto parecidos. |

Referencia completa: [README — CLI](https://github.com/Gentleman-Programming/engram).

---

## Compaction y memoria

Tras compactación de contexto, conviene recuperar estado con **`mem_context`**. El AGENT-SETUP sugiere añadir una línea al prompt del agente; aquí ya están instrucciones amplias en **`gentle-ai/AGENTS.md`** y skills Engram en reglas del IDE si las usas.

---

## Más lectura

- [intended usage (gentle-ai)](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/intended-usage.md) — modelo mental Engram + SDD.
- [gentle-ai-implementation-spec.md](./gentle-ai-implementation-spec.md) — spec de implementación (este repo).
- [gentle-ai-parity-map.md](./gentle-ai-parity-map.md) — mapa de bloques.
