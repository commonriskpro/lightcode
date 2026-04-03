import type { RouterEvalRow, RouterEvalSource } from "./router-eval-types"
import { costForToolId, type ToolCostBucket } from "./router-eval-tool-cost"

export type RowEvalResult = {
  id: string
  selected: string[]
  context_tier: string
  prompt_hint_preview?: string
  pass: boolean
  exact: boolean
  missing_required: string[]
  forbidden_selected: string[]
  extras: string[]
  over_selection: number
  under_selection: number
  conversation_tool_violation: boolean
}

export function scoreRouterRow(
  row: RouterEvalRow,
  selected: string[],
  contextTier: string,
  promptHint?: string,
): RowEvalResult {
  const req = new Set(row.required_tools)
  const forb = new Set(row.forbidden_tools ?? [])
  const allow = new Set(row.allowed_tools ?? [])
  const sel = new Set(selected.filter((id) => row.available_tools.includes(id)))

  if (row.expect_conversation) {
    const pass = sel.size === 0
    return {
      id: row.id,
      selected: [...sel].sort(),
      context_tier: contextTier,
      prompt_hint_preview: promptHint ? promptHint.slice(0, 200) : undefined,
      pass,
      exact: pass,
      missing_required: [],
      forbidden_selected: [],
      extras: [...sel],
      over_selection: sel.size,
      under_selection: 0,
      conversation_tool_violation: !pass,
    }
  }

  const missing_required = [...req].filter((id) => !sel.has(id))
  const forbidden_selected = [...forb].filter((id) => sel.has(id))
  const allowedUnion = new Set([...req, ...allow])
  const extras = [...sel].filter((id) => !allowedUnion.has(id))

  const idealMin = req.size
  const over_selection = Math.max(0, sel.size - idealMin)
  const under_selection = missing_required.length

  const pass = missing_required.length === 0 && forbidden_selected.length === 0
  const exact = pass && extras.length === 0

  return {
    id: row.id,
    selected: [...sel].sort(),
    context_tier: contextTier,
    prompt_hint_preview: promptHint ? promptHint.slice(0, 200) : undefined,
    pass,
    exact,
    missing_required,
    forbidden_selected,
    extras,
    over_selection,
    under_selection,
    conversation_tool_violation: false,
  }
}

export type ToolMicro = {
  tp: number
  fp: number
  fn: number
}

export function emptyToolMicro(): ToolMicro {
  return { tp: 0, fp: 0, fn: 0 }
}

export function accumulateToolMicro(acc: Map<string, ToolMicro>, row: RouterEvalRow, selected: string[]) {
  if (row.expect_conversation) {
    for (const t of row.available_tools) {
      if (!acc.has(t)) acc.set(t, emptyToolMicro())
      const m = acc.get(t)!
      if (selected.includes(t)) m.fp++
    }
    return
  }

  const req = new Set(row.required_tools)
  const forb = new Set(row.forbidden_tools ?? [])
  const allow = new Set(row.allowed_tools ?? [])
  const sel = new Set(selected)

  for (const t of row.available_tools) {
    if (!acc.has(t)) acc.set(t, emptyToolMicro())
    const m = acc.get(t)!
    const has = sel.has(t)
    if (req.has(t)) {
      if (has) m.tp++
      else m.fn++
    } else if (forb.has(t)) {
      if (has) m.fp++
    } else if (allow.has(t)) {
      if (has) m.tp++
    } else {
      if (has) m.fp++
    }
  }
}

export function precisionRecall(m: ToolMicro): { precision: number; recall: number } {
  const p = m.tp + m.fp === 0 ? 1 : m.tp / (m.tp + m.fp)
  const r = m.tp + m.fn === 0 ? 1 : m.tp / (m.tp + m.fn)
  return { precision: p, recall: r }
}

export type GlobalMetrics = {
  total: number
  pass_count: number
  exact_count: number
  pass_rate: number
  exact_rate: number
  avg_selected: number
  avg_forbidden_selected: number
  avg_missing_required: number
  avg_over_selection: number
  conversation_violations: number
  missed_all_required_count: number
}

