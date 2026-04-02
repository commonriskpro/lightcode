/**
 * Grid over 2^6 exact_match flags vs same prompts; ranks by exact match rate (then F1).
 *
 * Single process (lento: un solo worker IPC de embeddings):
 *   CASES=300 bun run script/tool-router-exact-sweep.ts
 *
 * Sharded (una fracción de combinaciones; varios procesos en paralelo = varios workers):
 *   SWEEP_SHARD=0 SWEEP_SHARDS=8 CASES=300 bun run script/tool-router-exact-sweep.ts
 *
 * Orquestador (8 jobs por defecto):
 *   SWEEP_PARALLEL=8 CASES=300 bun run script/tool-router-exact-sweep-parallel.ts
 */
import { ToolRouter } from "../src/session/tool-router"
import type { ExactMatchFlags } from "../src/session/router-exact-match"

type Row = { text: string; expect: string[] }

const tools = {
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

const seed: Row[] = [
  { text: "lee README.md y resumelo", expect: ["read"] },
  { text: "read package.json", expect: ["read"] },
  { text: "find tsconfig files", expect: ["glob"] },
  { text: "busca archivos .env", expect: ["glob"] },
  { text: "search for function buildServer in repo", expect: ["grep"] },
  { text: "grep TODO in src", expect: ["grep"] },
  { text: "edita src/app.ts y cambia el puerto", expect: ["edit"] },
  { text: "refactoriza esta funcion en util.ts", expect: ["edit"] },
  { text: "create docs/plan.md with rollout steps", expect: ["write"] },
  { text: "guarda el resultado en reporte.md", expect: ["write"] },
  { text: "run bun test", expect: ["bash"] },
  { text: "ejecuta npm run build", expect: ["bash"] },
  { text: "search web for bun test timeout issues", expect: ["websearch"] },
  { text: "busca en internet precios de mcdonald", expect: ["websearch"] },
  { text: "fetch https://example.com/docs", expect: ["webfetch"] },
  { text: "abre y descarga contenido de https://opencode.ai", expect: ["webfetch"] },
  { text: "delegate this migration to subagent", expect: ["task"] },
  { text: "usa otro agente para revisar", expect: ["task"] },
  { text: "load skill playwright", expect: ["skill"] },
  { text: "carga la skill de testing", expect: ["skill"] },
  { text: "actualiza mi todo list con 3 tareas", expect: ["todowrite"] },
  { text: "mark task 2 as completed in todo", expect: ["todowrite"] },
  { text: "preguntame si prefiero plan a o b", expect: ["question"] },
  { text: "ask me to choose deployment region", expect: ["question"] },
  { text: "semantic code search for auth middleware", expect: ["codesearch"] },
  { text: "haz busqueda semantica de controladores", expect: ["codesearch"] },
  { text: "find all references and then edit them", expect: ["grep", "edit"] },
  { text: "busca en archivos y luego escribe resumen.md", expect: ["glob", "write"] },
  { text: "search web and save findings to notes.md", expect: ["websearch", "write"] },
  { text: "investiga en internet y guarda en informe.md", expect: ["websearch", "write"] },
  { text: "fetch website and write markdown digest", expect: ["webfetch", "write"] },
  { text: "descarga una url y guarda resultado.md", expect: ["webfetch", "write"] },
  { text: "run tests and edit failing snapshot", expect: ["bash", "edit"] },
  { text: "ejecuta tests y corrige el archivo", expect: ["bash", "edit"] },
  { text: "open file and edit text", expect: ["read", "edit"] },
  { text: "lee config y modificalo", expect: ["read", "edit"] },
  { text: "list files and grep FIXME", expect: ["glob", "grep"] },
  { text: "encuentra archivos y busca el texto API_KEY", expect: ["glob", "grep"] },
  { text: "create new file then run formatter", expect: ["write", "bash"] },
  { text: "crea archivo y ejecuta prettier", expect: ["write", "bash"] },
  { text: "web search docs and fetch first result", expect: ["websearch", "webfetch"] },
  { text: "busca en internet y abre la pagina", expect: ["websearch", "webfetch"] },
  { text: "delegate and write plan.md", expect: ["task", "write"] },
  { text: "usa subagente y guarda plan en markdown", expect: ["task", "write"] },
  { text: "ask user choice then update todo", expect: ["question", "todowrite"] },
  { text: "pregunta al usuario y actualiza pendientes", expect: ["question", "todowrite"] },
  { text: "semantic search then edit implementation", expect: ["codesearch", "edit"] },
  { text: "busqueda semantica y refactor", expect: ["codesearch", "edit"] },
  { text: "read docs and search web for updates", expect: ["read", "websearch"] },
  { text: "lee archivo y busca info nueva en internet", expect: ["read", "websearch"] },
  { text: "fetch url and summarize to md file", expect: ["webfetch", "write"] },
  { text: "descarga web y guarda resumen.md", expect: ["webfetch", "write"] },
  { text: "grep endpoint and write migration notes", expect: ["grep", "write"] },
  { text: "busca endpoint y guarda notas.md", expect: ["grep", "write"] },
  { text: "run shell command and read output file", expect: ["bash", "read"] },
  { text: "ejecuta comando y lee el log", expect: ["bash", "read"] },
]

function buildRows(n: number): Row[] {
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

function msg(text: string) {
  return [{ info: { role: "user" as const }, parts: [{ type: "text" as const, text }] }]
}

function baseCfg(exact: ExactMatchFlags | undefined) {
  return {
    experimental: {
      tool_router: {
        enabled: true,
        router_only: true,
        mode: "hybrid",
        local_embed: true,
        local_intent_embed: true,
        local_embed_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
        auto_tool_selection: true,
        auto_score_ratio: 0.84,
        auto_token_budget: 1600,
        max_tools_cap: 100,
        local_embed_top_k: 4,
        local_embed_min_score: 0.26,
        rerank: false,
        additive: false,
        apply_after_first_assistant: false,
        inject_prompt: false,
        base_tools: ["read"],
        max_tools: 100,
        mcp_always_include: false,
        exact_match: exact,
      },
    },
  }
}

function metrics(rows: { expect: string[]; got: string[] }[]) {
  let tp = 0
  let fp = 0
  let fn = 0
  let exact = 0
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
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { tp, fp, fn, precision, recall, f1, exact, total: rows.length, exactRate: exact / rows.length }
}

function comboFromBits(bits: number): ExactMatchFlags {
  return {
    dynamic_ratio: Boolean(bits & 1),
    per_tool_min: Boolean(bits & 2),
    intent_gating: Boolean(bits & 4),
    redundancy: Boolean(bits & 8),
    calibration: Boolean(bits & 16),
    two_pass: Boolean(bits & 32),
  }
}

function label(bits: number) {
  const c = comboFromBits(bits)
  return [
    c.dynamic_ratio ? "dyn" : "",
    c.per_tool_min ? "ptm" : "",
    c.intent_gating ? "gate" : "",
    c.redundancy ? "red" : "",
    c.calibration ? "cal" : "",
    c.two_pass ? "2p" : "",
  ]
    .filter(Boolean)
    .join("+") || "none"
}

const cases = Math.min(500, Math.max(1, Number(process.env.CASES ?? "300") || 300))
const rows = buildRows(cases)

const shards = Math.max(1, Math.min(64, Number(process.env.SWEEP_SHARDS ?? "1") || 1))
const shard = Math.max(0, Math.min(shards - 1, Number(process.env.SWEEP_SHARD ?? "0") || 0))

function bitRange(s: number, n: number) {
  const start = Math.floor((64 * s) / n)
  const end = Math.floor((64 * (s + 1)) / n)
  return { start, end }
}

const { start: bitsStart, end: bitsEnd } = bitRange(shard, shards)

const results: {
  bits: number
  label: string
  flags: ExactMatchFlags
  m: ReturnType<typeof metrics>
}[] = []

for (let bits = bitsStart; bits < bitsEnd; bits++) {
  const flags = comboFromBits(bits)
  const out: { expect: string[]; got: string[] }[] = []
  for (const row of rows) {
    const ret = await ToolRouter.apply({
      tools: tools as any,
      messages: msg(row.text) as any,
      agent: { name: "build", mode: "primary" },
      cfg: baseCfg(flags) as any,
      mcpIds: new Set(),
      skip: false,
    })
    out.push({ expect: row.expect, got: Object.keys(ret.tools).sort() })
  }
  results.push({ bits, label: label(bits), flags, m: metrics(out) })
}

results.sort((a, b) => {
  if (b.m.exact !== a.m.exact) return b.m.exact - a.m.exact
  if (b.m.exactRate !== a.m.exactRate) return b.m.exactRate - a.m.exactRate
  if (b.m.f1 !== a.m.f1) return b.m.f1 - a.m.f1
  return b.m.precision - a.m.precision
})

const partial = shards > 1
const payload = partial
  ? {
      partial: true as const,
      shard,
      shards,
      bitsRange: { start: bitsStart, end: bitsEnd },
      cases: rows.length,
      results,
    }
  : {
      cases: rows.length,
      combos: 64,
      best: results[0],
      top10: results.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        bits: r.bits,
        label: r.label,
        flags: r.flags,
        exact: r.m.exact,
        exactRate: r.m.exactRate,
        f1: r.m.f1,
        precision: r.m.precision,
        recall: r.m.recall,
      })),
      fullTable: results.map((r) => ({
        bits: r.bits,
        label: r.label,
        exact: r.m.exact,
        exactRate: r.m.exactRate,
        f1: r.m.f1,
        precision: r.m.precision,
        recall: r.m.recall,
      })),
    }

console.log(JSON.stringify(payload, null, 2))
