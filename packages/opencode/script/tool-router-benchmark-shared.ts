/**
 * Shared dataset + metrics + baseCfg for tool-router benchmark scripts.
 *
 * Intent embed (semillas por prototipo) desactivado por defecto para medir solo Xenova + pickTools.
 * `OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT`:
 *   - unset, `1`, `true` → sin `local_intent_embed` (default, recomendado para benchmarks 1:1).
 *   - `0`, `false` → activa `local_intent_embed` (comportamiento tipo producción anterior).
 * `OPENCODE_TOOL_ROUTER_BENCHMARK_LEGACY` = `1` | `true` | `legacy` → `buildRows()` usa **oráculo manual** (`buildRowsLegacy`, etiquetas fijas) como en el doc histórico (~53% exact en 100 casos), no el snapshot de regresión.
 */
import type { ExactMatchFlags } from "../src/session/router-exact-match"
import oracleSnapshot from "./tool-router-oracle-snapshot.json"

/** `local_intent_embed` solo si el benchmark pide comparar con intent; por defecto false. */
export function benchmarkLocalIntentEmbedEnabled() {
  const v = process.env.OPENCODE_TOOL_ROUTER_BENCHMARK_NO_INTENT?.trim().toLowerCase()
  return v === "0" || v === "false"
}

/** Overrides numéricos opcionales en sweeps (AUTO_SCORE_RATIO, LOCAL_EMBED_MIN_SCORE, LOCAL_EMBED_TOP_K). */
export function benchEnvNum(key: string) {
  const raw = process.env[key]?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return n
}

export type BenchRow = { text: string; expect: string[] }

export const tools = {
  read: { description: "Read a file or directory." },
  write: { description: "Write or overwrite files." },
  edit: { description: "Edit file contents." },
  bash: { description: "Run shell commands." },
  glob: { description: "Find files by pattern." },
  grep: { description: "Search text in files." },
  websearch: { description: "Search web pages." },
  webfetch: { description: "Fetch URL content." },
  task: { description: "Delegate to subagent." },
  skill: { description: "Load a skill." },
  todowrite: { description: "Manage todo items." },
  question: { description: "Ask user a structured question." },
  codesearch: { description: "Semantic code search." },
}

