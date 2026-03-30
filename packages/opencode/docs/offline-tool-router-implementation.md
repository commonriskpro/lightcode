# Offline tool router — implementación (Lightcode)

## Pipeline

1. Construir mapa completo de tools (registro + MCP).
2. **`applyInitialToolTier`** (`initial-tool-tier.ts`): si `experimental.initial_tool_tier === "minimal"` (o `OPENCODE_INITIAL_TOOL_TIER=minimal`) y **no** hay mensaje `assistant`, solo `read` / `grep` / `glob` / `skill` (+ `bash` si `OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH`), con descripciones recortadas.
3. **`ToolRouter.apply`** (`tool-router.ts`): si `experimental.tool_router.enabled` **o** `OPENCODE_TOOL_ROUTER=1`, filtra por reglas sobre el último texto de usuario; `mcp_always_include` vuelve a adjuntar MCP; compaction y JSON-schema se omiten según política. Logs incluyen `bytes_saved_estimate` (diferencia aproximada de tamaño JSON del mapa de tools).

## Configuración

- `experimental.initial_tool_tier`: `"full"` | `"minimal"`
- `experimental.tool_router`: `enabled`, `mode` (`rules`), `apply_after_first_assistant`, `base_tools`, `max_tools`, `mcp_always_include`, `fallback` (esquema para §7 retry; el procesador aún no aplica expansión automática)

## Código

- `src/session/initial-tool-tier.ts`, `src/session/tool-router.ts`
- `src/session/prompt.ts` — `resolveTools`, `SystemPromptCache.getParts`
- `src/session/system-prompt-cache.ts` — cache TTL de partes del system prompt
- `src/session/debug-request.ts` — logs `phase=wire` / `phase=usage` (`llm.ts`, `processor.ts`)
- `src/config/config.ts` — esquema Zod
- `src/flag/flag.ts` — `OPENCODE_INITIAL_TOOL_TIER`, `OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH`, `OPENCODE_DEBUG_REQUEST`, `OPENCODE_TOOL_ROUTER`

Especificación larga: `spec-offline-tool-router.md`. Debug: `debug-request.md`.
