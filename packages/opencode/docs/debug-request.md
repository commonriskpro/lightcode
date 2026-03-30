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
