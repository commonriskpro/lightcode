# SDD model profiles — guía del fork (overlay + TUI)

Este documento describe el **sistema de perfiles de modelos para agentes `sdd-*`**: archivo de overlay, carga en el servidor, interfaz en la TUI, atajos y detalles de implementación introducidos en el fork.

---

## Resumen

| Pieza | Rol |
|--------|-----|
| `.opencode/sdd-models.jsonc` | `active` + `profiles.<nombre>.<agente> = "proveedor/modelo"` |
| `OPENCODE_SDD_MODEL_PROFILE` | Opcional: fuerza el nombre de perfil (prioridad sobre `active` en el JSON) |
| Servidor (`config.ts`) | `applySddModelsOverlay`: merge del overlay sobre `agent.*` al cargar config |
| TUI `/profile` | Diálogo integrado: perfiles, agentes, mismo selector que `/models` |
| Autocompletado `/` | Si un slash está en la app y en comandos del proyecto, **solo se muestra la entrada de la app** (evita duplicados y mantiene un Enter para abrir el diálogo) |

---

## Archivo de overlay

- **Ruta:** `.opencode/sdd-models.jsonc` o `.json` (búsqueda hacia arriba desde el directorio de trabajo, como el resto del project config).
- **Estructura:** `active` (string), `profiles` (mapa nombre de perfil → mapa `nombreDeAgente` → string de modelo).
- **Merge:** solo se aplican valores string no vacíos; se hace `mergeDeep` sobre cada entrada de `agent` ya cargada (no sustituye todo el agente).
- **Desactivar overlay por flag:** `OPENCODE_DISABLE_PROJECT_CONFIG`.

Plantilla por defecto (también en `packages/opencode/src/cli/cmd/tui/util/sdd-models-default.ts`):

- Perfiles iniciales: `balanced`, `quality`, `economy` (objetos vacíos hasta que configures modelos).

---

## Perfiles integrados (no borrables en la TUI)

Los nombres **`balanced`**, **`quality`** y **`economy`** se consideran **perfiles integrados** (`SDD_BUILTIN_PROFILE_NAMES` / `isSddBuiltinProfile`). No se pueden eliminar con **Ctrl+D** en el selector de perfiles; el servidor también rechaza el borrado en `deleteSddProfile`.

Los perfiles que **creas tú** (p. ej. desde **+ New profile** o editando el JSON) sí se pueden borrar (salvo que sea el **único** perfil restante).

---

## TUI: comando `/profile`

### Cómo abrirlo

- Escribir **`/profile`** y confirmar (el registro en la **app** con `slash` hace que el primer Enter pueda ejecutar `command.trigger` y abrir el diálogo; el comando del proyecto `.opencode/commands/profile.md` sigue existiendo para headless/documentación, pero **no duplica** la fila gracias al deduplicado en el autocompletado).
- Paleta de comandos (**Ctrl+P**): **Profile** (no depende del `slash`; abre el mismo diálogo).

### Pantalla principal

- **Profile:** perfil activo; entrar aquí abre el **selector de perfiles** (lista + **+ New profile**).
- **SDD agents:** un renglón por cada agente cuyo nombre empieza por `sdd-*` en la config cargada (`sync.data.agent`).

### Texto mostrado por agente (columna derecha)

Orden de resolución para la **etiqueta** visible:

1. Override en el perfil activo dentro del archivo (`profiles[active][agente]`).
2. Si no hay override: **`agent.model`** de la config ya fusionada en el servidor.
3. Si no hay modelo en el agente: **modelo de sesión** (el mismo que el prompt principal / `/models`).
4. Si nada aplica: **—**.

### Elegir modelo para un agente

1. Se abre el mismo **`DialogModel`** que `/models` (favoritos, recientes, proveedores, búsqueda), en modo **`pick`** (no cambia el modelo de la sesión principal).
2. Tras elegir proveedor/modelo, se pregunta:
   - **Update "&lt;perfil&gt;"** — guarda solo en el perfil actual.
   - **New profile** — pide nombre; crea un perfil copiando el actual **más** el cambio de ese agente y lo deja como **active**.

### Perfiles: lista (`Active profile`)

- Elegir un nombre cambia el **`active`** en disco (`saveSddModelsActive`).
- **+ New profile** — `DialogPrompt` para el nombre (`normalizeProfileName`: letras, dígitos, `._-`); clona el perfil que estaba activo y lo activa.
- **Ctrl+D** (**Delete profile**): mismo atajo por defecto que **session_delete** (`ctrl+d` en la config de keybinds). Pide confirmación. No afecta a perfiles integrados ni al último perfil restante.

### Carga y estado inicial

El diálogo arranca con datos por defecto en memoria y sincroniza con disco en un `createEffect` (evita pantalla de carga colgada); hay guardia de carrera por generación (`loadGen`) si cambia la ruta del proyecto.

---

## Autocompletado: deduplicación app vs proyecto

En `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`, al mezclar `command.slashes()` con `sync.data.command`, **no** se añade un comando del servidor si su `name` coincide con el nombre de un slash ya registrado por la app. Así `/profile` aparece **una sola vez** y conserva el comportamiento del **`onSelect`** de la app (abrir diálogo al elegir la sugerencia).

---

## Variables de entorno

| Variable | Uso |
|----------|-----|
| `OPENCODE_SDD_MODEL_PROFILE` | Forzar perfil activo sin editar `active` en el JSON |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | No aplicar overlay (ni otros project configs según el resto del código) |

Comentario de ejemplo en `fork.opencode.env`.

---

## Referencias de código (fork)

| Área | Archivo(s) |
|------|------------|
| Overlay en carga de config | `packages/opencode/src/config/config.ts` (`applySddModelsOverlay`, schema) |
| Lectura/escritura JSON | `packages/opencode/src/cli/cmd/tui/util/sdd-models-file.ts` |
| Plantilla por defecto + built-in names | `packages/opencode/src/cli/cmd/tui/util/sdd-models-default.ts` |
| Diálogo principal y subdiálogos | `packages/opencode/src/cli/cmd/tui/component/dialog-sdd-models.tsx` |
| Selector de modelo en modo `pick` | `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx` |
| Slash `/profile` → diálogo | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` |
| Registro paleta + slash | `packages/opencode/src/cli/cmd/tui/app.tsx` |
| Deduplicación `/` | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` |
| Comando proyecto (headless / descripción) | `.opencode/commands/profile.md` |

---

## Comportamiento tras editar

Los cambios se escriben en **`.opencode/sdd-models.jsonc`**. Para que los subagentes nuevos usen la overlay actualizada hace falta **recargar la config** o **nueva sesión** (según cómo el proceso mantenga la config en memoria).

---

## Documentación relacionada

- Visión general y formato JSON: **`docs/multi-mode-sdd.md`**
- Paridad / contexto del fork: **`docs/gentle-ai-parity-map.md`** (si está presente en el repo)
