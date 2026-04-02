# Benchmark offline: grid `exact_match` del tool router

## Objetivo

Encontrar la **mejor combinación de opciones** bajo `experimental.tool_router.exact_match` que maximice el **acierto exacto** del router offline (embeddings Xenova): que el conjunto de herramientas elegidas coincida **exactamente** con el conjunto esperado para cada prompt de prueba.

No buscamos solo “más herramientas correctas” sueltas: la métrica principal es **exact match** por caso (mismo conjunto de tool ids que el esperado). Si empatan varias combinaciones en exactitud, el script usa **tasa de exactos** y luego **F1 / precisión** como desempate (ver salida JSON).

## Contexto

- El router híbrido con `local_embed` rankea candidatos; `exact_match` aplica filtros posteriores (`router-exact-match.ts`) sobre scores y listas (umbrales dinámicos, mínimos por tool, gating por intención, redundancia web, calibración, segunda pasada, etc.).
- Cada combinación es un vector de **seis booleanos**; el sweep recorre las **64** combinaciones (2^6).

## Flags (bits del grid)

| Bit | Flag (`config` / tipo) | Etiqueta corta en resultados |
| --- | --- | --- |
| 0 | `dynamic_ratio` | dyn |
| 1 | `per_tool_min` | ptm |
| 2 | `intent_gating` | gate |
| 3 | `redundancy` | red |
| 4 | `calibration` | cal |
| 5 | `two_pass` | 2p |

El índice `bits` (0–63) codifica esos flags en el script de sweep; el campo `label` en el JSON resume la combinación (p. ej. `dyn+ptm+cal`).

## Dataset y métricas del script

- Prompts sintéticos fijos + expansión hasta `CASES` (por defecto 300, máximo 500 en el script).
- Por cada combinación se llama a `ToolRouter.apply` con el mismo perfil de router (embed local, mismos `base_tools`, etc.).
- Se calculan coincidencias exactas por fila, **exactRate** = exactos / casos, y precision/recall/F1 derivados de tp/fp/fn por fila frente al conjunto esperado.
- La salida ordena combinaciones priorizando **más exactos**, luego **exactRate**, luego **F1**, etc. Los campos `best` y `top10` resumen las mejores.

## Cómo ejecutar

Desde `packages/opencode/`:

```bash
# Un solo proceso (un worker IPC de embeddings; puede ser lento)
CASES=300 bun run script/tool-router-exact-sweep.ts
```

Paralelizar por **varios procesos** (cada uno con su worker; reduce tiempo de pared en máquinas con RAM suficiente):

```bash
SWEEP_PARALLEL=4 CASES=300 bun run script/tool-router-exact-sweep-parallel.ts
```

Shard manual (una fracción de los 64 `bits`):

```bash
SWEEP_SHARD=0 SWEEP_SHARDS=8 CASES=300 bun run script/tool-router-exact-sweep.ts
```

## Archivos de referencia

- Implementación de flags y filtros: `packages/opencode/src/session/router-exact-match.ts`
- Sweep y métricas: `packages/opencode/script/tool-router-exact-sweep.ts`
- Orquestador multi-proceso: `packages/opencode/script/tool-router-exact-sweep-parallel.ts`
- Schema de config: `experimental.tool_router.exact_match` en `packages/opencode/src/config/config.ts`

## Notas operativas

- Los embeddings son **CPU (ONNX)** en el worker Node; muchos procesos en paralelo multiplican memoria y pueden saturar la máquina: ajustar `SWEEP_PARALLEL` o `SWEEP_SHARDS` según RAM.
- El resultado óptimo del grid depende del **dataset del script**; para validar en producción hay que contrastar con tráfico real o ampliar casos.