const seed: BenchRow[] = [
  { text: "lee README.md y resumelo", expect: ["read"] },
  { text: "read package.json", expect: ["read"] },
  { text: "open docs/architecture.md and extract key modules", expect: ["read"] },
  { text: "revisa src/config.ts y dime los defaults importantes", expect: ["read"] },
  { text: "find tsconfig files", expect: ["glob"] },
  { text: "busca archivos .env", expect: ["glob"] },
  { text: "list all migration files under db/migrations", expect: ["glob"] },
  { text: "encuentra todos los archivos *.spec.ts en packages", expect: ["glob"] },
  { text: "search for function buildServer in repo", expect: ["grep"] },
  { text: "grep TODO in src", expect: ["grep"] },
  { text: "search for OPENAI_API_KEY references across the workspace", expect: ["grep"] },
  { text: "busca 'deprecated' en todo el monorepo", expect: ["grep"] },
  { text: "edita src/app.ts y cambia el puerto", expect: ["edit"] },
  { text: "refactoriza esta funcion en util.ts", expect: ["edit"] },
  { text: "update retry logic in src/net/client.ts", expect: ["edit"] },
  { text: "corrige el typo en docs/cli.md sin tocar otras lineas", expect: ["edit"] },
  { text: "create docs/plan.md with rollout steps", expect: ["write"] },
  { text: "guarda el resultado en reporte.md", expect: ["write"] },
  { text: "write a changelog entry for version 1.4.0", expect: ["write"] },
  { text: "crea un archivo notes/today.md con pendientes", expect: ["write"] },
  { text: "run bun test", expect: ["bash"] },
  { text: "ejecuta npm run build", expect: ["bash"] },
  { text: "run bun typecheck in packages/opencode", expect: ["bash"] },
  { text: "ejecuta git status y muestra cambios pendientes", expect: ["bash"] },
  { text: "search web for bun test timeout issues", expect: ["websearch"] },
  { text: "busca en internet documentacion de drizzle relations", expect: ["websearch"] },
  { text: "fetch https://example.com/docs", expect: ["webfetch"] },
  { text: "abre y descarga contenido de https://opencode.ai", expect: ["webfetch"] },
  { text: "delegate this migration to subagent", expect: ["task"] },
  { text: "usa otro agente para revisar", expect: ["task"] },
  { text: "delegate performance profiling to a subagent", expect: ["task"] },
  { text: "delega a otro agente la revision de seguridad", expect: ["task"] },
  { text: "load skill playwright", expect: ["skill"] },
  { text: "carga la skill de testing", expect: ["skill"] },
  { text: "load the cursor settings skill", expect: ["skill"] },
  { text: "carga una skill para crear reglas del proyecto", expect: ["skill"] },
  { text: "actualiza mi todo list con 3 tareas", expect: ["todowrite"] },
  { text: "mark task 2 as completed in todo", expect: ["todowrite"] },
  { text: "add two pending tasks and cancel the old one in todo", expect: ["todowrite"] },
  { text: "actualiza mi lista de tareas: una en progreso y dos pendientes", expect: ["todowrite"] },
  { text: "preguntame si prefiero plan a o b", expect: ["question"] },
  { text: "ask me to choose deployment region", expect: ["question"] },
  { text: "ask me which database provider I prefer", expect: ["question"] },
  { text: "preguntame si quiero modo rapido o modo seguro", expect: ["question"] },
  { text: "semantic code search for auth middleware", expect: ["codesearch"] },
  { text: "haz busqueda semantica de controladores", expect: ["codesearch"] },
  { text: "semantic search for websocket reconnect logic", expect: ["codesearch"] },
  { text: "haz busqueda semantica del flujo de pagos", expect: ["codesearch"] },
  { text: "find all references and then edit them", expect: ["grep", "edit"] },
  { text: "busca en archivos y luego escribe resumen.md", expect: ["glob", "write"] },
  { text: "read docs/contributing.md and write a short onboarding.md", expect: ["read", "write"] },
  { text: "lee CHANGELOG.md y escribe resumen en release-notes.md", expect: ["read", "write"] },
  { text: "fetch website and write markdown digest", expect: ["webfetch", "write"] },
  { text: "descarga la pagina de docs y guarda digest.md", expect: ["webfetch", "write"] },
  { text: "run tests and edit failing snapshot", expect: ["bash", "edit"] },
  { text: "ejecuta tests y corrige el archivo", expect: ["bash", "edit"] },
  { text: "open file and edit text", expect: ["read", "edit"] },
  { text: "lee config y modificalo", expect: ["read", "edit"] },
  { text: "list files and grep FIXME", expect: ["glob", "grep"] },
  { text: "encuentra archivos y busca el texto API_KEY", expect: ["glob", "grep"] },
  { text: "create new file then run formatter", expect: ["write", "bash"] },
  { text: "crea archivo y ejecuta prettier", expect: ["write", "bash"] },
  { text: "search release notes and then fetch the official page", expect: ["websearch", "webfetch"] },
  { text: "busca una guia de bun y luego abre el enlace oficial", expect: ["websearch", "webfetch"] },
  { text: "delegate and write plan.md", expect: ["task", "write"] },
  { text: "usa subagente y guarda plan en markdown", expect: ["task", "write"] },
  { text: "ask user choice then update todo", expect: ["question", "todowrite"] },
  { text: "pregunta al usuario y actualiza pendientes", expect: ["question", "todowrite"] },
  { text: "semantic search then edit implementation", expect: ["codesearch", "edit"] },
  { text: "busqueda semantica y refactor", expect: ["codesearch", "edit"] },
  { text: "read docs and run typecheck to validate changes", expect: ["read", "bash"] },
  { text: "lee el archivo y luego ejecuta pruebas rapidas", expect: ["read", "bash"] },
  { text: "fetch url and summarize to md file", expect: ["webfetch", "write"] },
  { text: "descarga una url tecnica y guarda resumen.md", expect: ["webfetch", "write"] },
  { text: "grep endpoint and write migration notes", expect: ["grep", "write"] },
  { text: "busca endpoint y guarda notas.md", expect: ["grep", "write"] },
  { text: "run shell command and read output file", expect: ["bash", "read"] },
  { text: "ejecuta comando y lee el log", expect: ["bash", "read"] },
  { text: "run git diff and summarize changed files", expect: ["bash", "read"] },
  { text: "ejecuta un comando y despues lee el resultado en un archivo", expect: ["bash", "read"] },
  { text: "find service files and delegate implementation to subagent", expect: ["glob", "task"] },
  { text: "encuentra archivos de api y delega la refactorizacion", expect: ["glob", "task"] },
  { text: "grep auth code and ask user which strategy to keep", expect: ["grep", "question"] },
  { text: "busca dos implementaciones y preguntame cual dejamos", expect: ["grep", "question"] },
  { text: "semantic search for cache layer then write findings to notes.md", expect: ["codesearch", "write"] },
  { text: "haz busqueda semantica y guarda hallazgos en reporte.md", expect: ["codesearch", "write"] },
  { text: "load skill and then delegate execution", expect: ["skill", "task"] },
  { text: "carga una skill y luego delega el trabajo", expect: ["skill", "task"] },
]