export function aggregateGlobal(rows: RowEvalResult[], dataset: RouterEvalRow[]): GlobalMetrics {
  const n = rows.length
  if (n === 0) {
    return {
      total: 0,
      pass_count: 0,
      exact_count: 0,
      pass_rate: 0,
      exact_rate: 0,
      avg_selected: 0,
      avg_forbidden_selected: 0,
      avg_missing_required: 0,
      avg_over_selection: 0,
      conversation_violations: 0,
      missed_all_required_count: 0,
    }
  }
  let pass = 0
  let exact = 0
  let sumSel = 0
  let sumFb = 0
  let sumMiss = 0
  let sumOver = 0
  let convViol = 0
  let missedAll = 0
  const byId = new Map(dataset.map((r) => [r.id, r]))
  for (const r of rows) {
    if (r.pass) pass++
    if (r.exact) exact++
    sumSel += r.selected.length
    sumFb += r.forbidden_selected.length
    sumMiss += r.missing_required.length
    sumOver += r.over_selection
    if (r.conversation_tool_violation) convViol++
    const row = byId.get(r.id)
    if (row && missedAllRequired(row, r)) missedAll++
  }
  return {
    total: n,
    pass_count: pass,
    exact_count: exact,
    pass_rate: pass / n,
    exact_rate: exact / n,
    avg_selected: sumSel / n,
    avg_forbidden_selected: sumFb / n,
    avg_missing_required: sumMiss / n,
    avg_over_selection: sumOver / n,
    conversation_violations: convViol,
    missed_all_required_count: missedAll,
  }
}

export function missedAllRequired(row: RouterEvalRow, r: RowEvalResult): boolean {
  if (row.expect_conversation) return false
  return row.required_tools.length > 0 && r.missing_required.length === row.required_tools.length
}

/** Count selections of forbidden tools by id (for summary buckets). */
export function countForbiddenSelections(rows: RowEvalResult[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const r of rows) {
    for (const t of r.forbidden_selected) {
      c[t] = (c[t] ?? 0) + 1
    }
  }
  return c
}

export type CategoryAggregate = {
  category: string
  total: number
  pass: number
  pass_rate: number
  conversation_violations: number
  avg_forbidden: number
  avg_missing: number
}

