/**
 * Spawns N Bun processes (each with its own embed IPC worker), merges shard JSON.
 *
 *   SWEEP_PARALLEL=8 CASES=300 bun run script/tool-router-exact-sweep-parallel.ts
 *
 * Ranking: SWEEP_RANK=full|strict (default full — prioriza fullCoverageRate, oráculo ⊆ predicho).
 *
 * Sin intent embed por defecto; con intent: OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0
 *
 * Fijar ratio/min (opcional): AUTO_SCORE_RATIO=0.88 LOCAL_EMBED_MIN_SCORE=0.32
 *
 * Fijar dynamic_ratio_* en todo el sweep (opcional):
 *   DYNAMIC_RATIO_SIMPLE=0.97 DYNAMIC_RATIO_COMPOSITE=0.74
 *
 * Default job count: min(8, CPU count). Max 64 (one shard per combo bucket edge case).
 */
import os from "node:os"
import path from "node:path"
import { benchEnvNum, compareSweepRank } from "./tool-router-benchmark-shared"

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
  bits: number
  label: string
  flags: Record<string, boolean>
  m: M
}

type PartialPayload = {
  partial: true
  shard: number
  shards: number
  bitsRange: { start: number; end: number }
  cases: number
  results: Row[]
}

type FullPayload = {
  cases: number
  combos: number
  best: Row
  top10: unknown[]
  fullTable: unknown[]
}

const root = path.join(import.meta.dir, "..")
const sweep = path.join(root, "script/tool-router-exact-sweep.ts")

const cpus = os.cpus().length
const def = Math.min(8, Math.max(1, cpus))
const jobs = Math.max(1, Math.min(64, Number(process.env.SWEEP_PARALLEL ?? "") || def))

const rank = (process.env.SWEEP_RANK ?? "full").trim().toLowerCase() === "strict" ? "strict" : "full"
function sortResults(a: Row, b: Row) {
  return compareSweepRank(a.m, b.m, rank)
}

const children = Array.from({ length: jobs }, (_, shard) =>
  Bun.spawn({
    cmd: ["bun", "run", sweep],
    cwd: root,
    env: { ...process.env, SWEEP_SHARD: String(shard), SWEEP_SHARDS: String(jobs) },
    stdout: "pipe",
    stderr: "pipe",
  }),
)

const merged: Row[] = []
let cases = 0

for (let i = 0; i < children.length; i++) {
  const child = children[i]!
  const out = await new Response(child.stdout).text()
  const err = await new Response(child.stderr).text()
  const code = await child.exited
  if (code !== 0) {
    console.error(`shard ${i} exit ${code}\n${err}`)
    process.exit(code ?? 1)
  }
  const data = JSON.parse(out) as PartialPayload | FullPayload
  if (data && typeof data === "object" && "partial" in data && data.partial && Array.isArray(data.results)) {
    cases = data.cases
    merged.push(...data.results)
    continue
  }
  if (data && typeof data === "object" && "fullTable" in data && Array.isArray(data.fullTable)) {
    console.log(JSON.stringify({ parallel: jobs, ...(data as FullPayload) }, null, 2))
    process.exit(0)
  }
  console.error("unexpected shard JSON from child", i)
  process.exit(1)
}

merged.sort(sortResults)

const best = merged[0]
if (!best) {
  console.error("no results merged")
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      parallel: jobs,
      cases,
      combos: 64,
      rankMode: rank,
      numericOverrides: {
        auto_score_ratio: benchEnvNum("AUTO_SCORE_RATIO"),
        local_embed_min_score: benchEnvNum("LOCAL_EMBED_MIN_SCORE"),
        local_embed_top_k: benchEnvNum("LOCAL_EMBED_TOP_K"),
        dynamic_ratio_simple: benchEnvNum("DYNAMIC_RATIO_SIMPLE"),
        dynamic_ratio_composite: benchEnvNum("DYNAMIC_RATIO_COMPOSITE"),
      },
      productTarget: {
        fullCoveragePctGoal: 80,
        note: "Éxito principal: fullCoverageRate (cada herramienta oráculo en la predicción; extras OK). exactRate exige conjunto idéntico.",
      },
      best,
      top10: merged.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        bits: r.bits,
        label: r.label,
        flags: r.flags,
        exact: r.m.exact,
        exactRate: r.m.exactRate,
        fullCoverage: r.m.fullCoverage,
        fullCoverageRate: r.m.fullCoverageRate,
        f1: r.m.f1,
        precision: r.m.precision,
        recall: r.m.recall,
      })),
      fullTable: merged.map((r) => ({
        bits: r.bits,
        label: r.label,
        exact: r.m.exact,
        exactRate: r.m.exactRate,
        fullCoverage: r.m.fullCoverage,
        fullCoverageRate: r.m.fullCoverageRate,
        f1: r.m.f1,
        precision: r.m.precision,
        recall: r.m.recall,
      })),
    },
    null,
    2,
  ),
)
