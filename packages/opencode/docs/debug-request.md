# Debug request (`service=debug-request`)

When **`OPENCODE_DEBUG_REQUEST=1`** or **`experimental.debug_request: true`**:

- **`phase=wire`** — Tras resolver tools, se registra `toolsBytes`, `promptBytes` (aprox.) y `systemBytes` (texto del system ensamblado en `llm.ts`) antes del `streamText`. También `initial_tool_tier` (`minimal`|`full`), `thread_has_assistant` y `tool_router` para comparar configuraciones.
- **`phase=http`** — Tras cada `POST` al proveedor (cuerpo JSON), `bodyBytes` del payload enviado.
- **`phase=usage`** — En cada `finish-step` del stream, tokens y coste reportados por el proveedor.

Código: `packages/opencode/src/session/debug-request.ts`, integración en `llm.ts`, `processor.ts` y `provider.ts` (wrapper `fetch`).

## Medir minimal vs full (`initial_tool_tier`)

1. Activa logs: `OPENCODE_DEBUG_REQUEST=1` o `experimental.debug_request: true` en `.opencode/opencode.jsonc`.
2. **Run A — minimal:** `experimental.initial_tool_tier: "minimal"` (o `OPENCODE_INITIAL_TOOL_TIER=minimal`). Repite el mismo primer mensaje en un hilo nuevo.
3. **Run B — full:** `experimental.initial_tool_tier: "full"` (o `OPENCODE_INITIAL_TOOL_TIER=full`, o elimina la clave si el default te conviene). Mismo mensaje, hilo nuevo.
4. Compara líneas **`phase=wire`** en el primer turno del asistente (`thread_has_assistant: false`): **`toolsBytes`** y **`systemBytes`** (y `promptBytes`). El tier minimal recorta definiciones de tools y puede diferir el system vía `SystemPromptCache` + `mergedInstructionBodies` (`packages/opencode/src/session/wire-tier.ts`).
5. Compara **`phase=usage`**: `tokens.input` / `tokens.output` del proveedor (no son bytes; son el coste real por request).

Regla práctica: en el **primer** turno sin mensaje previo del assistant, `minimal` aplica; si `thread_has_assistant: true`, el tier ya no acorta tools/instrucciones aunque la config diga `minimal`.

## `phase=http` y sesión

Con `OPENCODE_DEBUG_REQUEST=1`, la línea `phase=http` incluye **`sessionID`** (contexto del request LLM) y **`httpStatus`** (código HTTP de la respuesta del `fetch` al proveedor).

## Visor de trazas (TUI)

- **Por defecto está desactivado** para priorizar estabilidad/performance.
- **`OPENCODE_TRACE_VIEWER=1|true|on`** — activa el visor al arrancar la TUI.
- **`OPENCODE_TRACE_VIEWER=0|false|off`** — desactiva el visor.
- **`OPENCODE_TRACE_VIEWER_CMD`** — si está definido, se ejecuta ese comando (shell) en lugar del visor integrado; útil para `tail -f` custom o otro visor.
- El visor marca con color magenta `pipeline_incomplete` cuando detecta `phase=wire` sin `phase=http`, o `phase=http` sin `phase=usage`, por `sessionID` tras una ventana corta de espera.

## Arranque (`service=bootstrap`)

`InstanceBootstrap` registra duración con `Log.time` por paso: `plugin.init`, `share_next.init`, `format.init`, `lsp.init`, `file.init`, `file_watcher.init`, `vcs.init`, `snapshot.init`.

## Trazabilidad TUI (runbook corto)

### Flujo de arranque

1. `tui/thread.ts` inicia worker + SDK local (`fetch` por RPC).
2. Primera request por `directory` crea instancia en `Instance.provide`.
3. `InstanceBootstrap` corre init de plugin, lsp, vcs y snapshot con tiempos.
4. `TuiPluginRuntime.load` carga plugins internos/externos y activa en secuencia.
5. `SyncProvider.bootstrap` hace bloque inicial (providers/agents/config/session) y luego bloque background (command/lsp/mcp/resource/formatter/vcs/path/workspaces).

### Flujo de mensaje (prompt -> Xenova/router -> provider)

1. `prompt/index.tsx` envía `session.prompt`.
2. `SessionPrompt.resolveTools` mide `ToolRegistry.tools`, `MCP.tools`, y `ToolRouter.apply`.
3. `ToolRouter.apply` decide `contextTier` y registra `duration_ms`.
4. En modo embed bajo Bun, `router-embed-ipc` deriva a Node worker (`script/router-embed-worker.ts`), emite estado y duración por RPC.
5. `LLM.stream` emite `debug_request phase=wire`, provider emite `phase=http` (con `sessionID` + `httpStatus`) y stream cierra con `phase=usage`.

### Hooks críticos (`Plugin.trigger`)

Se miden `duration_ms` para nombres:
- `chat.*`
- `experimental.chat.*`
- `tool.execute.*`
- `command.execute.before`
- `shell.env`

Esto permite detectar plugins lentos en la ruta del prompt sin inundar logs de hooks no críticos. Para habilitar estos timings usa **`OPENCODE_TRACE_TIMINGS=1`**.

### Notas de diagnóstico

- **MCP lazy:** la conexión de servidores MCP no ocurre en `InstanceBootstrap`; suele ocurrir en el primer `MCP.tools()` del prompt.
- **Bun -> Node IPC:** con Bun, embeddings usan subproceso Node por defecto. Para forzar in-process usar `OPENCODE_ROUTER_EMBED_INPROCESS=1`.
