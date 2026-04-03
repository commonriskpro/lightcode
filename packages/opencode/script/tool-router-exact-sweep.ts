/**
 * Grid over 2^6 exact_match flags vs same prompts.
 *
 * Métricas:
 *   - exactRate: mismo conjunto que el oráculo (muy estricto).
 *   - fullCoverageRate: cada id oráculo ⊆ predicho (extras OK). Objetivo producto suele ser ≥80% aquí.
 *
 * Ranking: SWEEP_RANK=full (default) prioriza fullCoverageRate; strict prioriza exactRate.
 *
 * Single process:
 *   CASES=300 bun run script/tool-router-exact-sweep.ts
 *
 * Sharded:
 *   SWEEP_SHARD=0 SWEEP_SHARDS=8 CASES=300 bun run script/tool-router-exact-sweep.ts
 *
 * Parallel:
 *   SWEEP_PARALLEL=8 CASES=300 bun run script/tool-router-exact-sweep-parallel.ts
 *
 * Config grid (ratio × min_score):
 *   bun run script/tool-router-config-benchmark.ts
 *
 * Fallos exact (missing/extra por prompt):
 *   bun run script/tool-router-exact-failures.ts
 *
 * Benchmark sin intent embed por defecto; con intent (como antes): OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0
 *
 * Fijar ratio/min del grid de config (opcional):
 *   AUTO_SCORE_RATIO=0.88 LOCAL_EMBED_MIN_SCORE=0.32
 *
 * Fijar multiplicadores dynamic_ratio (opcional; barrido solo de bits):
 *   DYNAMIC_RATIO_SIMPLE=0.97 DYNAMIC_RATIO_COMPOSITE=0.74
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
  compareSweepRank,
  labelBits,
  metrics,
  msg,
  oneCase,
  tools,
} from "./tool-router-benchmark-shared"

const cases = Math.min(500, Math.max(1, Number(process.env.CASES ?? "300") || 300))
const rows = oneCase(process.env.CASE_INDEX, buildRows(cases))

const shards = Math.max(1, Math.min(64, Number(process.env.SWEEP_SHARDS ?? "1") || 1))
const shard = Math.max(0, Math.min(shards - 1, Number(process.env.SWEEP_SHARD ?? "0") || 0))

function bitRange(s: number, n: number) {
  const start = Math.floor((64 * s) / n)
  const end = Math.floor((64 * (s + 1)) / n)
  return { start, end }
}

const { start: bitsStart, end: bitsEnd } = bitRange(shard, shards)

const ratio = benchEnvNum("AUTO_SCORE_RATIO")
const min = benchEnvNum("LOCAL_EMBED_MIN_SCORE")
const topK = benchEnvNum("LOCAL_EMBED_TOP_K")
const dynS = benchEnvNum("DYNAMIC_RATIO_SIMPLE")
const dynC = benchEnvNum("DYNAMIC_RATIO_COMPOSITE")

function exactForBits(bits: number): ExactMatchFlags {
  const f = comboFromBits(bits)
  return {
    ...f,
    ...(dynS !== undefined ? { dynamic_ratio_simple: dynS } : {}),
    ...(dynC !== undefined ? { dynamic_ratio_composite: dynC } : {}),
  }
}

const results: {
  bits: number
  label: string
  flags: ExactMatchFlags
  m: ReturnType<typeof metrics>
}[] = []

for (let bits = bitsStart; bits < bitsEnd; bits++) {
  const exact = exactForBits(bits)
  const out: { expect: string[]; got: string[] }[] = []
  for (const row of rows) {
    const ret = await ToolRouter.apply({
      tools: tools as any,
      messages: msg(row.text) as any,
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg({
        exact,
        ...(ratio !== undefined ? { auto_score_ratio: ratio } : {}),
        ...(min !== undefined ? { local_embed_min_score: min } : {}),
        ...(topK !== undefined ? { local_embed_top_k: topK } : {}),
      }) as any,
      mcpIds: new Set(),
      skip: false,
    })
    out.push({ expect: row.expect, got: Object.keys(ret.tools).sort() })
  }
  results.push({ bits, label: labelBits(bits), flags: exact, m: metrics(out) })
}

const rank = (process.env.SWEEP_RANK ?? "full").trim().toLowerCase() === "strict" ? "strict" : "full"
results.sort((a, b) => compareSweepRank(a.m, b.m, rank))

const numericOverrides = {
  auto_score_ratio: ratio,
  local_embed_min_score: min,
  local_embed_top_k: topK,
  dynamic_ratio_simple: dynS,
  dynamic_ratio_composite: dynC,
}

const partial = shards > 1
const payload = partial
  ? {
      partial: true as const,
      shard,
      shards,
      bitsRange: { start: bitsStart, end: bitsEnd },
      cases: rows.length,
      numericOverrides,
      selectedCase: process.env.CASE_INDEX
        ? { index: caseIndex(process.env.CASE_INDEX), prompt: rows[0]?.text ?? "" }
        : undefined,
      results,
    }
  : {
      cases: rows.length,
      combos: 64,
      rankMode: rank,
      numericOverrides,
      productTarget: {
        fullCoveragePctGoal: 80,
        note: "Medir éxito principalmente con fullCoverageRate (oráculo ⊆ predicho). exactRate penaliza extras.",
      },
      selectedCase: process.env.CASE_INDEX
        ? { index: caseIndex(process.env.CASE_INDEX), prompt: rows[0]?.text ?? "" }
        : undefined,
      best: results[0],
      top10: results.slice(0, 10).map((r, i) => ({
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
      fullTable: results.map((r) => ({
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
    }

console.log(JSON.stringify(payload, null, 2))
shutdownRouterEmbedIpc()
