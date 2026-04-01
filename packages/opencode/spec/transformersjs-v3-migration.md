# Especificación de implementación: migración `@xenova/transformers` → `@huggingface/transformers` (Transformers.js v3)

**Estado:** implementado en `packages/opencode` con `@huggingface/transformers@4.0.0` (import dinámico en `router-embed.ts`). Los overrides globales de `onnxruntime-*@1.22.0` se eliminaron para alinear con las dependencias transitivas de la librería.

## 1. Resumen ejecutivo

| Aspecto | Actual | Objetivo |
|--------|--------|----------|
| Paquete NPM | `@xenova/transformers@2.17.2` | `@huggingface/transformers@^3` (pin explícito al validar) |
| Uso en el producto | Embeddings locales del **tool router** (`feature-extraction`, intent + augment) | Misma superficie funcional con runtime v3 |
| WebGPU | No aplica en el path actual (Node + ONNX/WASM) | Opcional más adelante; **CLI servidor** sigue priorizando CPU/ONNX estable |

**Motivación:** Mantener la librería alineada con el mantenimiento oficial en Hugging Face, mejoras de backends, cuantización y compatibilidad a largo plazo. Resolver de paso la deuda de fallos observados (`ERR_DLOPEN_FAILED`, `Tensor.location`) validando de nuevo contra v3 y overrides de `onnxruntime-*`.

---

## 2. Objetivos y fuera de alcance

### Objetivos

1. Sustituir **todas** las importaciones y dependencias de `@xenova/transformers` por `@huggingface/transformers` en `packages/opencode`.
2. Conservar el contrato público de `router-embed.ts`: `getPipe` / `embed` / `classifyIntentEmbed` / `augmentMatchedEmbed`, mismos tipos exportados (`IntentPrototype`, constantes de modelo por defecto, prototipos).
3. Mantener **`DEFAULT_LOCAL_EMBED_MODEL`** como `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (ID de Hub válido en v3; el prefijo `Xenova/` no implica el paquete NPM).
4. Preservar variables de entorno existentes: `OPENCODE_TRANSFORMERS_CACHE` (mapear al mecanismo de caché de v3; ver §6).
5. Mantener el launcher `packages/opencode/bin/opencode` (copia de dylibs ONNX + `DYLD_FALLBACK_LIBRARY_PATH` / `LD_LIBRARY_PATH`) hasta probar que v3 + `onnxruntime-node` resuelven bien en todos los binarios; documentar si sigue siendo obligatorio.
6. Pasar smoke **`script/xenova-intent-smoke.ts`** (renombrar opcionalmente) con **Node + tsx** y, si se define política, un job CI opcional.
7. Actualizar comentarios, `config.ts` / flags, tests y, si aplica, regenerar SDK JS (`./packages/sdk/js/script/build.ts`).

### No objetivos (fases posteriores)

- Forzar **WebGPU** en el proceso CLI Node (WebGPU en v3 está orientado principalmente a navegadores; en Node el camino estable suele seguir siendo WASM/ONNX según backend).
- Cambiar el modelo por defecto, umbrales (`minScore`, `topK`) o lista de prototipos salvo evidencia de regresión medible.
- Soportar Bun como runtime **principal** para cargar ONNX en esta fase (hoy el smoke desaconseja Bun por roturas previas; el spec no cambia esa política salvo verificación explícita).

---

## 3. Inventario de impacto (archivos)

### Dependencias

- `packages/opencode/package.json`: quitar `@xenova/transformers`, añadir `@huggingface/transformers`.
- Raíz `package.json` **`overrides`** de `onnxruntime-common` / `onnxruntime-node` / `onnxruntime-web`: **revisar** tras elegir versión de `@huggingface/transformers` (peer deps); ajustar solo si hay conflicto de versiones verificadas.

### Código de producción

- `packages/opencode/src/session/router-embed.ts` — único import dinámico del runtime de embeddings.
- `packages/opencode/src/session/tool-router.ts` — comentarios y razón de log `xenova_conversation` (ver §8).
- `packages/opencode/src/flag/flag.ts` — textos que citan `@xenova/transformers`.
- `packages/opencode/src/config/config.ts` — descripciones Zod de `local_embed`, `local_intent_embed`, caché.

### Scripts y pruebas

- `packages/opencode/script/xenova-intent-smoke.ts` — renombrar a `transformers-intent-smoke.ts` (recomendado) y actualizar comentarios / README interno.
- `packages/opencode/test/session/router-embed-xenova-real.test.ts` — actualizar nombre/descripción; criterio `skip` (Bun) intacto salvo nueva política.
- `packages/opencode/test/session/router-embed-intent-behavior.test.ts`, `router-embed.test.ts`, `tool-router-xenova.test.ts`, `tool-router.test.ts` — solo strings/comentarios salvo mocks que referencien el nombre del paquete.

### SDK generado

- `packages/sdk/js/src/v2/gen/types.gen.ts` — regenerar si cambian strings de `config.ts` expuestos al SDK.

### Documentación interna

- Cualquier guía que mencione “Xenova” como paquete NPM (actualizar a HF).

---

## 4. Cambios técnicos esperados (API v3)

### 4.1 Import

```ts
// Antes
const xf = await import("@xenova/transformers")

