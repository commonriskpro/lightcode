# Reportar crashes de Bun con ONNX (router embed / Transformers.js)

El **tool router** usa `@huggingface/transformers`, que en el bundle Node carga **`onnxruntime-node`** (addon nativo). En **Bun**, si ese addon se carga **en el mismo proceso**, a veces el proceso **panic al salir** (teardown N-API / ONNX). Eso es un bug del **runtime Bun + addon**, no de la lógica de embeddings.

**Mitigación en este fork:** bajo Bun, `classifyIntentEmbed` / `augmentMatchedEmbed` delegan en un **subproceso Node** (`script/router-embed-worker.ts` vía `router-embed-ipc.ts`), de modo que Bun no carga ONNX. Para forzar la ruta antigua (depuración): `OPENCODE_ROUTER_EMBED_INPROCESS=1`.

Este documento sigue siendo útil si alguien carga Transformers/ONNX **directamente en Bun** o para **reportar** un crash reproducible al equipo de Bun.

## 1. Informe automático (`bun.report`)

Cuando Bun crashea, suele imprimir una URL del tipo:

```text
https://bun.report/<versión>/...
```

**Qué hacer**

1. Copiar la URL **completa** (ya viene con metadatos redactados).
2. Abrirla en el navegador y seguir el flujo para **enviar el reporte** a Bun si el enlace lo permite, o guardar el enlace como referencia en un issue.

Ese enlace acelera el diagnóstico porque asocia **build de Bun + plataforma + traza**.

## 2. Issue en `oven-sh/bun`

Si el crash es reproducible:

1. **Buscar** en [issues de Bun](https://github.com/oven-sh/bun/issues) por: `onnxruntime`, `N-API`, `native addon`, `panic`, `exit`, `segfault`.
2. Si no hay duplicado claro, **abrir un issue nuevo** con:

| Campo | Contenido sugerido |
|--------|---------------------|
| Título | Mencionar Bun + `onnxruntime-node` o Transformers.js + panic **al salir** (no solo “crash”). |
| Versión | Salida de `bun --version` y OS/arch (`uname -a` o “macOS arm64”). |
| Dependencias | `@huggingface/transformers` y versión de `onnxruntime-node` resuelta (`bun pm ls onnxruntime-node` o equivalente). |
| Repro mínima | Comando que dispare carga ONNX y salida limpia, p. ej. `RUN_TRANSFORMERS_INTENT_TESTS=1 bun test packages/opencode/test/session/router-embed-transformers-real.test.ts` (o un `bun -e` mínimo que importe `pipeline` y ejecute una inferencia). |
| Comportamiento | “Las aserciones pasan; el panic ocurre **después**, al terminar el proceso.” |
| Enlace | Pegar la URL **`bun.report/...`** si la hubo. |

No hace falta incluir el modelo completo en el issue: basta **un modelo pequeño** de feature-extraction que ya use el repo (p. ej. el id por defecto del router).

## 3. Qué hace este repo mientras tanto

- **IPC Node** para embeddings bajo Bun (ver arriba); el test opt-in `router-embed-transformers-real.test.ts` puede ejecutarse con Bun cuando `RUN_TRANSFORMERS_INTENT_TESTS=1` sin cargar ONNX en el proceso de test.
- Misma lógica validada también con **Node + `tsx`**: `test/session/router-embed-transformers-real.node.test.ts` y `script/transformers-intent-smoke.ts`.

## 4. Referencias

- [Bun — blog / releases](https://bun.com/blog)
- [oven-sh/bun — Issues](https://github.com/oven-sh/bun/issues)
