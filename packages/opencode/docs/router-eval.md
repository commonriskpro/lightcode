# Offline tool router evaluation

Local harness to measure routing precision, extras, and forbidden selections **without** the chat model.

## Benchmark tiers (read this first)

| Dataset | Role | Trust level |
|---------|------|-------------|
| **`router-eval-reviewed.jsonl`** | **Frozen regression gate** for offline router changes | **High** — manually curated subset (seed + reviewed synthetic; no `sampled_heuristic`). Intended as the **only** strict CI-style check. |
| **`router-eval-expanded.jsonl`** | Broader coverage (seed + synthetic + optional corpus samples) | **Exploratory** — higher row count, more stress; pass rate is **not** frozen. Use for tuning signal, not as the primary gate. |
| **Heuristic / `sampled_heuristic`** | From corpus expansion | **Not gold** — labels are heuristic; do not treat failures as automatically wrong router behavior. |

**Do not** chase 100% on expanded or sampled rows during routine work. **Do** keep **reviewed** at **100% pass** (see gate command below) when touching router code.

## Regression gate (reviewed)

From `packages/opencode`:

```bash
bun run router:eval:reviewed:gate
```

This runs `router-eval-reviewed.jsonl` with **`--min-pass-rate 1`** (exit code **1** if any row fails) and **`--breakdown`** (category, source, extras summary). Same as:

```bash
bun run script/router-eval.ts -- --reviewed --min-pass-rate 1 --breakdown
```

**Recommended** before merging router changes: `bun typecheck`, `router:eval:reviewed:gate`, and `test/session/tool-router*.ts` / `router-policy*.ts` / `router-eval*.ts`.

## Expanded dataset (advisory)

```bash
bun run router:eval:expanded:breakdown
```

Optional softer check (exit **1** if pass rate **&lt; 75%** — adjust as your baseline moves):

```bash
bun run router:eval:expanded:advisory
```

Expanded is **not** the primary gate; it surfaces stress cases and **multi_clause** / **grep_codesearch** synthetic depth. **Baseline** (as of reviewed-freeze): ~294 prompts, ~**79%** pass, ~**18%** exact; exact rate is expected to stay **below** pass rate because **allowed** extras still break “exact”.

## Run

```bash
bun run router:eval
```

Default dataset: `test/fixtures/router-eval.jsonl` (small seed).

### Package scripts

| Script | Meaning |
|--------|---------|
| `router:eval` | Default harness |
| `router:eval:reviewed` | Reviewed dataset, no threshold |
| `router:eval:reviewed:gate` | Reviewed + **min pass 100%** + breakdown |
| `router:eval:expanded` | Expanded dataset |
| `router:eval:expanded:breakdown` | Expanded + category / source / extras |
| `router:eval:expanded:advisory` | Expanded + min pass **75%** (advisory) |
| `router:eval:tool-costs` | Print **canonical per-tool definition cost** table (no eval run) |

### CLI flags

- `--reviewed` — use `test/fixtures/router-eval-reviewed.jsonl`
- `--expanded` — use `test/fixtures/router-eval-expanded.jsonl` (unless `--dataset` is set)
- `--dataset <path>` — JSONL file
- `--breakdown` — pass rate by **category** and **source**, **extras/minimality** (counts), **top tool-cost summary**, **extras × estimated definition bytes**, sample of failing rows
- `--tool-costs` — print full **offline** tool definition cost table and exit (see `router-eval-tool-cost.ts`)
- `--min-pass-rate <0..1>` — exit **1** if global pass rate below threshold
- `--fail-on-regression` — sets min pass rate to **0.85** if not overridden (legacy; prefer explicit `--min-pass-rate` for gates)
- `--mode <preset>` — `default` \| `keyword_rules_on` \| `keyword_rules_off` \| `router_only` \| `no_match_on` \| `sticky_off` \| `passthrough` \| `intent_on`
- `--compare <a> <b>` — two modes, side-by-side + delta pass rate
- `--limit N` — first N rows
- `--tool <id>` — rows that involve that tool in required/forbidden/allowed or notes
- `--verbose` — per-row line
- `--json-out <file>` — machine-readable report (includes `by_source`, `extras_analysis`, `extras_cost`, `tool_cost_catalog`)

