# Cambios del fork: router offline, eval y costes

Documento de referencia (español) que resume el trabajo hecho en **commonriskpro/lightcode** sobre el router de herramientas offline, el benchmark y el análisis de coste de definiciones.

---

## 1. Router offline (tuning local, sin modelo de pago)

### Objetivo

Mejorar filas débiles (multi-cláusula, preguntas, task/skill cuando no debe delegarse, bash prohibido/conflictos) sin reemplazar el router ni tocar etiquetas del dataset revisado.

### Archivos principales

| Archivo | Cambios (resumen) |
|---------|-------------------|
| `packages/opencode/src/session/router-policy.ts` | `BASH_ALLOW`: evitar que `git\s` coincida con “No git commands”; `strongBash` más acotado; `forbidsShellExecution` ampliado (no terminal, no ejecución, solo lectura, etc.); `negatesTaskDelegation` + `applyHardGates` quita `task` si el usuario niega subagente/delegación; `search the codebase for` mantiene **grep + codesearch** en conflictos; `strongWrite`/`strongEdit`/`literalSearch`/`questionIntent` ampliados (p. ej. `¿?`, `this (`, `implementa`, `create a new test file`, `¿qué hace` + repo). |
| `packages/opencode/src/session/tool-router.ts` | Import de `lexicalSignals`; hints léxicos: `question` si `questionIntent`, `grep`+`read`+`question` para `this`/`this (`; hint `repo_que_hace` (grep); hint `new_test_file` (write); `lexicalHint` en señal router/sticky. |
| `packages/opencode/src/session/router-embed-impl.ts` | Frases extra en prototipos `fix/debug` y `create/implement` (p. ej. tests failing, unit test beside router policy). |

### Comportamiento destacado

- Preguntas: `questionIntent` incluye `¿?` con sufijo, `^this\s*\(`.
- Bash: no forzar bash cuando hay prohibición explícita de shell/git.
- Task: quitar `task` si el texto niega delegación/subagente.
- Multi-cláusula: política de conflictos grep/codesearch cuando aplica “search the codebase for…”.

### Tests

- `packages/opencode/test/session/router-policy.test.ts` — delegación, no-git, grep+codesearch, señales léxicas.
- `packages/opencode/test/session/tool-router.test.ts` — `Ask me`, `?`, `this`.

---

## 2. Congelación del benchmark “reviewed”

### Objetivo

Tratar `router-eval-reviewed.jsonl` como **puerta de regresión** fiable; expanded como estrés/exploratorio; documentar comandos y umbrales.

### Archivos

| Archivo | Cambios |
|---------|---------|
| `packages/opencode/script/router-eval.ts` | `--expanded`, `resolveDatasetPath`, `aggregateBySource`, `aggregateExtrasAnalysis`, breakdown por fuente, JSON con `by_source`, `extras_analysis`; más adelante costes (ver §3). |
| `packages/opencode/src/session/router-eval-score.ts` | `aggregateBySource`, `aggregateExtrasAnalysis`, tipos asociados. |
| `packages/opencode/package.json` | Scripts: `router:eval:reviewed:gate`, `router:eval:expanded`, `router:eval:expanded:breakdown`, `router:eval:expanded:advisory`. |
| `packages/opencode/docs/router-eval.md` | Tiers, gate 100%, expanded advisory, métricas. |
| `packages/opencode/docs/router-eval-dataset.md` | Congelación, comandos de gate. |
| `packages/opencode/docs/spec-offline-tool-router.md` | §19 evaluación, gate, caveats. |
| `README.md` (raíz) | Puerta reviewed y referencia a expanded. |

### Comandos útiles

```bash
cd packages/opencode
bun run router:eval:reviewed:gate
bun run router:eval:expanded:breakdown
```

---

## 3. Coste de definición de tools (extras en bytes, no solo recuento)

### Objetivo

Medir coste **real** estimado por tool (descripción + esquema JSON) y atribuir **bytes** a los “extras” del eval, para distinguir extras baratos vs caros.

### Archivos

| Archivo | Cambios |
|---------|---------|
| `packages/opencode/src/session/router-eval-tool-cost.ts` | Catálogo canónico: textos `src/tool/*.txt`, `z.toJSONSchema(parameters)` (Zod 4), tokens `ceil(total_bytes/4)`, buckets low/medium/high, representantes fijos para task/skill. |
| `packages/opencode/src/session/router-eval-score.ts` | `aggregateExtrasCost`, tipo `ExtrasCostAggregate`. |
| `packages/opencode/script/router-eval.ts` | `--tool-costs`, resumen de coste en `--breakdown`, `printExtrasCostReport`, JSON `tool_cost_catalog`, `extras_cost`. |
| `packages/opencode/package.json` | `router:eval:tool-costs`. |
| `packages/opencode/docs/router-eval.md` | Sección coste vs recuento; `z.toJSONSchema`. |
| `packages/opencode/docs/spec-offline-tool-router.md` | Fila tabla definición/coste. |
| `README.md` | Mención a `router:eval:tool-costs` y `--breakdown`. |
| `packages/opencode/test/session/router-eval.test.ts` | Tests `getToolCostCatalog`, `aggregateExtrasCost`. |

### Comandos

```bash
bun run router:eval:tool-costs
bun run script/router-eval.ts -- --reviewed --breakdown
```

### Hallazgo útil

- **task** suele aportar mucho más **total** de bytes como extra que **skill** (skill tiene definición pequeña en catálogo).
- El eval sigue usando `dummyTool` en ejecución; el coste usa el **catálogo** de producción.

---

## 4. Validación habitual (paquete opencode)

```bash
cd packages/opencode
bun typecheck
bun run router:eval:reviewed:gate
bun test test/session/tool-router.test.ts test/session/router-policy.test.ts test/session/router-eval.test.ts --preload ./test/preload.ts
```

---

## 5. Rama Git `fallback`

Si el directorio **no** tenía `.git`, se puede inicializar con la rama inicial `fallback`:

```bash
cd /ruta/al/lightcode-dev
git init -b fallback
git add .
git commit -m "Document fork router/eval changes and baseline"
```

Si ya existe un repo con otra rama por defecto:

```bash
git checkout -b fallback
```

---

*Última actualización: documento generado para alinear documentación y rama `fallback`.*