/** Group pass/fail by `row.category` (falls back to "uncategorized"). */
export function aggregateByCategory(rows: RowEvalResult[], dataset: RouterEvalRow[]): CategoryAggregate[] {
  const byId = new Map(dataset.map((r) => [r.id, r]))
  const buckets = new Map<
    string,
    { n: number; pass: number; conv: number; sumFb: number; sumMiss: number }
  >()
  for (const ev of rows) {
    const row = byId.get(ev.id)
    const cat = row?.category?.trim() || "uncategorized"
    if (!buckets.has(cat)) buckets.set(cat, { n: 0, pass: 0, conv: 0, sumFb: 0, sumMiss: 0 })
    const b = buckets.get(cat)!
    b.n++
    if (ev.pass) b.pass++
    if (ev.conversation_tool_violation) b.conv++
    b.sumFb += ev.forbidden_selected.length
    b.sumMiss += ev.missing_required.length
  }
  return [...buckets.entries()]
    .map(([category, b]) => ({
      category,
      total: b.n,
      pass: b.pass,
      pass_rate: b.n === 0 ? 0 : b.pass / b.n,
      conversation_violations: b.conv,
      avg_forbidden: b.n === 0 ? 0 : b.sumFb / b.n,
      avg_missing: b.n === 0 ? 0 : b.sumMiss / b.n,
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

export type SourceAggregate = {
  source: RouterEvalSource | "unknown"
  total: number
  pass: number
  pass_rate: number
  conversation_violations: number
  avg_forbidden: number
  avg_missing: number
  avg_over_selection: number
}

/** Group pass/fail by `row.source` (falls back to `unknown`). */
export function aggregateBySource(rows: RowEvalResult[], dataset: RouterEvalRow[]): SourceAggregate[] {
  const byId = new Map(dataset.map((r) => [r.id, r]))
  const buckets = new Map<
    string,
    { n: number; pass: number; conv: number; sumFb: number; sumMiss: number; sumOver: number }
  >()
  for (const ev of rows) {
    const row = byId.get(ev.id)
    const key = (row?.source ?? "unknown") as string
    if (!buckets.has(key)) buckets.set(key, { n: 0, pass: 0, conv: 0, sumFb: 0, sumMiss: 0, sumOver: 0 })
    const b = buckets.get(key)!
    b.n++
    if (ev.pass) b.pass++
    if (ev.conversation_tool_violation) b.conv++
    b.sumFb += ev.forbidden_selected.length
    b.sumMiss += ev.missing_required.length
    b.sumOver += ev.over_selection
  }
  const order = (s: string) =>
    s === "seed" ? 0 : s === "synthetic" ? 1 : s === "sampled_heuristic" ? 2 : s === "unknown" ? 4 : 3
  return [...buckets.entries()]
    .map(([source, b]) => ({
      source: source as SourceAggregate["source"],
      total: b.n,
      pass: b.pass,
      pass_rate: b.n === 0 ? 0 : b.pass / b.n,
      conversation_violations: b.conv,
      avg_forbidden: b.n === 0 ? 0 : b.sumFb / b.n,
      avg_missing: b.n === 0 ? 0 : b.sumMiss / b.n,
      avg_over_selection: b.n === 0 ? 0 : b.sumOver / b.n,
    }))
    .sort((a, b) => order(a.source) - order(b.source) || a.source.localeCompare(b.source))
}

export type ExtrasAnalysis = {
  /** Non-conversation rows only. */
  non_conversation_rows: number
  rows_with_extras: number
  avg_extras_per_row: number
  /** Among passing non-conversation rows. */
  pass_non_conversation: number
  avg_extras_on_pass: number
  /** Sorted by count descending: tool id → times it appeared as an extra. */
  extras_by_tool: { tool: string; count: number }[]
  /** Rows in each bucket by extras count (non-conversation). */
  extras_histogram: { extras_count: number; rows: number }[]
}

/** Count extras (tools outside required ∪ allowed) for minimality / base-tool inflation signals. */
export function aggregateExtrasAnalysis(rows: RowEvalResult[], dataset: RouterEvalRow[]): ExtrasAnalysis {
  const byId = new Map(dataset.map((r) => [r.id, r]))
  const toolCounts = new Map<string, number>()
  const hist = new Map<number, number>()
  let nonConv = 0
  let withExtras = 0
  let sumExtras = 0
  let passNc = 0
  let sumExtrasPass = 0

  for (const ev of rows) {
    const row = byId.get(ev.id)
    if (row?.expect_conversation) continue
    nonConv++
    const n = ev.extras.length
    sumExtras += n
    if (n > 0) withExtras++
    hist.set(n, (hist.get(n) ?? 0) + 1)
    for (const t of ev.extras) toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1)
    if (ev.pass) {
      passNc++
      sumExtrasPass += ev.extras.length
    }
  }

  const extras_by_tool = [...toolCounts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))

  const extras_histogram = [...hist.entries()]
    .map(([extras_count, rows]) => ({ extras_count, rows }))
    .sort((a, b) => a.extras_count - b.extras_count)

  return {
    non_conversation_rows: nonConv,
    rows_with_extras: withExtras,
    avg_extras_per_row: nonConv === 0 ? 0 : sumExtras / nonConv,
    pass_non_conversation: passNc,
    avg_extras_on_pass: passNc === 0 ? 0 : sumExtrasPass / passNc,
    extras_by_tool,
    extras_histogram,
  }
}

export type ExtrasCostAggregate = {
  /** Per tool id: how often it appeared as an extra × estimated bytes each time. */
  extra_tool_by_cost: {
    tool: string
    occurrences: number
    total_bytes: number
    avg_bytes: number
    bucket: ToolCostBucket
  }[]
  /** Sum of (per-extra tool definition bytes) across all extras on all non-conversation rows. */
  total_extra_bytes_summed: number
  /** Average over non-conversation rows of (sum of extra tool bytes on that row). */
  avg_extra_bytes_per_row: number
  /** Among passing non-conversation rows. */
  avg_extra_bytes_on_pass_rows: number
  rows_non_conversation: number
  pass_non_conversation: number
  /** Occurrences and bytes grouped by tool **definition** bucket (low/medium/high). */
  by_bucket: { bucket: ToolCostBucket; occurrences: number; total_bytes: number }[]
}

/** Attribute estimated on-wire definition bytes to extra tool ids (not scoring — observability only). */
export function aggregateExtrasCost(rows: RowEvalResult[], dataset: RouterEvalRow[]): ExtrasCostAggregate {
  const byId = new Map(dataset.map((r) => [r.id, r]))
  const perTool = new Map<string, { n: number; bytes: number }>()
  const bucketAcc: Record<ToolCostBucket, { n: number; bytes: number }> = {
    low: { n: 0, bytes: 0 },
    medium: { n: 0, bytes: 0 },
    high: { n: 0, bytes: 0 },
  }
  let nonConv = 0
  let passNc = 0
  let sumRowBytes = 0
  let sumPassRowBytes = 0
  let totalExtraBytes = 0

  for (const ev of rows) {
    const row = byId.get(ev.id)
    if (row?.expect_conversation) continue
    nonConv++
    let rowExtra = 0
    for (const t of ev.extras) {
      const c = costForToolId(t)
      const b = c.total_est_bytes
      rowExtra += b
      totalExtraBytes += b
      const cur = perTool.get(t) ?? { n: 0, bytes: 0 }
      cur.n++
      cur.bytes += b
      perTool.set(t, cur)
      const bk = c.bucket
      bucketAcc[bk].n++
      bucketAcc[bk].bytes += b
    }
    sumRowBytes += rowExtra
    if (ev.pass) {
      passNc++
      sumPassRowBytes += rowExtra
    }
  }

  const extra_tool_by_cost = [...perTool.entries()]
    .map(([tool, v]) => {
      const c = costForToolId(tool)
      return {
        tool,
        occurrences: v.n,
        total_bytes: v.bytes,
        avg_bytes: v.n === 0 ? 0 : v.bytes / v.n,
        bucket: c.bucket,
      }
    })
    .sort((a, b) => b.total_bytes - a.total_bytes || a.tool.localeCompare(b.tool))

  const by_bucket = (["low", "medium", "high"] as const).map((bucket) => ({
    bucket,
    occurrences: bucketAcc[bucket].n,
    total_bytes: bucketAcc[bucket].bytes,
  }))

  return {
    extra_tool_by_cost,
    total_extra_bytes_summed: totalExtraBytes,
    avg_extra_bytes_per_row: nonConv === 0 ? 0 : sumRowBytes / nonConv,
    avg_extra_bytes_on_pass_rows: passNc === 0 ? 0 : sumPassRowBytes / passNc,
    rows_non_conversation: nonConv,
    pass_non_conversation: passNc,
    by_bucket,
  }
}

/** Short failure reason for debugging (not shown to end users). */
export function rowFailureHint(row: RouterEvalRow, ev: RowEvalResult): string {
  if (ev.pass) return "ok"
  if (row.expect_conversation) {
    return ev.conversation_tool_violation ? "conversation_expected_empty_tools" : "unexpected"
  }
  const parts: string[] = []
  if (ev.forbidden_selected.length) parts.push(`forbidden:${ev.forbidden_selected.join(",")}`)
  if (ev.missing_required.length) parts.push(`missing:${ev.missing_required.join(",")}`)
  if (!ev.forbidden_selected.length && !ev.missing_required.length && ev.extras.length)
    parts.push(`extras:${ev.extras.join(",")}`)
  return parts.length ? parts.join(";") : "fail"
}

export function rankWorst(
  rows: RowEvalResult[],
  _dataset: RouterEvalRow[],
): {
  by_forbidden: RowEvalResult[]
  by_missing: RowEvalResult[]
  by_oversel: RowEvalResult[]
  conversation_failures: RowEvalResult[]
} {
  const convFails = rows.filter((r) => r.conversation_tool_violation)
  const byForbidden = [...rows].sort((a, b) => b.forbidden_selected.length - a.forbidden_selected.length)
  const byMissing = [...rows].sort((a, b) => b.missing_required.length - a.missing_required.length)
  const byOver = [...rows].sort((a, b) => b.over_selection - a.over_selection)
  return {
    by_forbidden: byForbidden.slice(0, 12),
    by_missing: byMissing.slice(0, 12),
    by_oversel: byOver.slice(0, 12),
    conversation_failures: convFails,
  }
}