/** Legacy hand-written expects + generated tails (before oracle regression snapshot). */
export function buildRowsLegacy(n: number): BenchRow[] {
  const out = [...seed]
  const single = [
    { id: "read" as const, en: "read the config file", es: "lee el archivo de configuracion" },
    { id: "write" as const, en: "write output to out.txt", es: "escribe salida en out.txt" },
    { id: "edit" as const, en: "edit lib/utils.ts", es: "edita lib/utils.ts" },
    { id: "bash" as const, en: "run cargo check", es: "ejecuta cargo check" },
    { id: "glob" as const, en: "glob **/*.test.ts", es: "busca **/*.test.ts" },
    { id: "grep" as const, en: "grep for deprecated", es: "busca deprecated en el codigo" },
    { id: "websearch" as const, en: "search web for latest nextjs", es: "busca en internet nextjs ultima version" },
    { id: "webfetch" as const, en: "fetch https://api.github.com", es: "descarga https://api.github.com" },
    { id: "task" as const, en: "delegate to build agent", es: "delega al agente build" },
    { id: "skill" as const, en: "load skill typescript", es: "carga skill typescript" },
    { id: "todowrite" as const, en: "update todo with fixes", es: "actualiza todo con arreglos" },
    { id: "question" as const, en: "ask me yes or no", es: "preguntame si o no" },
    { id: "codesearch" as const, en: "codesearch payment flow", es: "busqueda semantica flujo de pago" },
  ]
  const multi: { text: string; expect: string[] }[] = [
    { text: "glob src then grep export", expect: ["glob", "grep"] },
    { text: "web search price and save price.md", expect: ["websearch", "write"] },
    { text: "fetch docs and edit README", expect: ["webfetch", "edit"] },
    { text: "read tests and run bun test", expect: ["read", "bash"] },
    { text: "grep handler and codesearch callers", expect: ["grep", "codesearch"] },
  ]
  let i = 0
  while (out.length < n) {
    const s = single[i % single.length]!
    const lang = Math.floor(i / single.length) % 2 === 0 ? s.en : s.es
    out.push({ text: `${lang} (case ${out.length})`, expect: [s.id] })
    if (out.length < n && i % 7 === 0) {
      const m = multi[i % multi.length]!
      out.push({ text: `${m.text} [${out.length}]`, expect: m.expect })
    }
    i++
  }
  return out.slice(0, n)
}

const oracleRows = oracleSnapshot as BenchRow[]

/**
 * Benchmark rows: **expect** matches offline router output for the canonical config used to build
 * `tool-router-oracle-snapshot.json` (Xenova + `dyn+ptm+cal` + `0.97`/`0.74` + `0.86`/`0.18`). This is a
 * **regression oracle**, not an independent gold standard. Regenerate after intentional router changes:
 * `bun run script/tool-router-write-oracle-snapshot.ts`
 */
export function buildRows(n: number): BenchRow[] {
  const legacy = process.env.OPENCODE_TOOL_ROUTER_BENCHMARK_LEGACY?.trim().toLowerCase()
  if (legacy === "1" || legacy === "true" || legacy === "legacy") {
    return buildRowsLegacy(n)
  }
  const cap = Math.min(n, oracleRows.length)
  return oracleRows.slice(0, cap).map((r) => ({ text: r.text, expect: [...r.expect] }))
}

export function caseIndex(input: string | undefined) {
  return Math.max(1, Number(input) || 1)
}

export function oneCase(input: string | undefined, rows: BenchRow[]) {
  if (!input) return rows
  const idx = caseIndex(input)
  const row = rows[idx - 1]
  if (!row) return rows.slice(0, 1)
  return [row]
}

export function msg(text: string) {
  return [{ info: { role: "user" as const }, parts: [{ type: "text" as const, text }] }]
}

export type BenchCfg = {
  exact?: ExactMatchFlags
  auto_score_ratio?: number
  local_embed_min_score?: number
  local_embed_top_k?: number
  dynamic_ratio_simple?: number
  dynamic_ratio_composite?: number
}

export function baseCfg(input: BenchCfg) {
  return {
    experimental: {
      tool_router: {
        enabled: true,
        router_only: true,
        mode: "hybrid",
        local_embed: true,
        local_intent_embed: benchmarkLocalIntentEmbedEnabled(),
        local_embed_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
        auto_tool_selection: true,
        auto_score_ratio: input.auto_score_ratio ?? 0.9,
        auto_token_budget: 1600,
        max_tools_cap: 100,
        local_embed_top_k: input.local_embed_top_k ?? 4,
        local_embed_min_score: input.local_embed_min_score ?? 0.34,
        rerank: false,
        additive: false,
        apply_after_first_assistant: false,
        inject_prompt: false,
        base_tools: ["read"],
        max_tools: 100,
        mcp_always_include: false,
        exact_match: {
          ...input.exact,
          ...(input.dynamic_ratio_simple !== undefined
            ? { dynamic_ratio_simple: input.dynamic_ratio_simple }
            : {}),
          ...(input.dynamic_ratio_composite !== undefined
            ? { dynamic_ratio_composite: input.dynamic_ratio_composite }
            : {}),
        },
      },
    },
  }
}

