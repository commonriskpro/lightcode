/**
 * Grid over dynamic_ratio_simple × dynamic_ratio_composite (solo aplica con dynamic_ratio on).
 * Fija SWEEP_FLAGS_BITS (default 1 = dyn) y ratio/min globales vía env o defaults.
 *
 *   CASES=30 BENCHMARK_OBJECTIVE=exact bun run script/tool-router-dyn-ratio-benchmark.ts
 *
 * Rejilla 10×10 (defaults):
 *   BENCHMARK_DYN_SIMPLE=0.88,...,0.97 BENCHMARK_DYN_COMPOSITE=0.70,...,0.88
 *
 * Shard: BENCHMARK_SHARD=0 BENCHMARK_SHARDS=4
 *
 * Sin intent embed por defecto; con intent: OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0
 */
import { ToolRouter } from "../src/session/tool-router"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"
import type { ExactMatchFlags } from "../src/session/router-exact-match"
import {
  baseCfg,
  benchEnvNum,
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

const defSimple = [0.88, 0.89, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97]
const defComposite = [0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86, 0.88]

const cases = Math.min(500, Math.max(1, Number(process.env.CASES ?? "300") || 300))
const rows = oneCase(process.env.CASE_INDEX, buildRows(cases))
const bits = Math.max(0, Math.min(63, Number(process.env.SWEEP_FLAGS_BITS ?? "1") || 1))
const flags = comboFromBits(bits)
const label = labelBits(bits)

const simples = parseList(process.env.BENCHMARK_DYN_SIMPLE, defSimple)
const composites = parseList(process.env.BENCHMARK_DYN_COMPOSITE, defComposite)
const objective = (process.env.BENCHMARK_OBJECTIVE ?? "exact").trim().toLowerCase() || "exact"

const ratio = benchEnvNum("AUTO_SCORE_RATIO") ?? 0.86
const min = benchEnvNum("LOCAL_EMBED_MIN_SCORE") ?? 0.18

const pairs: { simple: number; composite: number; idx: number }[] = []
let k = 0
for (const s of simples) {
  for (const c of composites) {
    pairs.push({ simple: s, composite: c, idx: k })
    k++
  }
}

const nshard = Math.max(1, Math.min(256, Number(process.env.BENCHMARK_SHARDS ?? "1") || 1))
const ishard = Math.max(0, Math.min(nshard - 1, Number(process.env.BENCHMARK_SHARD ?? "0") || 0))
const run = pairs.filter((_, i) => i % nshard === ishard)

const results: {
  dynamic_ratio_simple: number
  dynamic_ratio_composite: number
  auto_score_ratio: number
  local_embed_min_score: number
  flags: ExactMatchFlags
  bits: number
  label: string
  m: M
}[] = []

for (const p of run) {
  const out: { expect: string[]; got: string[] }[] = []
  const ex: ExactMatchFlags = {
    ...flags,
    dynamic_ratio_simple: p.simple,
    dynamic_ratio_composite: p.composite,
  }
  for (const row of rows) {
    const ret = await ToolRouter.apply({
      tools: tools as any,
      messages: msg(row.text) as any,
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg({
        exact: ex,
        auto_score_ratio: ratio,
        local_embed_min_score: min,
      }) as any,
      mcpIds: new Set(),
      skip: false,
    })
    out.push({ expect: row.expect, got: Object.keys(ret.tools).sort() })
  }
  results.push({
    dynamic_ratio_simple: p.simple,
    dynamic_ratio_composite: p.composite,
    auto_score_ratio: ratio,
    local_embed_min_score: min,
    flags: ex,
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
        benchmark: "dyn_ratio",
        shard: ishard,
        shards: nshard,
        objective,
        bits,
        label,
        baseFlags: flags,
        grid: {
          dynamicSimple: simples,
          dynamicComposite: composites,
          pairCount: pairs.length,
        },
        fixed: { auto_score_ratio: ratio, local_embed_min_score: min },
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
        benchmark: "dyn_ratio",
        objective,
        bits,
        label,
        baseFlags: flags,
        grid: { dynamicSimple: simples, dynamicComposite: composites, cells: pairs.length },
        fixed: { auto_score_ratio: ratio, local_embed_min_score: min },
        cases: rows.length,
        selectedCase: process.env.CASE_INDEX
          ? { index: caseIndex(process.env.CASE_INDEX), prompt: rows[0]?.text ?? "" }
          : undefined,
        best,
        top10: results.slice(0, 10).map((r, i) => ({
          rank: i + 1,
          dynamic_ratio_simple: r.dynamic_ratio_simple,
          dynamic_ratio_composite: r.dynamic_ratio_composite,
          exact: r.m.exact,
          exactRate: r.m.exactRate,
          fullCoverage: r.m.fullCoverage,
          fullCoverageRate: r.m.fullCoverageRate,
          f1: r.m.f1,
          precision: r.m.precision,
          recall: r.m.recall,
        })),
        fullTable: results.map((r) => ({
          dynamic_ratio_simple: r.dynamic_ratio_simple,
          dynamic_ratio_composite: r.dynamic_ratio_composite,
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
          note: "Grid tunea multiplicadores por defecto (0.97/0.74) sustituidos por dynamic_ratio_simple/composite cuando dynamic_ratio es true.",
        },
        recommendedYaml: best
          ? {
              "experimental.tool_router.auto_score_ratio": best.auto_score_ratio,
              "experimental.tool_router.local_embed_min_score": best.local_embed_min_score,
              "experimental.tool_router.exact_match": {
                ...best.flags,
                dynamic_ratio_simple: best.dynamic_ratio_simple,
                dynamic_ratio_composite: best.dynamic_ratio_composite,
              },
            }
          : undefined,
      },
      null,
      2,
    ),
  )
  shutdownRouterEmbedIpc()
}
