# Multi-mode SDD (modelo distinto por fase)

**Guía TUI del fork** (overlay en disco, `/profile`, perfiles, Ctrl+D, deduplicación en autocompletado): [`docs/sdd-models-tui-guide.md`](./sdd-models-tui-guide.md).

OpenCode ya soporta **un modelo por agente**. En `packages/opencode/src/tool/task.ts`, el subagente usa **`agent.model`** si existe; si no, hereda el modelo del mensaje padre.

Por tanto **no hace falta código nuevo**: basta con añadir **`"model": "proveedor/id"`** a cada entrada **`sdd-*`** en **`.opencode/opencode.jsonc`**.

---

## Propuesta de reparto (orientativa)

| Agente | Rol | Criterio de modelo |
|--------|-----|---------------------|
| `sdd-orchestrator` | Coordina, casi no ejecuta | Ligero o el mismo que ya usas como primary; ahorra coste en delegación. |
| `sdd-explore` | Explora código y alternativas | **Potente** (razonamiento largo). |
| `sdd-propose` | Propuestas de cambio | **Potente** (síntesis y límites). |
| `sdd-spec` | Requisitos y escenarios | **Potente** (precisión, menos ambigüedad). |
| `sdd-design` | Arquitectura / diseño técnico | **Potente** (trade-offs). |
| `sdd-tasks` | Checklist de tareas | Intermedio o **rápido** (estructura repetible). |
| `sdd-apply` | Implementación y ediciones | **Rápido** si hay muchas iteraciones; **potente** si el repo es delicado y quieres máxima calidad. |
| `sdd-verify` | Validar vs spec | **Potente** o con buen ojo para inconsistencias. |
| `sdd-archive` | Cierre y archivo | **Rápido** suele bastar. |
| `sdd-init` | Bootstrap de contexto | **Rápido** o intermedio. |

Ajusta según presupuesto: mucha gente pone **un solo modelo “fuerte”** en explore → design y **uno “barato”** en tasks, apply, archive.

---

## Formato en `opencode.jsonc`

Los IDs deben ser los que tengas **realmente conectados** (AI Gateway, Anthropic, OpenAI, etc.), en el formato que ya use tu sesión, p. ej.:

```jsonc
"sdd-spec": {
  "mode": "subagent",
  "hidden": true,
  "description": "...",
  "prompt": "{file:../packages/opencode/src/agent/prompt/sdd-spec.txt}",
  "model": "anthropic/claude-sonnet-4.5",
},
"sdd-apply": {
  "mode": "subagent",
  "hidden": true,
  "description": "...",
  "prompt": "{file:../packages/opencode/src/agent/prompt/sdd-apply.txt}",
  "model": "openai/gpt-4.1-mini",
},
```

Sustituye los strings por **tus** modelos válidos (lista en la TUI con el diálogo de modelos / favoritos).

**Nota:** el campo opcional **`variant`** del schema de agente también existe si usas variantes del mismo modelo.

---

## Perfiles con `.opencode/sdd-models.jsonc` y `/profile`

Además de editar a mano `opencode.jsonc`, puedes **definir varios conjuntos de modelos** y cambiar entre ellos sin duplicar el bloque `agent` entero.

1. **Archivo** (en la raíz del proyecto, bajo `.opencode/`): `sdd-models.jsonc` o `sdd-models.json`. Se busca hacia arriba desde el directorio de trabajo, igual que el resto del project config.
2. **Estructura**:
   - **`active`**: nombre del perfil por defecto (p. ej. `"balanced"`).
   - **`profiles`**: objeto cuyas claves son nombres de perfil y los valores son **mapas `nombreDeAgente` → string de modelo** (mismos IDs que en la tabla de modelos / AI Gateway).

Ejemplo:

```jsonc
{
  "active": "quality",
  "profiles": {
    "balanced": {
      "sdd-explore": "anthropic/claude-sonnet-4.5",
      "sdd-apply": "openai/gpt-4.1-mini"
    },
    "quality": {
      "sdd-explore": "anthropic/claude-opus-4.5",
      "sdd-spec": "anthropic/claude-opus-4.5",
      "sdd-apply": "anthropic/claude-sonnet-4.5"
    },
    "economy": {
      "sdd-explore": "openai/gpt-4.1-mini",
      "sdd-tasks": "openai/gpt-4.1-mini",
      "sdd-apply": "openai/gpt-4.1-mini"
    }
  }
}
```

Solo se aplican entradas con **valor string no vacío**; el overlay hace **merge** con la definición existente del agente (`model` sobreescrito, el resto intacto).

3. **Perfil activo sin tocar el archivo**: variable de entorno **`OPENCODE_SDD_MODEL_PROFILE`** (tiene prioridad sobre `active` en el JSON). Útil en scripts o en `fork.opencode.env`.
4. **TUI**: comando **`/profile`** (o la paleta: *Profile*) abre un diálogo **dentro de OpenCode**: eliges el perfil activo y, por cada agente `sdd-*`, el modelo con el **mismo selector que `/models`** (favoritos, proveedores, búsqueda). Si no existe el archivo, se crea la plantilla por defecto. Tras cambiar modelos, las **nuevas tareas de subagente** usan la overlay tras **recargar config o nueva sesión** (igual que antes).
5. **API / headless**: sin TUI, edita `.opencode/sdd-models.jsonc` a mano o usa la pista del comando slash.

---

## Qué no hacer

- No mezcles modelos de un proveedor que **no** esté configurado en `provider` de la misma sesión.
- El orquestador con `task` hacia `sdd-*` no necesita “pasar” el modelo en el comando: lo toma de la **definición del agente**.

---

## Plugin BackgroundAgents

Si más adelante activas **`gentle-ai/plugins/background-agents.ts`**, el `delegate` también **respeta el `model` del agente destino** (mismo criterio que arriba).

---

## Referencias en código

- Resolución de modelo en **task**: `packages/opencode/src/tool/task.ts` (`agent.model ?? …`).
- Schema **`agent.*.model`**: `packages/opencode/src/config/config.ts`.
- Overlay **`sdd-models`**: `packages/opencode/src/config/config.ts` (`applySddModelsOverlay`).
- TUI **`/profile`**: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` → `dialog-sdd-models.tsx`; plantilla: `sdd-models-default.ts`; lectura/escritura: `sdd-models-file.ts`; selector de modelo: `dialog-model.tsx` (`pick` + `current`); deduplicación slash app vs proyecto: `prompt/autocomplete.tsx`. Documentación: **`docs/sdd-models-tui-guide.md`**.
