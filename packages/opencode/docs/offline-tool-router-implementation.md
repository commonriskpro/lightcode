# Offline tool router — implementación (Lightcode)

## Pipeline

1. Construir mapa completo de tools (registro + MCP).
2. **`applyInitialToolTier`** (`initial-tool-tier.ts`): si `experimental.initial_tool_tier === "minimal"` (o `OPENCODE_INITIAL_TOOL_TIER=minimal`) y **no** hay mensaje `assistant`, solo `read` / `grep` / `glob` / `skill` (+ `bash` si `OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH`), con descripciones recortadas.
3. **`ToolRouter.apply`** (`tool-router.ts`): si `experimental.tool_router.enabled`, filtra por reglas sobre el último texto de usuario; `mcp_always_include` vuelve a adjuntar MCP; compaction y JSON-schema se omiten según política.

## Configuración

- `experimental.initial_tool_tier`: `"full"` | `"minimal"`
- `experimental.tool_router`: `enabled`, `mode` (`rules`), `apply_after_first_assistant`, `base_tools`, `max_tools`, `mcp_always_include`

## Código

- `src/session/initial-tool-tier.ts`, `src/session/tool-router.ts`
- `src/session/prompt.ts` — `resolveTools`
- `src/config/config.ts` — esquema Zod
- `src/flag/flag.ts` — `OPENCODE_INITIAL_TOOL_TIER`, `OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH`

Especificación larga: `spec-offline-tool-router.md`.
