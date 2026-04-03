/**
 * Offline tool-router evaluation harness (no chat model).
 * Usage: bun run router:eval [--dataset path] [--reviewed] [--expanded] [--mode default|...] [--exposure-mode per_turn_subset|...] [--compare-exposure a b] [--compare a b] [--json-out f] [--limit N] [--verbose] [--breakdown] [--tool-costs] [--tool bash] [--min-pass-rate 0.8] [--fail-on-regression]
 * --reviewed loads test/fixtures/router-eval-reviewed.jsonl (frozen trusted regression gate; **gate** uses --min-pass-rate 1).
 * --expanded loads test/fixtures/router-eval-expanded.jsonl (same as --dataset …/router-eval-expanded.jsonl).
 */
import path from "path"
import { fileURLToPath } from "node:url"
import { readFile, writeFile } from "node:fs/promises"
import { loadRouterEvalJsonl } from "../src/session/router-eval-types"
import {
  accumulateToolMicro,
  aggregateByCategory,
  aggregateBySource,
  aggregateExtrasAnalysis,
  aggregateExtrasCost,
  aggregateGlobal,
  countForbiddenSelections,
  precisionRecall,
  rankWorst,
  rowFailureHint,
  scoreRouterRow,
  type RowEvalResult,
  type ToolMicro,
} from "../src/session/router-eval-score"
import { getToolCostCatalog } from "../src/session/router-eval-tool-cost"
import {
  defaultEvalRouterConfig,
  evalModePatch,
  mergeEvalConfig,
  runRouterEvalCase,
  type EvalModePreset,
} from "../src/session/router-eval-context"
import { normalizeExposureMode } from "../src/session/tool-exposure"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"

const dir = path.dirname(fileURLToPath(import.meta.url))
const defaultDataset = path.join(dir, "../test/fixtures/router-eval.jsonl")
const reviewedDataset = path.join(dir, "../test/fixtures/router-eval-reviewed.jsonl")
const expandedDataset = path.join(dir, "../test/fixtures/router-eval-expanded.jsonl")

function parseArgs(argv: string[]) {
  const o: {
    dataset?: string
    useReviewedDataset: boolean
    useExpandedDataset: boolean
    mode: EvalModePreset
    compare?: [EvalModePreset, EvalModePreset]
    jsonOut?: string
    limit?: number
    verbose: boolean
    tool?: string
    minPassRate: number
    failOnRegression: boolean
    breakdown: boolean
    toolCosts: boolean
    exposureMode?: string
    compareExposure?: [string, string]
  } = {
    mode: "default",
    verbose: false,
    minPassRate: 0,
    failOnRegression: false,
    useReviewedDataset: false,
    useExpandedDataset: false,
    breakdown: false,
    toolCosts: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--reviewed") {
      o.useReviewedDataset = true
      continue
    }
    if (a === "--expanded") {
      o.useExpandedDataset = true
      continue
    }
    if (a === "--dataset" && argv[i + 1]) {
      o.dataset = argv[++i]
      continue
    }
    if (a === "--mode" && argv[i + 1]) {
      o.mode = argv[++i] as EvalModePreset
      continue
    }
    if (a === "--compare" && argv[i + 1] && argv[i + 2]) {
      o.compare = [argv[++i] as EvalModePreset, argv[++i] as EvalModePreset]
      continue
    }
    if (a === "--json-out" && argv[i + 1]) {
      o.jsonOut = argv[++i]
      continue
    }
    if (a === "--limit" && argv[i + 1]) {
      o.limit = Math.max(1, Number(argv[++i]) || 50)
      continue
    }
    if (a === "--verbose") {
      o.verbose = true
      continue
    }
    if (a === "--tool" && argv[i + 1]) {
      o.tool = argv[++i]
      continue
    }
    if (a === "--min-pass-rate" && argv[i + 1]) {
      o.minPassRate = Number(argv[++i]) || 0
      continue
    }
    if (a === "--fail-on-regression") {
      o.failOnRegression = true
      continue
    }
    if (a === "--breakdown") {
      o.breakdown = true
      continue
    }
    if (a === "--tool-costs") {
      o.toolCosts = true
      continue
    }
    if (a === "--exposure-mode" && argv[i + 1]) {
      o.exposureMode = argv[++i]
      continue
    }
    if (a === "--compare-exposure" && argv[i + 1] && argv[i + 2]) {
      o.compareExposure = [argv[++i], argv[++i]]
      continue
    }
  }
  if (o.failOnRegression && o.minPassRate === 0) o.minPassRate = 0.85
  return o
}