export type BenchMetrics = ReturnType<typeof metrics>

/** Product: cada herramienta oráculo está en la predicción (extras OK). `expect` viene del snapshot de regresión (`tool-router-oracle-snapshot.json`) alineado al router canónico — ver docs. */
export function metrics(rows: { expect: string[]; got: string[] }[]) {
  let tp = 0
  let fp = 0
  let fn = 0
  let exact = 0
  let fullCoverage = 0
  const total = rows.length
  for (const row of rows) {
    const a = new Set(row.expect)
    const b = new Set(row.got)
    let hit = true
    for (const x of b) {
      if (a.has(x)) tp++
      else {
        fp++
        hit = false
      }
    }
    for (const x of a) {
      if (!b.has(x)) {
        fn++
        hit = false
      }
    }
    if (hit && a.size === b.size) exact++
    if ([...a].every((id) => b.has(id))) fullCoverage++
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    exact,
    total,
    exactRate: total ? exact / total : 0,
    fullCoverage,
    fullCoverageRate: total ? fullCoverage / total : 0,
  }
}

/** strict: igualdad de conjuntos primero. full (default recomendado): cobertura oráculo ⊆ predicho primero (extras permitidos). */
export function compareSweepRank(a: BenchMetrics, b: BenchMetrics, mode: "strict" | "full") {
  if (mode === "strict") {
    if (b.exact !== a.exact) return b.exact - a.exact
    if (b.exactRate !== a.exactRate) return b.exactRate - a.exactRate
    if (b.fullCoverageRate !== a.fullCoverageRate) return b.fullCoverageRate - a.fullCoverageRate
  } else {
    if (b.fullCoverageRate !== a.fullCoverageRate) return b.fullCoverageRate - a.fullCoverageRate
    if (b.exact !== a.exact) return b.exact - a.exact
    if (b.exactRate !== a.exactRate) return b.exactRate - a.exactRate
  }
  if (b.f1 !== a.f1) return b.f1 - a.f1
  return b.precision - a.precision
}

/** Objetivo config grid: coverage (default) alinea con meta ~80% fullCoverageRate. */
export function compareConfigBenchmark(a: BenchMetrics, b: BenchMetrics, objective: string) {
  const o = objective.trim().toLowerCase()
  const bal = (m: BenchMetrics) => 0.55 * m.f1 + 0.45 * m.exactRate
  if (o === "precision") {
    if (b.precision !== a.precision) return b.precision - a.precision
    if (b.f1 !== a.f1) return b.f1 - a.f1
    return b.exact - a.exact
  }
  if (o === "recall") {
    if (b.recall !== a.recall) return b.recall - a.recall
    if (b.f1 !== a.f1) return b.f1 - a.f1
    return b.exact - a.exact
  }
  if (o === "exact") {
    if (b.exact !== a.exact) return b.exact - a.exact
    if (b.exactRate !== a.exactRate) return b.exactRate - a.exactRate
    return b.f1 - a.f1
  }
  if (o === "balanced") {
    if (bal(b) !== bal(a)) return bal(b) - bal(a)
    if (b.exact !== a.exact) return b.exact - a.exact
    return b.f1 - a.f1
  }
  if (o === "coverage" || o === "fullcoverage") {
    if (b.fullCoverageRate !== a.fullCoverageRate) return b.fullCoverageRate - a.fullCoverageRate
    if (b.exact !== a.exact) return b.exact - a.exact
    if (b.f1 !== a.f1) return b.f1 - a.f1
    return b.recall - a.recall
  }
  if (b.f1 !== a.f1) return b.f1 - a.f1
  if (b.exact !== a.exact) return b.exact - a.exact
  return b.precision - a.precision
}

export function comboFromBits(bits: number): ExactMatchFlags {
  return {
    dynamic_ratio: Boolean(bits & 1),
    per_tool_min: Boolean(bits & 2),
    intent_gating: Boolean(bits & 4),
    redundancy: Boolean(bits & 8),
    calibration: Boolean(bits & 16),
    two_pass: Boolean(bits & 32),
  }
}

export function labelBits(bits: number) {
  const c = comboFromBits(bits)
  return (
    [
      c.dynamic_ratio ? "dyn" : "",
      c.per_tool_min ? "ptm" : "",
      c.intent_gating ? "gate" : "",
      c.redundancy ? "red" : "",
      c.calibration ? "cal" : "",
      c.two_pass ? "2p" : "",
    ]
      .filter(Boolean)
      .join("+") || "none"
  )
}