// Después (forma recomendada en documentación v3)
import { pipeline, env } from "@huggingface/transformers"
// o dynamic import equivalente si se mantiene carga diferida:
const { pipeline, env } = await import("@huggingface/transformers")
```

**Tarea:** Confirmar en la versión pinneada que `pipeline` y `env` exportan lo esperado (TypeScript / `moduleResolution`).

### 4.2 Pipeline `feature-extraction`

La firma usada hoy:

```ts
xf.pipeline("feature-extraction", model)
// ...
await pipe(trimmed, { pooling: "mean", normalize: true })
```

En v3 el patrón documentado es equivalente: `pipeline("feature-extraction", modelId, options?)` y llamada con opciones de pooling/normalización.

**Tarea de verificación:**

- Misma forma tensor → `vecFromTensor` en `router-embed.ts` (sigue esperando `Float32Array` en `.data`); si el output cambia de forma, ajustar **solo** `vecFromTensor` y añadir test unitario con tensor simulado.

### 4.3 Caché (`OPENCODE_TRANSFORMERS_CACHE`)

Hoy:

```ts
const cache = process.env.OPENCODE_TRANSFORMERS_CACHE?.trim()
if (cache) xf.env.cacheDir = cache
```

En v3 el objeto `env` puede tener propiedades distintas o nombres alineados con el hub (`HF_HOME` / `TRANSFORMERS_CACHE` también pueden influir según documentación actual).

**Tarea:** Leer la sección “Environment variables” de la doc de la versión pinneada y mapear:

- `OPENCODE_TRANSFORMERS_CACHE` → `env.cacheDir` (o equivalente documentado), sin romper instalaciones que ya exportan esa variable.

### 4.4 Backends (WASM / ONNX / WebGPU)

- No activar WebGPU en la primera iteración del **servidor Node**.
- Si v3 expone `device` o flags de backend en `pipeline()`, usar valores por defecto compatibles con entornos sin GPU Web (p. ej. omitir o `cpu` según doc).
- Registrar en logs el backend efectivo una vez al cargar el pipeline (nivel `info`, sin PII).

---

## 5. Launcher `bin/opencode` y ONNX

El script `packages/opencode/bin/opencode` resuelve `onnxruntime-node` bajo `node_modules` / `.bun`, copia `.dylib`/`.so` a `OPENCODE_PORTABLE_ROOT/cache/onnxruntime-libs/<platform-arch>/` y ajusta `DYLD_FALLBACK_LIBRARY_PATH` / `LD_LIBRARY_PATH`.

**Después de migrar:**

1. Reproducir arranque del binario compilado con `OPENCODE_PORTABLE_ROOT` y un mensaje que dispare `classifyIntentEmbed`.
2. Si `ERR_DLOPEN_FAILED` desaparece con v3 pero aparece otro error, documentar en §10.
3. Si el problema era solo orden de carga + rpath, **mantener** el launcher sin cambios lógicos.

`OPENCODE_SKIP_ONNX_LIB_PATH=1` debe seguir desactivando el comportamiento para depuración.

---

## 6. Contrato de configuración (sin breaking change)

Mantener nombres de flags y env:

- `experimental.tool_router.local_embed`, `local_embed_model`, `local_intent_embed`, umbrales.
- `OPENCODE_TOOL_ROUTER_EMBED_MODEL` (prioridad sobre `local_embed_model` si ya existe en código).
- `OPENCODE_TRANSFORMERS_CACHE`.

Solo actualizar **textos descriptivos** que digan literalmente `@xenova/transformers` → “Transformers.js (`@huggingface/transformers`)” o similar.

---

## 7. Telemetría / razones de log

`tool-router.ts` usa `reason: "xenova_conversation"` cuando gana el intent conversación por embed local.

**Opciones:**

- **A (preferida por compatibilidad):** Mantener el string `xenova_conversation` para no romper dashboards/analytics que parseen logs.
- **B:** Añadir alias nuevo `local_intent_conversation` y deprecar el viejo en documentación.

El spec recomienda **A** salvo requisito explícito de producto.

---

## 8. Plan de implementación por fases

### Fase 0 — Spike (1 PR pequeño o rama local)

1. Añadir `@huggingface/transformers` en paralelo **sin** quitar Xenova.
2. Script temporal que importe v3, cargue `feature-extraction` con el modelo por defecto, una inferencia, imprima dimensión del vector.
3. Anotar versión exacta que pasa en macOS arm64 + Linux x64 (CI).

### Fase 1 — Reemplazo de dependencia

1. Sustituir import en `router-embed.ts`, ajustar `env`/caché.
2. Quitar `@xenova/transformers` de `package.json`.
3. `bun install` / lockfile en la raíz del monorepo según convención del repo.
4. `bun typecheck` en `packages/opencode`.

### Fase 2 — Tests y smoke

1. Ejecutar `npx tsx ./script/transformers-intent-smoke.ts` desde `packages/opencode` con `OPENCODE_PORTABLE_ROOT` si aplica.
2. Ejecutar suite de tests relevante en `packages/opencode` (no desde raíz; respeta `AGENTS.md`).
3. Actualizar `router-embed-xenova-real.test.ts` o renombrar a `router-embed-transformers-real.test.ts` con comentarios alineados.

### Fase 3 — Documentación y SDK

1. `config.ts`, `flag.ts`, comentarios en `tool-router.ts`.
2. Regenerar SDK si procede: `./packages/sdk/js/script/build.ts`.
3. Changelog interno o nota de migración para forks.

### Fase 4 — Validación manual

1. Sesión real con `local_intent_embed` + hybrid activados; comprobar logs `router_intent_embed` / `tool_router`.
2. Probar sin caché y con caché bajo `OPENCODE_TRANSFORMERS_CACHE`.

---

## 9. Criterios de aceptación

- [ ] No queda dependencia directa de `@xenova/transformers` en el workspace de `opencode`.
- [ ] `classifyIntentEmbed` y `augmentMatchedEmbed` completan sin excepción en smoke Node en al menos un entorno de referencia (p. ej. macOS arm64).
- [ ] Los tests existentes de comportamiento sintético (`router-embed-intent-behavior`) siguen pasando sin cambios de lógica numérica.
- [ ] Documentación de usuario (strings de config) actualizada.
- [ ] Si se usa launcher portable, documentar pasos mínimos en comentario de `scripts/opencode-isolated.sh` o equivalente.

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Incompatibilidad `onnxruntime-node` con v3 | Pin de `@huggingface/transformers` + overrides coordinados; spike en Fase 0 |
| Cambio de forma del tensor de salida | Ajuste acotado a `vecFromTensor` + test |
| Bun rompe ONNX | No declarar soporte Bun para embed en esta release; documentar |
| Regresión de calidad de embeddings | Comparar scores en el smoke con umbrales actuales; ajustar `minScore` solo con datos |
| Tamaño de bundle / tiempo de instalación | Aceptar o documentar; evaluar modelos cuantizados en fase futura |

---

## 11. Checklist de archivos (para el implementador)

- [ ] `packages/opencode/package.json`
- [ ] `packages/opencode/src/session/router-embed.ts`
- [ ] `packages/opencode/src/session/tool-router.ts` (comentarios / razón log)
- [ ] `packages/opencode/src/flag/flag.ts`
- [ ] `packages/opencode/src/config/config.ts`
- [ ] `packages/opencode/script/*intent-smoke.ts`
- [ ] `packages/opencode/test/session/router-embed*.ts`, `tool-router-xenova.test.ts`
- [ ] Raíz `package.json` (`overrides` si aplica)
- [ ] `packages/opencode/bin/opencode` (solo comentarios si el flujo ONNX no cambia)
- [ ] Regeneración `packages/sdk/js` si cambian descripciones expuestas

---

## 12. Referencias

- [Transformers.js v3 blog (Hugging Face)](https://huggingface.co/blog/transformersjs-v3)
- Documentación actual: [hf.co/docs/transformers.js](https://huggingface.co/docs/transformers.js)
- Código actual de referencia: `packages/opencode/src/session/router-embed.ts`
- **Bun + ONNX (panic al salir):** cómo reportar a Bun y qué incluir en un issue — `packages/opencode/docs/reporting-bun-onnx-crashes.md`

---

*Versión del documento: 1.0 — alineado al estado del repo openedit2 (router basado en `@xenova/transformers@2.17.2`).*
