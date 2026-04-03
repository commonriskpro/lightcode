# Benchmarks offline del tool router (Xenova)

## Objetivo

Medir y tunear el router offline (`embeddings` locales) para que el conjunto de herramientas elegidas se alinee con un **oráculo** del script de benchmark. Hay **dos dimensiones** de tuning:

1. **Flags** `experimental.tool_router.exact_match` (6 booleanos → **64** combinaciones).
2. **Números** `auto_score_ratio` + `local_embed_min_score` (rejilla configurable).

Flujo recomendado: **rejilla numérica** (o un punto fijo) → **sweep de flags** → **`exact-failures`** para ver missing vs extra por prompt.

### Oráculo de regresión (actual)

`buildRows()` usa **`packages/opencode/script/tool-router-oracle-snapshot.json`**: cada fila tiene el mismo **`text`** que el dataset legacy (`buildRowsLegacy`), pero **`expect`** = salida del router en el **config canónico** usado al generar el snapshot (**`dyn+ptm+cal`**, **`dynamic_ratio_*` `0.97`/`0.74`**, **`0.86`/`0.18`**). Con **esa misma** configuración en los scripts, **exactRate = 100%** para `CASES` ≤ 500 (comprobación de regresión). No es un oráculo “humano” independiente; sirve para **no romper** el comportamiento acordado al cambiar embeddings o políticas.

- Regenerar tras cambios **intencionados** del router: `bun run script/tool-router-write-oracle-snapshot.ts` (opcional `CASES=500`).
- Dataset legacy con etiquetas manuales: **`buildRowsLegacy`** en `tool-router-benchmark-shared.ts` (p. ej. experimentos o comparación histórica). Para usarlo en los scripts que llaman a **`buildRows()`** (p. ej. `tool-router-exact-sweep.ts`, `tool-router-config-benchmark.ts`): **`OPENCODE_TOOL_ROUTER_BENCHMARK_LEGACY=1`** (o `true` / `legacy`). Así las métricas son comparables con el **histórico del doc** (~51–53% exact en 100 casos con Xenova y bits **19**, no 100% de regresión).

### Meta de producto (exactRate)

Histórico (oráculo manual): objetivo **≥80%** **exactRate** frente a etiquetas fijas. Con el **oráculo de regresión** anterior, la métrica pasa a ser **100%** bajo el config canónico; el trabajo útil es **volver a ejecutar** `exact-failures` tras cada cambio y **actualizar el snapshot** solo cuando el nuevo comportamiento sea el deseado.

Eso es **independiente** de la meta orientativa de **~80% fullCoverageRate** (oráculo ⊆ predicho, permitiendo extras): el **exact** es estrictamente más difícil cuando el oráculo es externo al router.

### Estado baseline documentado (repo)

Condiciones: **`CASES=100`**, intent embed **off** en benchmark (`OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT` unset o `1`), dispositivo acordado (p. ej. CPU).

| Parámetro | Valor |
| --- | --- |
| `auto_score_ratio` | **0.86** |
| `local_embed_min_score` | **0.18** |
| `exact_match` | Mínimo: **`dynamic_ratio: true`**; resto **`false`**. Los multiplicadores **`dynamic_ratio_simple` / `dynamic_ratio_composite`** usan los **defaults del runtime** (**0.97** / **0.74**) salvo override en YAML. Alternativa (sweep 64 histórico, más **fullCoverage** a igual **exact** antiguo): **`dyn+ptm+cal`** (**bits 19**). |

**Métricas actuales (defaults `0.97` / `0.74` + `EMBED_PHRASE` actual en `tool-router.ts`):** con **`dyn` solo** (**bits 1**): **exactRate ≈ 0.51** (51/100), **fullCoverageRate ≈ 0.59**. Re-sweep 64 flags con `DYNAMIC_RATIO_*` fijos: mejor **exact** medido **`dyn+ptm+cal`** (**bits 19**): **≈ 0.53** (53/100), **fullCoverageRate ≈ 0.58**.

**Antes del ajuste de multiplicadores implícitos** (valores previos **0.92** / **0.82** en `effectiveAutoRatio`): **exactRate ≈ 0.49** (49/100), **fullCoverageRate ≈ 0.53** con **`dyn` solo**.

**Histórico (misma config numérica y flags, antes del cambio de frases):** **exactRate ≈ 0.39** (39/100), **fullCoverageRate ≈ 0.48**. El salto viene de separar en embeddings: read vs edit, write vs plan, bash vs codesearch, glob vs grep, todowrite vs “rollout steps”, etc.