function resolveDatasetPath(args: {
  dataset?: string
  useReviewedDataset: boolean
  useExpandedDataset: boolean
}): string {
  if (args.dataset) return path.resolve(args.dataset)
  if (args.useReviewedDataset) return reviewedDataset
  if (args.useExpandedDataset) return expandedDataset
  return defaultDataset
}

function filterByTool<T extends { id: string; available_tools: string[]; required_tools: string[]; forbidden_tools?: string[]; allowed_tools?: string[]; notes?: string }>(
  rows: T[],
  tool: string | undefined,
): T[] {
  if (!tool) return rows
  return rows.filter((r) => {
    if (!r.available_tools.includes(tool)) return false
    const inReq = r.required_tools.includes(tool)
    const inForb = r.forbidden_tools?.includes(tool)
    const inAllow = r.allowed_tools?.includes(tool)
    return inReq || inForb || inAllow || (r.notes?.toLowerCase().includes(tool) ?? false)
  })
}

async function runEval(
  datasetPath: string,
  mode: EvalModePreset,
  limit: number | undefined,
  tool: string | undefined,
  verbose: boolean,
  exposureMode?: string,
): Promise<{
  rows: RowEvalResult[]
  dataset: ReturnType<typeof loadRouterEvalJsonl>
  micro: Map<string, ToolMicro>
  exposureAvgBytes: number
  exposureAvgAttached: number
  exposureAvgRouterSelected: number
}> {
  const raw = await readFile(datasetPath, "utf8")
  let dataset = loadRouterEvalJsonl(raw)
  dataset = filterByTool(dataset, tool)
  if (limit !== undefined) dataset = dataset.slice(0, limit)

  let cfg = mergeEvalConfig(defaultEvalRouterConfig(), evalModePatch(mode))
  if (exposureMode) cfg = mergeEvalConfig(cfg, { exposure_mode: normalizeExposureMode(exposureMode) })
  const results: RowEvalResult[] = []
  const micro = new Map<string, ToolMicro>()
  let sumBytes = 0
  let sumAttached = 0
  let sumRouterSel = 0

  for (const row of dataset) {
    const run = await runRouterEvalCase({
      prompt: row.prompt,
      agent: { name: row.agent, mode: row.agent === "plan" ? "plan" : "primary" },
      available_tools: row.available_tools,
      cfg,
    })
    const ev = scoreRouterRow(row, run.selected, run.context_tier, run.prompt_hint)
    results.push(ev)
    accumulateToolMicro(micro, row, run.selected)
    sumBytes += run.exposure_metrics.approx_attached_tool_bytes
    sumAttached += run.exposure_metrics.attached_after_exposure_count
    sumRouterSel += run.exposure_metrics.router_selected_count
    if (verbose) {
      console.log(
        `${row.id} selected=[${run.selected.join(",")}] tier=${run.context_tier} pass=${ev.pass} exact=${ev.exact} exp_B=${run.exposure_metrics.approx_attached_tool_bytes} exp_n=${run.exposure_metrics.attached_after_exposure_count}`,
      )
    }
  }

  const n = dataset.length || 1
  return {
    rows: results,
    dataset,
    micro,
    exposureAvgBytes: sumBytes / n,
    exposureAvgAttached: sumAttached / n,
    exposureAvgRouterSelected: sumRouterSel / n,
  }
}

