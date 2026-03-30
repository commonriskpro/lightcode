# Debug request (`service=debug-request`)

When **`OPENCODE_DEBUG_REQUEST=1`** or **`experimental.debug_request: true`**:

- **`phase=wire`** — Tras resolver tools, se registra `toolsBytes` y `promptBytes` (aprox.) antes del `streamText`.
- **`phase=http`** — Tras cada `POST` al proveedor (cuerpo JSON), `bodyBytes` del payload enviado.
- **`phase=usage`** — En cada `finish-step` del stream, tokens y coste reportados por el proveedor.

Código: `packages/opencode/src/session/debug-request.ts`, integración en `llm.ts`, `processor.ts` y `provider.ts` (wrapper `fetch`).