Corridas con **solo los primeros 40** prompts del dataset no son comparables con **`CASES=100`** completos.

### Hallazgo `dynamic_ratio_*` (baseline numérico)

Rejilla offline **`tool-router-dyn-ratio-benchmark`** (10×10 sobre `dynamic_ratio_simple` × `dynamic_ratio_composite`, **`SWEEP_FLAGS_BITS=1`**, **`AUTO_SCORE_RATIO=0.86`**, **`LOCAL_EMBED_MIN_SCORE=0.18`**, **`BENCHMARK_OBJECTIVE=exact`**). La mejor celda repitió en refino **0.95–0.99 × 0.68–0.78**: **`dynamic_ratio_simple: 0.97`**, **`dynamic_ratio_composite: 0.74`** → **51/100 exact** y **59/100 fullCoverage**, frente a **49/100** con los implícitos **0.92/0.82**. Ese par es el **nuevo baseline en código** (`router-exact-match.ts` → `effectiveAutoRatio`). Los prompts compuestos pasan a un umbral relativo **más bajo** frente al mejor score, lo que en el dataset del benchmark alinea mejor el conjunto predicho con el oráculo.

### Sweep de 64 flags tras `EMBED_PHRASE` (hecho; métricas con multiplicadores antiguos 0.92/0.82)

Con **`AUTO_SCORE_RATIO=0.86`**, **`LOCAL_EMBED_MIN_SCORE=0.18`**, **`CASES=100`**, **`SWEEP_RANK=strict`**, **`SWEEP_PARALLEL=6`**, y **defaults implícitos anteriores** en `dynamic_ratio` (**0.92** / **0.82**):

- **Ninguna** combinación superaba **49/100** de **exact** (máximo observado en esa corrida).
- Varios combos empataban a **49 exact**; el **ranking `strict`** desempataba por **fullCoverageRate**, luego **F1**. El **primero** en la tabla fue **`dyn+ptm+cal`** (**bits 19**): `dynamic_ratio`, `per_tool_min`, `calibration` **on**; **fullCoverageRate 0.55** vs **0.53** con **`dyn` solo** (**bits 1**).
- Otros empates a 49 exact con mejor cobertura que `dyn`: **`dyn+cal`** (17), **`dyn+gate+cal`** (21), **`dyn+ptm+gate+cal`** (23).
- Con **`two_pass`**, el **exact** suele **bajar** (p. ej. 47 o menos en los mejores casos del sweep).

Conclusión (corrida histórica **0.92/0.82**): los flags **no** subían el techo de **exactRate** por encima del logrado con **`dyn`** en esa corrida, pero **`calibration` + `per_tool_min`** (y variantes con **`gate`**) eran **preferibles** si se priorizaba **fullCoverage** o **F1** a igualdad de **exact**.

```bash
AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 CASES=100 SWEEP_RANK=strict \
  SWEEP_PARALLEL=6 bun run script/tool-router-exact-sweep-parallel.ts
```

### Re-sweep 64 flags con `DYNAMIC_RATIO_*` fijos en **0.97 / 0.74** (hecho)

Con **`AUTO_SCORE_RATIO=0.86`**, **`LOCAL_EMBED_MIN_SCORE=0.18`**, **`CASES=100`**, **`SWEEP_RANK=strict`**, **`SWEEP_PARALLEL=8`**, y **`DYNAMIC_RATIO_SIMPLE=0.97`**, **`DYNAMIC_RATIO_COMPOSITE=0.74`** en cada celda (ver `tool-router-exact-sweep`):

- **`dyn` solo** (**bits 1**): **51/100 exact**, **59/100 fullCoverage** (alinea con `exact-failures` y el baseline numérico).
- **Mejor exact observado:** **`dyn+ptm+cal`** (**bits 19**) y empates **`dyn+ptm+gate+cal`** (23), **`dyn+cal`** (17), **`dyn+gate+cal`** (21): **53/100 exact** (**0.53**), **58/100 fullCoverage** (algo menor que `dyn` solo porque penalizan extras en **exact**).
- Peores combos (p. ej. con **`two_pass`**): **exact** cae a **~42–44**/100 en el extremo inferior de la tabla.

Comando equivalente:

```bash
AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 CASES=100 SWEEP_RANK=strict \
  DYNAMIC_RATIO_SIMPLE=0.97 DYNAMIC_RATIO_COMPOSITE=0.74 \
  SWEEP_PARALLEL=8 bun run script/tool-router-exact-sweep-parallel.ts
```