function printReport(
  label: string,
  rows: RowEvalResult[],
  dataset: ReturnType<typeof loadRouterEvalJsonl>,
  micro: Map<string, ToolMicro>,
  exposure?: { avgBytes: number; avgAttached: number; avgRouterSel: number },
) {
  const g = aggregateGlobal(rows, dataset)
  console.log(`\n=== ${label} ===`)
  console.log(
    `prompts=${g.total} pass=${g.pass_count} (${(g.pass_rate * 100).toFixed(1)}%) exact=${g.exact_count} (${(g.exact_rate * 100).toFixed(1)}%)`,
  )
  console.log(
    `avg_selected=${g.avg_selected.toFixed(2)} avg_forbidden_sel=${g.avg_forbidden_selected.toFixed(2)} avg_missing_req=${g.avg_missing_required.toFixed(2)} avg_over_sel=${g.avg_over_selection.toFixed(2)}`,
  )
  console.log(`conversation_violations=${g.conversation_violations} missed_all_required_rows=${g.missed_all_required_count}`)
  if (exposure) {
    console.log(
      `exposure_avg_attached_B=${exposure.avgBytes.toFixed(0)} exposure_avg_attached_count=${exposure.avgAttached.toFixed(2)} exposure_avg_router_selected=${exposure.avgRouterSel.toFixed(2)} (offline estimate after tool-exposure hook; pass/fail still from router selection)`,
    )
  }

  const forb = countForbiddenSelections(rows)
  const bucket = (k: string) => forb[k] ?? 0
  console.log(
    `forbidden_fp_buckets: bash=${bucket("bash")} edit=${bucket("edit")} write=${bucket("write")} websearch=${bucket("websearch")} webfetch=${bucket("webfetch")}`,
  )

  console.log("\nPer-tool (micro) precision/recall:")
  const keys = [...micro.keys()].sort()
  for (const t of keys) {
    const m = micro.get(t)!
    if (m.tp + m.fp + m.fn === 0) continue
    const { precision, recall } = precisionRecall(m)
    console.log(`  ${t}: P=${precision.toFixed(2)} R=${recall.toFixed(2)} tp=${m.tp} fp=${m.fp} fn=${m.fn}`)
  }

  const worst = rankWorst(rows, dataset)
  console.log("\nWorst: forbidden count (top)")
  for (const w of worst.by_forbidden.slice(0, 5)) {
    if (w.forbidden_selected.length === 0) break
    console.log(`  ${w.id} forbidden=[${w.forbidden_selected.join(",")}] selected=[${w.selected.join(",")}]`)
  }
  console.log("\nWorst: missing required (top)")
  for (const w of worst.by_missing.slice(0, 5)) {
    if (w.missing_required.length === 0) break
    console.log(`  ${w.id} missing=[${w.missing_required.join(",")}] selected=[${w.selected.join(",")}]`)
  }
  console.log("\nWorst: over-selection (top)")
  for (const w of worst.by_oversel.slice(0, 5)) {
    if (w.over_selection === 0) break
    console.log(`  ${w.id} over=${w.over_selection} selected=[${w.selected.join(",")}]`)
  }
  if (worst.conversation_failures.length) {
    console.log("\nConversation rows with tools:")
    for (const w of worst.conversation_failures) {
      console.log(`  ${w.id} selected=[${w.selected.join(",")}]`)
    }
  }
}

function printCategoryBreakdown(rows: RowEvalResult[], dataset: ReturnType<typeof loadRouterEvalJsonl>) {
  const byCat = aggregateByCategory(rows, dataset)
  console.log("\n=== pass rate by category ===")
  for (const c of byCat) {
    console.log(
      `  ${c.category}: ${c.pass}/${c.total} (${(c.pass_rate * 100).toFixed(1)}%) conv_viol=${c.conversation_violations} avg_fb=${c.avg_forbidden.toFixed(2)} avg_miss=${c.avg_missing.toFixed(2)}`,
    )
  }
}