## Dataset fields (JSONL)

| Field | Meaning |
|-------|---------|
| `id` | Stable id for logs |
| `prompt` | User text (EN/ES, single or multi-clause) |
| `agent` | Agent name (e.g. `build`, `plan`) |
| `available_tools` | Tool ids allowed for this example |
| `required_tools` | Must appear in router output |
| `allowed_tools` | Optional extras that do not break **exact** match |
| `forbidden_tools` | Must not appear; selecting one fails **pass** |
| `expect_conversation` | If true, **pass** only when no tools are selected |
| `source` | `seed` \| `synthetic` \| `sampled_heuristic` |
| `category` | Scenario tag (e.g. `bash_gate`, `multi_clause`) |
| `confidence` / `reviewed` | On reviewed file only |

**Pass**: every `required_tools` present, no `forbidden_tools` selected.  
**Exact**: **pass** and no extras outside `required_tools ∪ allowed_tools`.

The default eval preset (`defaultEvalRouterConfig` in `router-eval-context.ts`) enables **`local_intent_embed: true`** so results match the hybrid router. The hybrid router merges intent per clause when needed and applies **policy gates** with per-clause lexical OR.

## Metrics

- **Global**: total prompts, pass/exact counts and rates, average selected count, average forbidden selections, average missing required, **over-selection**, conversation violations, rows that missed all required tools.
- **Per tool**: micro-averaged precision/recall (TP/FP/FN).
- **Buckets**: counts of forbidden selections by tool id (`forbidden_fp_buckets`).
- **Breakdown**: by **category** and **source**; **extras analysis** (histogram of extra-tool counts, top tools appearing as extras — often `skill` / `task` from `base_tools`).
- **Worst cases**: ranked by forbidden count, missing required, over-selection.

## Pass rate vs minimality vs **definition cost**

**100% pass** on reviewed does **not** mean minimal tool sets. The router may still attach **base tools** (`task`, `skill`, etc.) and score **extras** on rows where those ids are not in `required ∪ allowed`. Use **`--breakdown`** extras section to inspect inflation; **exact match** rate stays lower than pass rate by design.

**Extra tool count ≠ extra context cost.** Two tools can both count as one “extra” but have very different on-wire sizes (description + JSON Schema for parameters). The harness reports:

- **`router:eval:tool-costs`** — canonical **per-tool** estimates (UTF-8 description bytes from `src/tool/*.txt` + `z.toJSONSchema(parameters)` size; token heuristic `ceil(bytes/4)` aligned with router logging).
- **With `--breakdown`** — **extras cost**: sums those bytes across extra tool occurrences per row; ranks tools by **total contributed bytes**, not just frequency.

**Buckets** (`low` / `medium` / `high`) are by **definition** size tiers (see `router-eval-tool-cost.ts`), not by frequency. A tool can be a frequent extra but **cheap** (e.g. small schema); another can be rare but **expensive**. Future minimality work should prioritize **high-cost** extras when trimming is justified — not raw counts.

**Caveats:** Eval uses **dummy** one-line descriptions in `runRouterEvalCase`; **cost attribution** uses the **production**-style catalog above. Live **task** / **skill** descriptions vary (agent list, skill list); the catalog uses **fixed representative** text for those (documented in module comments).

## Tuning

Use **compare** modes for A/B thresholds. **Do not** tune primarily against reviewed to the point of overfitting; **do** keep the reviewed gate green. Use expanded for broader signal only.

## Implementation

- Scoring: `src/session/router-eval-score.ts` — `aggregateByCategory`, `aggregateBySource`, `aggregateExtrasAnalysis`, `aggregateExtrasCost`
- Per-tool wire estimates: `src/session/router-eval-tool-cost.ts`
- Types/parser: `router-eval-types.ts`
- Runner: `src/session/router-eval-context.ts`, `script/router-eval.ts`
