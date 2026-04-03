/**
 * Grid over auto_score_ratio × local_embed_min_score (same dataset as exact sweep).
 * Fija exact_match con SWEEP_FLAGS_BITS (0–63), por defecto 19 (dyn+ptm+cal; alineado con oracle snapshot).
 *
 * Métricas: exactRate (conjunto idéntico), fullCoverageRate (oráculo ⊆ predicho, extras OK). Meta producto ~80% en fullCoverageRate.
 *
 * BENCHMARK_OBJECTIVE=coverage (default) | f1 | precision | recall | exact | balanced
 *   balanced = 0.55*f1 + 0.45*exactRate
 *
 *   CASES=200 SWEEP_FLAGS_BITS=19 bun run script/tool-router-config-benchmark.ts
 *
 * Rejilla custom:
 *   BENCHMARK_RATIOS=0.78,0.84,0.9,0.94 BENCHMARK_MIN_SCORES=0.22,0.3,0.38
 *
 * Shard:
 *   BENCHMARK_SHARD=0 BENCHMARK_SHARDS=4 bun run script/tool-router-config-benchmark.ts
 *
 * Sin intent embed por defecto; con intent: OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0
 */
import { ToolRouter } from "../src/session/tool-router"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"
import type { ExactMatchFlags } from "../src/session/router-exact-match"
import {
  baseCfg,
  buildRows,
  caseIndex,
  comboFromBits,
  compareConfigBenchmark,
  labelBits,
  metrics,
  msg,
  oneCase,
  tools,
} from "./tool-router-benchmark-shared"

type M = ReturnType<typeof metrics>

function parseList(raw: string | undefined, def: number[]) {
  if (!raw?.trim()) return def
  return raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => !Number.isNaN(n))
}

const cases = Math.min(500, Math.max(1, Number(process.env.CASES ?? "300") || 300))
const rows = oneCase(process.env.CASE_INDEX, buildRows(cases))
const bits = Math.max(0, Math.min(63, Number(process.env.SWEEP_FLAGS_BITS ?? "19") || 19))
const flags = comboFromBits(bits)
const label = labelBits(bits)

const ratios = parseList(process.env.BENCHMARK_RATIOS, [0.78, 0.82, 0.86, 0.9, 0.94])
const mins = parseList(process.env.BENCHMARK_MIN_SCORES, [0.22, 0.26, 0.3, 0.34, 0.38])
const objective = (process.env.BENCHMARK_OBJECTIVE ?? "coverage").trim().toLowerCase() || "coverage"

const pairs: { ratio: number; min: number; idx: number }[] = []
let k = 0
for (const ratio of ratios) {
  for (const min of mins) {
    pairs.push({ ratio, min, idx: k })
    k++
  }
}

const nshard = Math.max(1, Math.min(256, Number(process.env.BENCHMARK_SHARDS ?? "1") || 1))
const ishard = Math.max(0, Math.min(nshard - 1, Number(process.env.BENCHMARK_SHARD ?? "0") || 0))
const run = pairs.filter((_, i) => i % nshard === ishard)

const results: {
  auto_score_ratio: number
  local_embed_min_score: number
  flags: ExactMatchFlags
  bits: number
  label: string
  m: M
}[] = []

for (const p of run) {
  const out: { expect: string[]; got: string[] }[] = []
  for (const row of rows) {
    const ret = await ToolRouter.apply({
      tools: tools as any,
      messages: msg(row.text) as any,
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg({
        exact: flags,
        auto_score_ratio: p.ratio,
        local_embed_min_score: p.min,
      }) as any,
      mcpIds: new Set(),
      skip: false,
    })
    out.push({ expect: row.expect, got: Object.keys(ret.tools).sort() })
  }
  results.push({
    auto_score_ratio: p.ratio,
    local_embed_min_score: p.min,
    flags,
    bits,
    label,
    m: metrics(out),
  })
}

results.sort((a, b) => compareConfigBenchmark(a.m, b.m, objective))

const partial = nshard > 1
if (partial) {
  console.log(
    JSON.stringify(
      {
        partial: true as const,
        benchmark: "config",
        shard: ishard,
        shards: nshard,
        objective,
        bits,
        label,
        flags,
        grid: { ratios, minScores: mins, pairCount: pairs.length },
        cases: rows.length,
        selectedCase: process.env.CASE_INDEX
          ? { index: caseIndex(process.env.CASE_INDEX), prompt: rows[0]?.text ?? "" }
          : undefined,
        results,
      },
      null,
      2,
    ),
  )
  shutdownRouterEmbedIpc()
} else {
  const best = results[0]
  console.log(
    JSON.stringify(
      {
        benchmark: "config",
        objective,
        bits,
        label,
        flags,
        grid: { ratios, minScores: mins, cells: pairs.length },
        cases: rows.length,
        selectedCase: process.env.CASE_INDEX
          ? { index: caseIndex(process.env.CASE_INDEX), prompt: rows[0]?.text ?? "" }
          : undefined,
        best,
        top10: results.slice(0, 10).map((r, i) => ({
          rank: i + 1,
          auto_score_ratio: r.auto_score_ratio,
          local_embed_min_score: r.local_embed_min_score,
          exact: r.m.exact,
          exactRate: r.m.exactRate,
          fullCoverage: r.m.fullCoverage,
          fullCoverageRate: r.m.fullCoverageRate,
          f1: r.m.f1,
          precision: r.m.precision,
          recall: r.m.recall,
        })),
        fullTable: results.map((r) => ({
          auto_score_ratio: r.auto_score_ratio,
          local_embed_min_score: r.local_embed_min_score,
          exact: r.m.exact,
          exactRate: r.m.exactRate,
          fullCoverage: r.m.fullCoverage,
          fullCoverageRate: r.m.fullCoverageRate,
          f1: r.m.f1,
          precision: r.m.precision,
          recall: r.m.recall,
        })),
        productTarget: {
          fullCoveragePctGoal: 80,
          note: "Priorizar fullCoverageRate; exactRate penaliza herramientas extra.",
        },
        recommendedYaml: best
          ? {
              "experimental.tool_router.auto_score_ratio": best.auto_score_ratio,
              "experimental.tool_router.local_embed_min_score": best.local_embed_min_score,
              "experimental.tool_router.exact_match": best.flags,
            }
          : undefined,
      },
      null,
      2,
    ),
  )
  shutdownRouterEmbedIpc()
}
