/**
 * Orquesta tool-router-dyn-ratio-benchmark.ts en N procesos (fracción del grid c/u).
 *
 *   BENCHMARK_PARALLEL=8 CASES=30 bun run script/tool-router-dyn-ratio-benchmark-parallel.ts
 */
import os from "node:os"
import path from "node:path"
import { compareConfigBenchmark } from "./tool-router-benchmark-shared"

type M = {
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
  exact: number
  total: number
  exactRate: number
  fullCoverage: number
  fullCoverageRate: number
}

type Row = {
  dynamic_ratio_simple: number
  dynamic_ratio_composite: number
  auto_score_ratio: number
  local_embed_min_score: number
  flags: Record<string, boolean | number | undefined>
  bits: number
  label: string
  m: M
}

type PartialPayload = {
  partial: boolean
  benchmark?: string
  shard: number
  shards: number
  objective?: string
  bits?: number
  label?: string
  baseFlags?: Record<string, boolean | number | undefined>
  grid?: { dynamicSimple: number[]; dynamicComposite: number[]; pairCount?: number }
  fixed?: { auto_score_ratio: number; local_embed_min_score: number }
  cases: number
  results: Row[]
}

const root = path.join(import.meta.dir, "..")
const bench = path.join(root, "script/tool-router-dyn-ratio-benchmark.ts")

const cpus = os.cpus().length
const def = Math.min(8, Math.max(1, cpus))
const jobs = Math.max(1, Math.min(64, Number(process.env.BENCHMARK_PARALLEL ?? "") || def))

const children = Array.from({ length: jobs }, (_, shard) =>
  Bun.spawn({
    cmd: ["bun", "run", bench],
    cwd: root,
    env: { ...process.env, BENCHMARK_SHARD: String(shard), BENCHMARK_SHARDS: String(jobs) },
    stdout: "pipe",
    stderr: "pipe",
  }),
)

const merged: Row[] = []
let meta: PartialPayload | null = null
let objective = (process.env.BENCHMARK_OBJECTIVE ?? "exact").trim().toLowerCase() || "exact"

for (let i = 0; i < children.length; i++) {
  const child = children[i]!
  const out = await new Response(child.stdout).text()
  const err = await new Response(child.stderr).text()
  const code = await child.exited
  if (code !== 0) {
    console.error(`shard ${i} exit ${code}\n${err}`)
    process.exit(code ?? 1)
  }
  const data = JSON.parse(out) as PartialPayload | Record<string, unknown>
  if (data && typeof data === "object" && "partial" in data && data.partial && Array.isArray(data.results)) {
    meta = data as PartialPayload
    if (data.objective) objective = String(data.objective)
    merged.push(...data.results)
    continue
  }
  console.error("unexpected shard JSON from child", i)
  process.exit(1)
}

merged.sort((a, b) => compareConfigBenchmark(a.m, b.m, objective))

const best = merged[0]
if (!best) {
  console.error("no results merged")
  process.exit(1)
}

const grid = meta?.grid
const bits = meta?.bits
const label = meta?.label
const baseFlags = meta?.baseFlags
const fixed = meta?.fixed

console.log(
  JSON.stringify(
    {
      parallel: jobs,
      benchmark: "dyn_ratio",
      objective,
      bits,
      label,
      baseFlags,
      grid,
      fixed,
      cases: meta?.cases ?? 0,
      best,
      top10: merged.slice(0, 10).map((r, i) => ({
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
      fullTable: merged.map((r) => ({
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
        note: "exact_match.dynamic_ratio_simple / dynamic_ratio_composite sustituyen 0.97 / 0.74 por defecto.",
      },
      recommendedYaml: {
        "experimental.tool_router.auto_score_ratio": best.auto_score_ratio,
        "experimental.tool_router.local_embed_min_score": best.local_embed_min_score,
        "experimental.tool_router.exact_match": {
          ...best.flags,
          dynamic_ratio_simple: best.dynamic_ratio_simple,
          dynamic_ratio_composite: best.dynamic_ratio_composite,
        },
      },
    },
    null,
    2,
  ),
)
