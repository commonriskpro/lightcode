# Offline router eval dataset expansion

## Frozen regression gate (reviewed)

**`router-eval-reviewed.jsonl`** is the **trusted** offline router benchmark: curated subset (size capped by expand rules; see `router-eval-expand`), **100% pass** expected under `default` eval mode with local intent embed. It is **not** a moving target for casual optimization — treat regressions as bugs.

- **Expanded** (`router-eval-expanded.jsonl`) is for **stress / exploration** and may include **many more** synthetic rows and optional **`sampled_heuristic`** lines — **not** gold labels.
- **`sampled_heuristic`** rows are **exploratory**; label noise is expected.

Gate command (from `packages/opencode`):

```bash
bun run router:eval:reviewed:gate
```

See [`router-eval.md`](./router-eval.md) for breakdown, expanded advisory script, and extras analysis.

---

## Commands

```bash
cd packages/opencode
bun run router:eval:expand
bun run router:eval:review-candidates   # recompute candidates from expanded JSONL only
```

Outputs (defaults):

| Output | Purpose |
|--------|---------|
| `test/fixtures/router-eval-expanded.jsonl` | Full mixed dataset |
| `test/fixtures/router-eval-reviewed.jsonl` | **Regression gate**: seed + capped non-filler synthetic; `reviewed: true`, `confidence` high/medium |
| `test/fixtures/router-eval-expanded.manifest.json` | Counts, floors vs actual, underrepresented categories, review-candidate count |
| `test/fixtures/router-eval-candidates.json` | Deterministic rows prioritized for **manual** label review |
| `test/fixtures/router-eval-expanded.skipped.json` | Corpus parse/skip events |

### Expand CLI flags

| Flag | Meaning |
|------|---------|
| `--seed <path>` | Seed JSONL (default: `test/fixtures/router-eval.jsonl`) |
| `--out <path>` | Output expanded JSONL |
| `--manifest <path>` | Extended manifest JSON |
| `--skipped-out <path>` | Skipped-line summary |
| `--reviewed-out <path>` | Reviewed subset JSONL |
| `--candidates-out <path>` | Review candidates JSON |
| `--no-reviewed` | Do not write reviewed file |
| `--sample-file <path>` | Gzip corpus (`prompt`, `anchor`, `positive`) |
| `--sample-limit <n>` | Max sampled rows (default 220) |
| `--per-tool-cap <n>` | Max rows per corpus tool id |
| `--sample-stride <n>` | Only every Nth line (`0` = all) |
| `--synthetic-limit <n>` | Cap synthetic rows |
| `--no-sampled` / `--no-synthetic` | Disable sources |
| `--no-balance` | Skip floor/cap balancing (dedupe only) |
| `--verbose` | Progress on stderr |

## Provenance

- `source`: `seed` | `synthetic` | `sampled_heuristic`
- `category`: routing scenario (e.g. `conflict_gate`, `edge`, `multi_clause`)
- `confidence` / `reviewed`: only on **`router-eval-reviewed.jsonl`** (curated)

## Balancing

The expand step applies **minimum floors** then **maximum caps** per category (`DEFAULT_CATEGORY_FLOORS` / `DEFAULT_CATEGORY_CAPS` in `src/session/router-eval-expand.ts`) so weak but important categories (conflict gates, task/skill, edge, edit/write) are not starved after deduplication. Floors are satisfied in a fixed category order (seed first, then conflict/task/edge-heavy categories).

## Heuristic sampled rows

`sampled_heuristic` labels come from the first token of `positive` before `.`; they are **not** gold. Use for stress coverage; do **not** treat as reviewed.

## Reviewed subset rules

1. All **seed** rows → `confidence: high`, `reviewed: true`.
2. **Synthetic** rows whose notes do not match filler patterns → up to **9** per category (sorted by id) → `confidence: medium`, `reviewed: true`.
3. **No** `sampled_heuristic` rows in the reviewed file.
4. Total capped at **150** rows; if below **80**, more synthetic rows are added until the minimum is reached or the pool is exhausted.

## Review candidates

`selectReviewCandidates` scores rows (sampled, short prompts, many required tools, edge/conflict categories, multi-clause shape). The JSON lists ids sorted by priority for **human** review—not automatic gold labels.

## Regression gating

- **Strict gate (primary):** `bun run router:eval:reviewed:gate` — reviewed dataset, **100% pass** required (`--min-pass-rate 1`), exit code 1 on failure.
- **Broad signal:** `bun run router:eval:expanded:breakdown` or `bun run router:eval -- --dataset test/fixtures/router-eval-expanded.jsonl --breakdown`
- **Advisory (expanded):** `bun run router:eval:expanded:advisory` — fails if pass rate **&lt; 75%** (tune threshold if baseline shifts; see `router-eval.md`).

## Limitations

- Sampled labels are heuristic; synthetic templates are hand-written but not formally verified.
- Reviewed subset synthetic rows are **medium** confidence by policy; only seed rows are **high**.