### Hipótesis: ¿más margen solo con flags hacia el 80%?

Tras el sweep con **0.92/0.82**, **no** había mejora de **exact** respecto a **~49%** solo con flags. Con **0.97/0.74** fijos, **`dyn+ptm+cal`** alcanza **~53% exact** en 100 casos (**+2** vs **`dyn` solo**). El objetivo **80%** sigue requiriendo sobre todo **`EMBED_PHRASE`**, **dataset/oráculo**, **modelo** u otra política.

### Brecha hasta el 80%

Hasta **~53% exact** en 100 casos (mejor combo de flags medido + **`dynamic_ratio_*`** actuales + `EMBED_PHRASE`), la brecha al **80%** sigue siendo grande. Palancas documentadas:

- **Flags + umbrales:** re-sweep y re-grid tras cambios en `EMBED_PHRASE` (ver hipótesis arriba).
- **Semántica:** seguir iterando `EMBED_PHRASE`, modelo de embedding, fine-tuning.
- **Oráculo / dataset:** revisar `seed` en `tool-router-benchmark-shared.ts` si hay etiquetas discutibles.
- **Router:** `keyword_rules`, intent embed, políticas distintas — siempre re-medir con el mismo benchmark.
- **Métrica:** mismo `CASES` y definición exact vs fullCoverage.

### Próximos pasos de revisión (checklist)

1. ~~**Re-sweep de 64 flags** con `0.86` / `0.18` y multiplicadores **0.92/0.82** (histórico).~~ ~~**Re-sweep** con **`DYNAMIC_RATIO_*`** fijos **0.97/0.74** (mejor **exact**: **`dyn+ptm+cal`**, bits **19**, **53/100**).~~ Elegir en producto: **`dyn`** (mínimo flags, **51/100**) vs **`dyn+ptm+cal`** (**53/100**, menos **fullCoverage** que `dyn` solo en este benchmark).
2. Opcional: **rejilla** ratio×min de nuevo por si el mínimo óptimo se movió con las frases.
3. ~~**`tool-router-exact-failures`** + **`aggregate`** para priorizar choques (ver **topMissing** / **topExtra** por tool id).~~ Última corrida (baseline **0.97/0.74**, **`dyn`**): **topMissing** `write`, `edit`, `grep`, `read`, `bash`, `glob`, `codesearch`, …; **topExtra** `todowrite`, `codesearch`, `read`, `websearch`, `write`, ….
4. Iterar **`EMBED_PHRASE`** donde sigan los choques (p. ej. edit vs write, read vs codesearch).
5. Opcional: benchmark con **`OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0`** si el producto usa intent embed.

## Comparabilidad entre corridas

- **Intent embed en benchmarks:** por defecto **desactivado** (`local_intent_embed: false` en `baseCfg`). Para activarlo (comparación legacy): `OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0`.
- Misma `CASES`, mismo dispositivo (`OPENCODE_TOOL_ROUTER_EMBED_DEVICE=cpu` vs `gpu`) y mismos env de overrides para comparar 1:1.

## Métricas (scripts compartidos)

- **exactRate** / **exact:** conjunto predicho **idéntico** al oráculo (muy estricto). **Meta de producto declarada: ≥80%** (ver arriba; mejor medido en 100 casos con flags **`dyn+ptm+cal`** + **`dynamic_ratio_*`** **0.97/0.74**: **~53%**; con **`dyn` solo** **~51%**).
- **fullCoverageRate** / **fullCoverage:** cada tool del oráculo aparece en la predicción (**extras permitidos**). Meta orientativa aparte (~80% en cobertura, no sustituye al objetivo de exact).
- Precision / recall / F1 derivados de tp/fp/fn por fila frente al conjunto esperado.

Implementación: `packages/opencode/script/tool-router-benchmark-shared.ts` (`baseCfg`, `metrics`, `compareSweepRank`, `compareConfigBenchmark`, …).

---

## 1. Sweep de flags `exact_match` (64 combinaciones)

Recorre los **64** `bits` (0–63) con el mismo dataset. Opcionalmente fija **ratio** y **min_score** del router para alinear con el mejor punto del grid numérico:

| Variable | Descripción |
| --- | --- |
| `CASES` | Casos (default 300, máx. 500). |
| `SWEEP_RANK` | `full` (prioriza **fullCoverageRate**) o `strict` (prioriza **exactRate**). |
| `AUTO_SCORE_RATIO` | Opcional; p. ej. `0.88`. |
| `LOCAL_EMBED_MIN_SCORE` | Opcional; p. ej. `0.32`. |
| `LOCAL_EMBED_TOP_K` | Opcional. |
| `DYNAMIC_RATIO_SIMPLE` / `DYNAMIC_RATIO_COMPOSITE` | Opcional; fijos en **todas** las celdas del sweep de bits (p. ej. baseline **0.97** / **0.74**). Sin esto, aplican los defaults del runtime. |
| `SWEEP_SHARD` / `SWEEP_SHARDS` | Partir el rango de bits entre procesos. |

```bash
# Desde packages/opencode/
CASES=100 SWEEP_RANK=strict bun run script/tool-router-exact-sweep.ts

AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 CASES=100 SWEEP_RANK=strict \
  bun run script/tool-router-exact-sweep.ts

# Mismo sweep de 64 flags con multiplicadores dynamic_ratio fijos (solo barrido de bits):
AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 CASES=100 SWEEP_RANK=strict \
  DYNAMIC_RATIO_SIMPLE=0.97 DYNAMIC_RATIO_COMPOSITE=0.74 \
  bun run script/tool-router-exact-sweep.ts
```

Paralelo (un proceso por shard de bits; hereda env):

```bash
SWEEP_PARALLEL=6 CASES=100 SWEEP_RANK=strict \
  AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 \
  bun run script/tool-router-exact-sweep-parallel.ts
```

Salida JSON: `best`, `top10`, `fullTable`; en modo no shard: `numericOverrides`, `productTarget`, `rankMode`.

---

## 2. Rejilla `auto_score_ratio` × `local_embed_min_score`

Fija `exact_match` con **`SWEEP_FLAGS_BITS`** (0–63) y barre todas las parejas `(ratio, min)` de listas env o defaults.

| Variable | Descripción |
| --- | --- |
| `SWEEP_FLAGS_BITS` | Bits de flags (default `33`). Usar `1` para solo `dynamic_ratio` (etiqueta `dyn`). |
| `BENCHMARK_OBJECTIVE` | `coverage` (default), `exact`, `f1`, `precision`, `recall`, `balanced`. |
| `BENCHMARK_RATIOS` | Lista CSV; default varios puntos en `0.78`–`0.94`. |
| `BENCHMARK_MIN_SCORES` | Lista CSV; default varios puntos en `0.22`–`0.38`. |
| `BENCHMARK_SHARD` / `BENCHMARK_SHARDS` | Partir celdas del grid. |
| `OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT` | Igual que arriba. |

```bash
CASES=100 SWEEP_FLAGS_BITS=1 BENCHMARK_OBJECTIVE=exact bun run script/tool-router-config-benchmark.ts

BENCHMARK_RATIOS=0.86,0.88,0.9 BENCHMARK_MIN_SCORES=0.30,0.32,0.34 \
  CASES=100 SWEEP_FLAGS_BITS=1 BENCHMARK_OBJECTIVE=exact \
  bun run script/tool-router-config-benchmark.ts
```

Paralelo por celdas:

```bash
BENCHMARK_PARALLEL=6 CASES=100 SWEEP_FLAGS_BITS=1 BENCHMARK_OBJECTIVE=exact \
  bun run script/tool-router-config-benchmark-parallel.ts
```

**Grid ampliado con el mejor flag (ej. `dyn+ptm+cal` = bits 19):** fija `SWEEP_FLAGS_BITS` y alarga listas `BENCHMARK_RATIOS` / `BENCHMARK_MIN_SCORES` (CSV) para explorar más densidad alrededor del ratio/min que ya funcionó (p. ej. 0.78–0.98 × 0.08–0.28).

```bash
BENCHMARK_RATIOS=0.76,0.80,0.84,0.88,0.92,0.96 \
BENCHMARK_MIN_SCORES=0.08,0.12,0.16,0.20,0.24,0.28 \
CASES=100 SWEEP_FLAGS_BITS=19 BENCHMARK_OBJECTIVE=exact BENCHMARK_PARALLEL=8 \
  bun run script/tool-router-config-benchmark-parallel.ts
```

Salida: `best`, `top10`, `fullTable`, `recommendedYaml` (mejor celda).

### Grid `dynamic_ratio_simple` × `dynamic_ratio_composite` (solo con `dynamic_ratio`)

Cuando **`dynamic_ratio`** está activo, el corte automático usa estos multiplicadores frente al mejor score (por defecto en runtime **0.97** / **0.74** si no se fijan en YAML). Están en `experimental.tool_router.exact_match` y se pueden **barren** con:

| Variable | Descripción |
| --- | --- |
| `BENCHMARK_DYN_SIMPLE` | CSV de ratios para prompts “simples” (default: 10 valores 0.88–0.97). |
| `BENCHMARK_DYN_COMPOSITE` | CSV para prompts compuestos (default: 10 valores 0.70–0.88). |
| `AUTO_SCORE_RATIO` / `LOCAL_EMBED_MIN_SCORE` | Fijos para el resto del router (p. ej. `0.86` / `0.18`). |
| `SWEEP_FLAGS_BITS` | Default `1` (`dyn`). |

```bash
CASES=30 SWEEP_FLAGS_BITS=1 BENCHMARK_OBJECTIVE=exact BENCHMARK_PARALLEL=8 \
  AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 \
  bun run script/tool-router-dyn-ratio-benchmark-parallel.ts
```

Scripts: `packages/opencode/script/tool-router-dyn-ratio-benchmark.ts`, `tool-router-dyn-ratio-benchmark-parallel.ts`.

---

## 3. Fallos por prompt (`exact-failures`)

Lista cada caso donde predicción ≠ oráculo, con **missing** / **extra** por tool id. Incluye **`aggregate`** (conteos por tipo de fallo y tops de tools sin post-procesar).

| Variable | Descripción |
| --- | --- |
| `SWEEP_FLAGS_BITS` | Mismos bits que en sweep/config. |
| `AUTO_SCORE_RATIO`, `LOCAL_EMBED_MIN_SCORE`, `LOCAL_EMBED_TOP_K` | Opcionales. |
| `AGGREGATE_TOP` | Cuántas entradas en `aggregate.topMissing` / `topExtra` (default `12`). |
| `CASE_INDEX` | Un solo caso (índice). |

```bash
CASES=100 SWEEP_FLAGS_BITS=1 AUTO_SCORE_RATIO=0.86 LOCAL_EMBED_MIN_SCORE=0.18 \
  bun run script/tool-router-exact-failures.ts
```

**Salida:** `summary`, **`aggregate`** (`failureKind`, `toolRefTotals`, `topMissing`, `topExtra`), `failures[]`.

En Windows PowerShell, separar stderr del JSON si hace falta guardar solo JSON:

```powershell
bun run script/tool-router-exact-failures.ts 2> router-embed.log 1> failures.json
```

---

## Flags (bits del grid `exact_match`)

| Bit | Flag | Etiqueta |
| --- | --- | --- |
| 0 | `dynamic_ratio` | dyn |
| 1 | `per_tool_min` | ptm |
| 2 | `intent_gating` | gate |
| 3 | `redundancy` | red |
| 4 | `calibration` | cal |
| 5 | `two_pass` | 2p |

El campo `label` en JSON resume la combinación (p. ej. `dyn+ptm+cal`).

---

## Archivos de referencia

| Script | Rol |
| --- | --- |
| `packages/opencode/script/tool-router-benchmark-shared.ts` | Dataset, métricas, `baseCfg`, comparadores. |
| `packages/opencode/script/tool-router-exact-sweep.ts` | Sweep 64 flags. |
| `packages/opencode/script/tool-router-exact-sweep-parallel.ts` | Sweep paralelo. |
| `packages/opencode/script/tool-router-config-benchmark.ts` | Grid ratio × min. |
| `packages/opencode/script/tool-router-config-benchmark-parallel.ts` | Grid paralelo. |
| `packages/opencode/script/tool-router-dyn-ratio-benchmark.ts` | Grid `dynamic_ratio_simple` × `dynamic_ratio_composite`. |
| `packages/opencode/script/tool-router-dyn-ratio-benchmark-parallel.ts` | Grid din-ratio paralelo. |
| `packages/opencode/script/tool-router-exact-failures.ts` | Fallos + aggregate. |
| `packages/opencode/src/session/router-exact-match.ts` | Implementación de flags. |
| `packages/opencode/src/config/config.ts` | Schema `experimental.tool_router`. |
| `packages/opencode/src/session/tool-router.ts` | `EMBED_PHRASE`, `SLIM_DESC`, reglas híbridas; texto que alimenta Xenova. |

---

## Notas operativas

- Los embeddings son **CPU (ONNX)** en el worker; muchos procesos en paralelo multiplican memoria: ajustar `SWEEP_PARALLEL`, `BENCHMARK_PARALLEL` o shards.
- El resultado óptimo depende del **dataset del script**; validar con tráfico real o ampliar `CASES`.