function printSourceBreakdown(rows: RowEvalResult[], dataset: ReturnType<typeof loadRouterEvalJsonl>) {
  const bySrc = aggregateBySource(rows, dataset)
  console.log("\n=== pass rate by source ===")
  for (const s of bySrc) {
    console.log(
      `  ${s.source}: ${s.pass}/${s.total} (${(s.pass_rate * 100).toFixed(1)}%) conv_viol=${s.conversation_violations} avg_over=${s.avg_over_selection.toFixed(2)} avg_fb=${s.avg_forbidden.toFixed(2)} avg_miss=${s.avg_missing.toFixed(2)}`,
    )
  }
}

function printExtrasAnalysis(rows: RowEvalResult[], dataset: ReturnType<typeof loadRouterEvalJsonl>) {
  const x = aggregateExtrasAnalysis(rows, dataset)
  console.log("\n=== extras / minimality (non-conversation rows) ===")
  console.log(
    `  rows=${x.non_conversation_rows} with_extras=${x.rows_with_extras} (${x.non_conversation_rows === 0 ? "0.0" : ((x.rows_with_extras / x.non_conversation_rows) * 100).toFixed(1)}%) avg_extras/row=${x.avg_extras_per_row.toFixed(2)}`,
  )
  console.log(
    `  on_pass_rows: n=${x.pass_non_conversation} avg_extras=${x.avg_extras_on_pass.toFixed(2)} (extras = tools outside required ∪ allowed; high pass rate can coexist with many extras)`,
  )
  console.log("  extras_histogram (count of extra tools → rows):")
  for (const h of x.extras_histogram) {
    console.log(`    ${h.extras_count}: ${h.rows}`)
  }
  console.log("  top extras by tool id (frequency as non-required extra):")
  for (const t of x.extras_by_tool.slice(0, 14)) {
    console.log(`    ${t.tool}: ${t.count}`)
  }
  if (x.extras_by_tool.length > 14) console.log(`    … (${x.extras_by_tool.length} tools total)`)
}

function printToolCostCatalog() {
  const cat = getToolCostCatalog()
  console.log("\n=== canonical tool definition cost (offline estimate) ===")
  console.log(
    "  Method: UTF-8 bytes of description (.txt) + JSON Schema bytes from z.toJSONSchema(parameters). Token estimate: ceil(total_bytes/4). See router-eval-tool-cost.ts for caveats (task/skill dynamic text).",
  )
  console.log("\n  id                          desc_B  schema_B  total_B  tok~  rank  bucket")
  for (const t of cat) {
    const id = t.id.padEnd(26)
    console.log(
      `  ${id} ${String(t.description_utf8_bytes).padStart(7)} ${String(t.schema_json_bytes).padStart(9)} ${String(t.total_est_bytes).padStart(8)} ${String(t.total_est_tokens).padStart(5)} ${String(t.cost_rank).padStart(5)}  ${t.bucket}`,
    )
    if (t.notes) console.log(`      (${t.notes})`)
  }
}

function printToolCostSummary() {
  const cat = getToolCostCatalog()
  console.log("\n=== tool definition cost — top 5 (by total estimated bytes) ===")
  console.log("  (full table: bun run router:eval:tool-costs)")
  for (const t of cat.slice(0, 5)) {
    console.log(`  ${t.id}: ${t.total_est_bytes} B (~${t.total_est_tokens} tok) bucket=${t.bucket}`)
  }
}

