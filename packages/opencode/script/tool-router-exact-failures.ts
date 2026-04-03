/**
 * Lista cada caso del benchmark donde el conjunto predicho ≠ oráculo (exact match falla).
 * Útil para tunear Xenova: ves missing (FN) vs extra (FP) por prompt.
 *
 *   CASES=100 SWEEP_FLAGS_BITS=19 bun run script/tool-router-exact-failures.ts
 *
 * Overrides opcionales (mismos nombres que el grid de config):
 *   AUTO_SCORE_RATIO=0.9 LOCAL_EMBED_MIN_SCORE=0.34 LOCAL_EMBED_TOP_K=4
 *   DYNAMIC_RATIO_SIMPLE=0.97 DYNAMIC_RATIO_COMPOSITE=0.74
 *
 * Un solo caso:
 *   CASE_INDEX=5 CASES=100 bun run script/tool-router-exact-failures.ts
 *
 * Tops en aggregate (opcional): AGGREGATE_TOP=12
 *
 * Salida: JSON con summary, aggregate (conteos missing/extra por tipo y tops por tool id), failures[].
 *
 * Sin intent embed por defecto; con intent: OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT=0
 */
import { ToolRouter } from "../src/session/tool-router"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"
import {
  baseCfg,
  benchEnvNum,
  benchmarkLocalIntentEmbedEnabled,
  buildRows,
  caseIndex,
  comboFromBits,
  labelBits,
  metrics,
  msg,
  oneCase,
  tools,
} from "./tool-router-benchmark-shared"

function diff(expect: string[], got: string[]) {
  const a = new Set(expect)
  const b = new Set(got)
  return {
    missing: [...a].filter((id) => !b.has(id)).sort(),
    extra: [...b].filter((id) => !a.has(id)).sort(),
  }
}

function exactEqual(expect: string[], got: string[]) {
  if (expect.length !== got.length) return false
  const s = new Set(got)
  return expect.every((id) => s.has(id))
}

function aggregate(
  rows: { missing: string[]; extra: string[] }[],
  top: number,
) {
  let missOnly = 0
  let extraOnly = 0
  let both = 0
  let missRefs = 0
  let extraRefs = 0
  const missT: Record<string, number> = {}
  const extraT: Record<string, number> = {}
  for (const r of rows) {
    const hm = r.missing.length > 0
    const he = r.extra.length > 0
    if (hm && he) both++
    if (hm && !he) missOnly++
    if (he && !hm) extraOnly++
    for (const id of r.missing) {
      missRefs++
      missT[id] = (missT[id] ?? 0) + 1
    }
    for (const id of r.extra) {
      extraRefs++
      extraT[id] = (extraT[id] ?? 0) + 1
    }
  }
  const pick = (t: Record<string, number>) =>
    Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, top))
  return {
    failureKind: { missingOnly: missOnly, extraOnly: extraOnly, missingAndExtra: both },
    toolRefTotals: { missing: missRefs, extra: extraRefs },
    topMissing: pick(missT),
    topExtra: pick(extraT),
  }
}

const cases = Math.min(500, Math.max(1, Number(process.env.CASES ?? "300") || 300))
const rows = oneCase(process.env.CASE_INDEX, buildRows(cases))
const bits = Math.max(0, Math.min(63, Number(process.env.SWEEP_FLAGS_BITS ?? "19") || 19))
const flags = comboFromBits(bits)
const label = labelBits(bits)

const ratio = benchEnvNum("AUTO_SCORE_RATIO")
const min = benchEnvNum("LOCAL_EMBED_MIN_SCORE")
const topK = benchEnvNum("LOCAL_EMBED_TOP_K")
const dynS = benchEnvNum("DYNAMIC_RATIO_SIMPLE")
const dynC = benchEnvNum("DYNAMIC_RATIO_COMPOSITE")

const cfg = baseCfg({
  exact: flags,
  ...(ratio !== undefined ? { auto_score_ratio: ratio } : {}),
  ...(min !== undefined ? { local_embed_min_score: min } : {}),
  ...(topK !== undefined ? { local_embed_top_k: topK } : {}),
  ...(dynS !== undefined ? { dynamic_ratio_simple: dynS } : {}),
  ...(dynC !== undefined ? { dynamic_ratio_composite: dynC } : {}),
})

const out: { expect: string[]; got: string[] }[] = []
const failures: {
  index: number
  text: string
  expect: string[]
  got: string[]
  missing: string[]
  extra: string[]
}[] = []

let i = 0
for (const row of rows) {
  i++
  const ret = await ToolRouter.apply({
    tools: tools as any,
    messages: msg(row.text) as any,
    agent: { name: "build", mode: "primary" },
    cfg: cfg as any,
    mcpIds: new Set(),
    skip: false,
  })
  const got = Object.keys(ret.tools).sort()
  out.push({ expect: row.expect, got })
  if (!exactEqual(row.expect, got)) {
    const d = diff(row.expect, got)
    failures.push({
      index: i,
      text: row.text,
      expect: [...row.expect].sort(),
      got,
      missing: d.missing,
      extra: d.extra,
    })
  }
}

const m = metrics(out)
const top = Math.max(1, Math.min(64, Number(process.env.AGGREGATE_TOP ?? "12") || 12))

console.log(
  JSON.stringify(
    {
      script: "tool-router-exact-failures",
      cases: rows.length,
      bits,
      label,
      flags,
      benchmark: {
        local_intent_embed: benchmarkLocalIntentEmbedEnabled(),
        no_intent_env: process.env.OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT ?? "(unset = off)",
      },
      cfgOverrides: {
        auto_score_ratio: ratio,
        local_embed_min_score: min,
        local_embed_top_k: topK,
        dynamic_ratio_simple: dynS,
        dynamic_ratio_composite: dynC,
      },
      selectedCase: process.env.CASE_INDEX
        ? { index: caseIndex(process.env.CASE_INDEX), prompt: rows[0]?.text ?? "" }
        : undefined,
      summary: {
        exact: m.exact,
        exactRate: m.exactRate,
        fullCoverage: m.fullCoverage,
        fullCoverageRate: m.fullCoverageRate,
        f1: m.f1,
        precision: m.precision,
        recall: m.recall,
        failCount: failures.length,
      },
      aggregate: aggregate(failures, top),
      failures,
    },
    null,
    2,
  ),
)

shutdownRouterEmbedIpc()