function printExtrasCostReport(rows: RowEvalResult[], dataset: ReturnType<typeof loadRouterEvalJsonl>) {
  const c = aggregateExtrasCost(rows, dataset)
  console.log("\n=== extras — estimated definition cost (sum of extra tool rows) ===")
  console.log(
    `  non_conversation_rows=${c.rows_non_conversation} pass_nc=${c.pass_non_conversation} total_extra_bytes_summed=${c.total_extra_bytes_summed} avg_extra_B/row=${c.avg_extra_bytes_per_row.toFixed(0)} avg_extra_B/pass_row=${c.avg_extra_bytes_on_pass_rows.toFixed(0)}`,
  )
  console.log("  extras by bucket (occurrence × tool definition tier):")
  for (const b of c.by_bucket) {
    if (b.occurrences === 0) continue
    console.log(`    ${b.bucket}: occurrences=${b.occurrences} total_bytes=${b.total_bytes}`)
  }
  console.log("  top extra tools by total contributed bytes (not frequency):")
  for (const t of c.extra_tool_by_cost.slice(0, 12)) {
    console.log(
      `    ${t.tool}: total_B=${t.total_bytes} n=${t.occurrences} avg_B=${t.avg_bytes.toFixed(0)} bucket=${t.bucket}`,
    )
  }
}

function printFailedBreakdown(rows: RowEvalResult[], dataset: ReturnType<typeof loadRouterEvalJsonl>, limit: number) {
  const byId = new Map(dataset.map((r) => [r.id, r]))
  const fails = rows.filter((r) => !r.pass)
  if (fails.length === 0) return
  console.log(`\n=== ${Math.min(limit, fails.length)} failing rows (hint) ===`)
  for (const ev of fails.slice(0, limit)) {
    const row = byId.get(ev.id)
    if (!row) continue
    const cat = row.category ?? "?"
    console.log(
      `  ${ev.id} [${cat}] ${rowFailureHint(row, ev)} selected=[${ev.selected.join(",")}] tier=${ev.context_tier}`,
    )
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.toolCosts) {
    printToolCostCatalog()
    return 0
  }
  const datasetPath = resolveDatasetPath(args)
  if (args.verbose && args.useReviewedDataset) console.error(`Dataset (reviewed gate): ${datasetPath}`)
  if (args.verbose && args.useExpandedDataset) console.error(`Dataset (expanded): ${datasetPath}`)

  if (args.compareExposure) {
    const [e1, e2] = args.compareExposure
    const r1 = await runEval(datasetPath, args.mode, args.limit, args.tool, args.verbose, e1)
    printReport(`mode=${args.mode} exposure=${normalizeExposureMode(e1)}`, r1.rows, r1.dataset, r1.micro, {
      avgBytes: r1.exposureAvgBytes,
      avgAttached: r1.exposureAvgAttached,
      avgRouterSel: r1.exposureAvgRouterSelected,
    })
    const r2 = await runEval(datasetPath, args.mode, args.limit, args.tool, args.verbose, e2)
    printReport(`mode=${args.mode} exposure=${normalizeExposureMode(e2)}`, r2.rows, r2.dataset, r2.micro, {
      avgBytes: r2.exposureAvgBytes,
      avgAttached: r2.exposureAvgAttached,
      avgRouterSel: r2.exposureAvgRouterSelected,
    })
    const g1 = aggregateGlobal(r1.rows, r1.dataset)
    const g2 = aggregateGlobal(r2.rows, r2.dataset)
    console.log("\n=== delta pass_rate (router; unchanged by exposure hook) ===")
    console.log(
      `${e1} ${(g1.pass_rate * 100).toFixed(1)}% vs ${e2} ${(g2.pass_rate * 100).toFixed(1)}% (${((g2.pass_rate - g1.pass_rate) * 100).toFixed(1)} pp)`,
    )
    console.log("\n=== delta exposure_avg_attached_B ===")
    console.log(`${e1} ${r1.exposureAvgBytes.toFixed(0)} vs ${e2} ${r2.exposureAvgBytes.toFixed(0)} (${(r2.exposureAvgBytes - r1.exposureAvgBytes).toFixed(0)} B)`)
    const g = g2
    if (args.minPassRate > 0 && g.pass_rate < args.minPassRate) {
      console.error(`\nFAIL: pass_rate ${(g.pass_rate * 100).toFixed(1)}% < min ${(args.minPassRate * 100).toFixed(1)}% (second exposure mode)`)
      return 1
    }
    return 0
  }

  if (args.compare) {
    const [a, b] = args.compare
    const r1 = await runEval(datasetPath, a, args.limit, args.tool, args.verbose, args.exposureMode)
    printReport(`mode=${a}`, r1.rows, r1.dataset, r1.micro, {
      avgBytes: r1.exposureAvgBytes,
      avgAttached: r1.exposureAvgAttached,
      avgRouterSel: r1.exposureAvgRouterSelected,
    })
    const r2 = await runEval(datasetPath, b, args.limit, args.tool, args.verbose, args.exposureMode)
    printReport(`mode=${b}`, r2.rows, r2.dataset, r2.micro, {
      avgBytes: r2.exposureAvgBytes,
      avgAttached: r2.exposureAvgAttached,
      avgRouterSel: r2.exposureAvgRouterSelected,
    })
    const g1 = aggregateGlobal(r1.rows, r1.dataset)
    const g2 = aggregateGlobal(r2.rows, r2.dataset)
    console.log("\n=== delta pass_rate ===")
    console.log(
      `${a} ${(g1.pass_rate * 100).toFixed(1)}% vs ${b} ${(g2.pass_rate * 100).toFixed(1)}% (${((g2.pass_rate - g1.pass_rate) * 100).toFixed(1)} pp)`,
    )
    const g = g2
    if (args.minPassRate > 0 && g.pass_rate < args.minPassRate) {
      console.error(`\nFAIL: pass_rate ${(g.pass_rate * 100).toFixed(1)}% < min ${(args.minPassRate * 100).toFixed(1)}% (second mode)`)
      return 1
    }
    return 0
  }

  const r = await runEval(datasetPath, args.mode, args.limit, args.tool, args.verbose, args.exposureMode)
  printReport(`mode=${args.mode}`, r.rows, r.dataset, r.micro, {
    avgBytes: r.exposureAvgBytes,
    avgAttached: r.exposureAvgAttached,
    avgRouterSel: r.exposureAvgRouterSelected,
  })
  if (args.breakdown) {
    printCategoryBreakdown(r.rows, r.dataset)
    printSourceBreakdown(r.rows, r.dataset)
    printExtrasAnalysis(r.rows, r.dataset)
    printToolCostSummary()
    printExtrasCostReport(r.rows, r.dataset)
    printFailedBreakdown(r.rows, r.dataset, 24)
  }
  if (args.jsonOut) {
    const payload = {
      mode: args.mode,
      exposure_mode: args.exposureMode ? normalizeExposureMode(args.exposureMode) : "per_turn_subset",
      exposure_aggregate: {
        avg_attached_bytes: r.exposureAvgBytes,
        avg_attached_count: r.exposureAvgAttached,
        avg_router_selected: r.exposureAvgRouterSelected,
      },
      global: aggregateGlobal(r.rows, r.dataset),
      by_category: aggregateByCategory(r.rows, r.dataset),
      by_source: aggregateBySource(r.rows, r.dataset),
      extras_analysis: aggregateExtrasAnalysis(r.rows, r.dataset),
      extras_cost: aggregateExtrasCost(r.rows, r.dataset),
      tool_cost_catalog: getToolCostCatalog(),
      rows: r.rows,
      micro: Object.fromEntries([...r.micro.entries()].map(([k, v]) => [k, v])),
    }
    await writeFile(path.resolve(args.jsonOut), JSON.stringify(payload, null, 2), "utf8")
    console.log(`\nWrote ${args.jsonOut}`)
  }
  const g = aggregateGlobal(r.rows, r.dataset)
  if (args.minPassRate > 0 && g.pass_rate < args.minPassRate) {
    console.error(`\nFAIL: pass_rate ${(g.pass_rate * 100).toFixed(1)}% < min ${(args.minPassRate * 100).toFixed(1)}%`)
    return 1
  }
  return 0
}

main()
  .then((code) => {
    shutdownRouterEmbedIpc()
    process.exit(code ?? 0)
  })
  .catch((e) => {
    console.error(e)
    shutdownRouterEmbedIpc()
    process.exit(1)
  })
