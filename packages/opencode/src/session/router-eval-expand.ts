import type { RouterEvalConfidence, RouterEvalRow, RouterEvalSource } from "./router-eval-types"

/** Default full tool palette aligned with seed fixture. */
export const ROUTER_EVAL_FULL_PALETTE = [
  "read",
  "grep",
  "glob",
  "bash",
  "edit",
  "write",
  "webfetch",
  "websearch",
  "task",
  "skill",
  "question",
  "todowrite",
  "codesearch",
] as const

export type ExpandCategory =
  | "conversation"
  | "bash_gate"
  | "edit_write"
  | "web_pair"
  | "grep_codesearch"
  | "multi_clause"
  | "task_skill"
  | "edge"
  | "conflict_gate"

export function normalizePromptForDedupe(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[""'']/g, '"')
    .replace(/[…]/g, "...")
}

export function rowDedupeKey(r: RouterEvalRow): string {
  const req = r.required_tools.slice().sort().join(",")
  const forb = (r.forbidden_tools ?? []).slice().sort().join(",")
  const allow = (r.allowed_tools ?? []).slice().sort().join(",")
  return [
    normalizePromptForDedupe(r.prompt),
    r.agent,
    req,
    forb,
    allow,
    String(r.expect_conversation ?? false),
  ].join("|")
}

export function dedupeRouterEvalRows(rows: RouterEvalRow[]): RouterEvalRow[] {
  const seen = new Set<string>()
  const out: RouterEvalRow[] = []
  for (const r of rows) {
    const k = rowDedupeKey(r)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

/** Deterministic string hash (FNV-1a 32-bit) for stable ids from prompt text. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export type CorpusLabel =
  | {
      required_tools: string[]
      allowed_tools?: string[]
      forbidden_tools?: string[]
      expect_conversation?: boolean
    }
  | { skip: true; reason: string }

/** First token in `positive` before '.' is the intended tool id from the corpus. */
export function corpusPositiveToolId(positive: string): string {
  const i = positive.indexOf(".")
  const head = (i >= 0 ? positive.slice(0, i) : positive).trim()
  return head.split(/\s/)[0]?.trim() ?? ""
}

const HEURISTIC_NOTE = "Heuristic from corpus positive prefix; not ground truth."

/** Map corpus tool id to eval labels using the standard palette (conservative). */
export function labelFromCorpusTool(tool: string): CorpusLabel {
  const t = tool.toLowerCase()
  if (!t) return { skip: true, reason: "empty_tool" }

  if (t === "read")
    return {
      required_tools: ["read"],
      allowed_tools: ["grep", "glob"],
      forbidden_tools: ["bash", "write"],
    }
  if (t === "grep")
    return {
      required_tools: ["grep"],
      allowed_tools: ["read", "glob"],
      forbidden_tools: ["codesearch", "websearch"],
    }
  if (t === "glob")
    return {
      required_tools: ["glob"],
      allowed_tools: ["read"],
      forbidden_tools: ["bash"],
    }
  if (t === "bash")
    return {
      required_tools: ["bash", "read"],
      allowed_tools: ["grep"],
      forbidden_tools: ["webfetch", "websearch"],
    }
  if (t === "edit" || t === "apply_patch")
    return {
      required_tools: ["edit", "read"],
      allowed_tools: ["grep", "glob"],
      forbidden_tools: ["websearch"],
    }
  if (t === "write")
    return {
      required_tools: ["write", "read"],
      allowed_tools: ["grep", "glob"],
      forbidden_tools: ["bash"],
    }
  if (t === "webfetch")
    return {
      required_tools: ["webfetch", "read"],
      allowed_tools: ["grep"],
      forbidden_tools: ["bash", "edit"],
    }
  if (t === "websearch")
    return {
      required_tools: ["websearch", "read"],
      allowed_tools: ["webfetch"],
      forbidden_tools: ["bash", "edit"],
    }
  if (t === "task" || t === "plan_exit")
    return {
      required_tools: ["task", "read"],
      allowed_tools: ["skill", "grep"],
      forbidden_tools: ["webfetch"],
    }
  if (t === "skill")
    return {
      required_tools: ["skill", "read"],
      allowed_tools: ["grep"],
      forbidden_tools: ["websearch"],
    }
  if (t === "question")
    return {
      required_tools: ["question", "read"],
      forbidden_tools: ["bash", "write", "edit"],
    }
  if (t === "todowrite")
    return {
      required_tools: ["todowrite", "read"],
      forbidden_tools: ["bash"],
    }
  if (t === "codesearch" || t === "lsp")
    return {
      required_tools: ["codesearch", "read"],
      allowed_tools: ["grep", "glob"],
      forbidden_tools: ["webfetch"],
    }
  if (t === "batch") return { skip: true, reason: "batch_ambiguous" }

  return { skip: true, reason: `unknown_tool:${t}` }
}

type SynthSpec = Omit<RouterEvalRow, "id" | "source"> & { category: ExpandCategory }

function synth(spec: SynthSpec, idx: number): RouterEvalRow {
  const id = `syn-${spec.category}-${String(idx).padStart(4, "0")}`
  return {
    id,
    source: "synthetic",
    prompt: `${spec.prompt} (eval-syn-${idx})`,
    agent: spec.agent,
    available_tools: spec.available_tools,
    required_tools: spec.required_tools,
    allowed_tools: spec.allowed_tools,
    forbidden_tools: spec.forbidden_tools,
    expect_conversation: spec.expect_conversation,
    notes: spec.notes,
    category: spec.category,
  }
}

function buildSyntheticSpecs(): SynthSpec[] {
  const palette = [...ROUTER_EVAL_FULL_PALETTE]
  const orch = "sdd-orchestrator"
  const build = "build"
  const out: SynthSpec[] = []

  const conv = [
    "Hey there!",
    "Good morning — quick check-in before we start.",
    "Thanks, that solved it. Appreciate the help.",
    "I'm frustrated; nothing compiles but I need a break.",
    "Tell me a joke about TypeScript.",
    "How was your weekend?",
    "Gracias, perfecto.",
    "Solo quería desear buenos días.",
    "No necesito código, solo contexto del equipo.",
    "Estoy estresado con deadlines, ¿me escuchas?",
  ]
  conv.forEach((prompt, i) => {
    out.push({
      category: "conversation",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [],
      forbidden_tools: [],
      expect_conversation: true,
      notes: `Synthetic chat-only ${i + 1}`,
    })
  })

  const bashYes = [
    ["Run pnpm install at the repo root", ["bash", "read"], ["webfetch"], "EN install"],
    ["Execute docker compose up -d", ["bash", "read"], ["write"], "EN docker"],
    ["Run the linter: eslint . --max-warnings 0", ["bash", "read"], [], "EN lint"],
    ["Ejecuta npm ci y luego npm test", ["bash", "read"], ["websearch"], "ES test chain"],
    ["Compila con cargo build --release", ["bash", "read"], [], "ES rust"],
    ["git rebase origin/main and fix conflicts in terminal", ["bash", "read"], ["webfetch"], "EN git"],
  ] as const
  bashYes.forEach(([prompt, req, forb, tag], i) => {
    out.push({
      category: "bash_gate",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["grep"],
      forbidden_tools: [...forb],
      notes: `Synthetic bash explicit ${tag} ${i}`,
    })
  })

  const bashNo = [
    ["What command should I run to install deps? (don't run it)", ["read", "grep"], ["bash"], "ask only"],
    ["Explain what pnpm does vs npm — no execution", ["read"], ["bash", "write"], "conceptual"],
    ["¿Qué hace `bun test` en este repo? Solo explica", ["read", "grep"], ["bash"], "ES explain"],
    ["Compare vitest vs jest from our config files", ["read", "grep"], ["bash"], "compare read"],
  ] as const
  bashNo.forEach(([prompt, req, forb, tag], i) => {
    out.push({
      category: "bash_gate",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob", "codesearch"],
      forbidden_tools: [...forb],
      notes: `Synthetic bash gate negative ${tag} ${i}`,
    })
  })

  const editW = [
    ["Patch src/main.ts: export default async function", ["edit", "read"], ["write"], "EN patch"],
    ["Refactor handleError to use early returns", ["edit", "read"], ["write"], "EN refactor"],
    ["Corrige el off-by-one en utils.ts", ["edit", "read"], ["bash"], "ES fix"],
    ["Add JSDoc to parseRouterEvalLine without renaming the file", ["edit", "read"], ["write"], "EN doc"],
  ] as const
  editW.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "edit_write",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["grep"],
      forbidden_tools: [...forb, "websearch"],
      notes: `Synthetic edit ${i + 1}`,
    })
  })

  const writeW = [
    ["Create CONTRIBUTING.md from scratch with setup steps", ["write", "read"], ["bash"], "EN new md"],
    ["Nuevo archivo docs/tips.md con bullet points", ["write", "read"], ["websearch"], "ES new file"],
  ] as const
  writeW.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "edit_write",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["grep", "glob"],
      forbidden_tools: [...forb],
      notes: `Synthetic write ${i + 1}`,
    })
  })

  const ambiguousFix = [
    ["fix this", ["read", "grep", "edit"], ["webfetch"], "vague fix"],
    ["arreglalo en el modulo de auth", ["read", "edit", "grep"], ["websearch"], "ES vague"],
  ] as const
  ambiguousFix.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "edit_write",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["bash", "glob"],
      forbidden_tools: [...forb],
      notes: `Synthetic ambiguous fix ${i + 1}`,
    })
  })

  const webF = [
    ["GET https://httpbin.org/json and print the url field", ["webfetch", "read"], ["websearch"], "EN url"],
    ["Fetch https://example.com and extract the H1", ["webfetch", "read"], ["bash"], "EN h1"],
    ["Descarga https://nodejs.org/api/fs.html y resume fs.promises", ["webfetch", "read"], ["edit"], "ES fetch"],
  ] as const
  webF.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "web_pair",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["grep"],
      forbidden_tools: [...forb],
      notes: `Synthetic webfetch ${i + 1}`,
    })
  })

  const webS = [
    ["Search the web for Bun 1.2 release notes", ["websearch", "read"], ["edit"], "EN research"],
    ["Busca documentación oficial sobre advisory locks en Postgres", ["websearch", "read"], ["bash"], "ES doc"],
    ["Look up best practices for Zod v4 migrations online", ["websearch", "read"], ["write"], "EN zod"],
  ] as const
  webS.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "web_pair",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["webfetch", "grep"],
      forbidden_tools: [...forb],
      notes: `Synthetic websearch ${i + 1}`,
    })
  })

  const webGate = [
    ["Summarize our README without browsing external URLs", ["read", "grep"], ["webfetch", "websearch"], "no web"],
    ["Explica el flujo OAuth solo con archivos del repo", ["read", "codesearch"], ["webfetch", "websearch"], "ES repo only"],
  ] as const
  webGate.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "conflict_gate",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob"],
      forbidden_tools: [...forb],
      notes: `Synthetic web gate ${i + 1}`,
    })
  })

  const grepVs = [
    ['Find exact string "TODO(auth)" in *.ts', ["grep"], ["codesearch"], "literal"],
    ["Busca la cadena `export const` en src/", ["grep"], ["websearch"], "ES literal"],
    ["Semantic: where do we normalize file paths?", ["codesearch", "read"], ["webfetch"], "semantic"],
    ["Por significado: donde está el offline router", ["codesearch", "read"], ["bash"], "ES semantic"],
    ["Find symbol getSession in packages/", ["grep", "read"], ["websearch"], "symbol"],
  ] as const
  grepVs.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "grep_codesearch",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob"],
      forbidden_tools: [...forb],
      notes: `Synthetic grep/codesearch ${i + 1}`,
    })
  })

  const multi = [
    [
      "Read packages/opencode/src/session/tool-router.ts and then fix the typo in the comment",
      ["read", "edit", "grep"],
      ["webfetch"],
      "EN read then edit",
    ],
    [
      "Find where splitClauses is used, then add a unit test file beside router-policy tests",
      ["grep", "write", "read"],
      ["websearch"],
      "EN find then write",
    ],
    [
      "Revisa router-eval-score.ts y luego documenta la métrica en docs/router-eval.md",
      ["read", "edit", "write"],
      ["bash"],
      "ES review then doc",
    ],
    [
      "Search the codebase for CONVERSATION_INTENT_LABEL, then summarize behavior in two sentences",
      ["codesearch", "read", "grep"],
      ["webfetch"],
      "EN search then explain",
    ],
    [
      "Lee la spec en docs/spec-offline-tool-router.md y después implementa un flag opcional en config",
      ["read", "edit", "grep"],
      ["websearch"],
      "ES read then implement",
    ],
  ] as const
  multi.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "multi_clause",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob"],
      forbidden_tools: [...forb],
      notes: `Synthetic multi-clause ${i + 1}`,
    })
  })

  const taskSkill = [
    ["Spawn a subagent to audit all SQL migrations for safety", ["task", "read"], ["webfetch"], "EN task"],
    ["Delega a otro agente la revisión de dependencias npm", ["task", "read"], ["write"], "ES task"],
    ["Load the verification skill and run it against this workspace", ["skill", "read"], ["websearch"], "EN skill"],
    ["Carga el skill de Postgres best-practices antes de tocar queries", ["skill", "read"], ["bash"], "ES skill"],
    ["Implement the helper inline here — do not spawn a subagent", ["read", "edit", "grep"], ["task"], "EN no task"],
  ] as const
  taskSkill.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "task_skill",
      prompt,
      agent: orch,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob", "grep"],
      forbidden_tools: [...forb],
      notes: `Synthetic task/skill ${i + 1}`,
    })
  })

  const edge = [
    ["ok", [], ["bash", "write", "edit"], "tiny EN"],
    ["¿?", ["read", "question"], ["bash"], "tiny ES"],
    ["It", ["read", "grep"], ["bash", "webfetch"], "pronoun"],
    ["Update it there", ["read", "edit", "grep"], ["webfetch"], "pronoun edit"],
    ["/src/foo.ts — what exports?", ["read", "grep"], ["websearch"], "path"],
    ["Mixed: read README luego grep \"AGENTS\" en docs/", ["read", "grep"], ["websearch"], "EN-ES"],
    ["!!! HELP !!! tests failing !!!", ["read", "bash", "grep"], ["webfetch"], "punct"],
  ] as const
  edge.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "edge",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob", "codesearch", "task"],
      forbidden_tools: [...forb],
      notes: `Synthetic edge ${i + 1}`,
    })
  })

  const moreConv = Array.from({ length: 38 }, (_, i) => ({
    category: "conversation" as const,
    prompt: `Synthetic small-talk probe ${i + 1}: thanks and bye`,
    agent: build,
    available_tools: palette,
    required_tools: [] as string[],
    forbidden_tools: [] as string[],
    expect_conversation: true,
    notes: `Synthetic conv filler ${i + 1}`,
  }))
  moreConv.forEach((s) => out.push(s))

  const moreMulti = Array.from({ length: 35 }, (_, i) => ({
    category: "multi_clause" as const,
    prompt: `Open src/session/router-policy.ts (probe ${i}) then ${i % 2 === 0 ? "add a comment" : "list imports"} about clause splitting`,
    agent: build,
    available_tools: palette,
    required_tools: ["read", "edit", "grep"],
    allowed_tools: ["glob"],
    forbidden_tools: ["webfetch", "websearch"],
    notes: `Synthetic multi filler ${i + 1}`,
  }))
  moreMulti.forEach((s) => out.push(s))

  const moreBash = Array.from({ length: 20 }, (_, i) => ({
    category: "bash_gate" as const,
    prompt:
      i % 2 === 0
        ? `Run benchmark case ${i}: bun test test/session/router-eval.test.ts`
        : `Ejecuta el script de build número ${i} con pnpm run build`,
    agent: build,
    available_tools: palette,
    required_tools: ["bash", "read"],
    allowed_tools: ["grep"],
    forbidden_tools: ["webfetch"],
    notes: `Synthetic bash filler ${i + 1}`,
  }))
  moreBash.forEach((s) => out.push(s))

  const moreGrep = Array.from({ length: 25 }, (_, i) => ({
    category: "grep_codesearch" as const,
    prompt:
      i % 3 === 0
        ? `Conceptually: where is offline eval ${i} handled?`
        : i % 3 === 1
          ? `Find literal "router-eval-expand" string in repo chunk ${i}`
          : `Busca por significado el manejo de embeddings ${i}`,
    agent: build,
    available_tools: palette,
    required_tools: i % 3 === 0 ? ["codesearch", "read"] : ["grep"],
    allowed_tools: ["glob", "read"],
    forbidden_tools: i % 3 === 0 ? ["webfetch"] : ["codesearch"],
    notes: `Synthetic grep/cs filler ${i + 1}`,
  }))
  moreGrep.forEach((s) => out.push(s))

  const moreWeb = Array.from({ length: 22 }, (_, i) => ({
    category: "web_pair" as const,
    prompt:
      i % 2 === 0
        ? `Open https://example.com/page${i} and extract the title`
        : `Busca en la web comparativas de ORMs para proyecto ${i}`,
    agent: build,
    available_tools: palette,
    required_tools: i % 2 === 0 ? ["webfetch", "read"] : ["websearch", "read"],
    allowed_tools: ["grep"],
    forbidden_tools: i % 2 === 0 ? ["websearch"] : ["webfetch"],
    notes: `Synthetic web filler ${i + 1}`,
  }))
  moreWeb.forEach((s) => out.push(s))

  const moreConflict = [
    ["Never run shell; only read files to explain package scripts", ["read", "grep"], ["bash", "write"], "no bash"],
    ["No git commands — inspect .gitignore content only", ["read", "grep"], ["bash"], "git gate"],
    ["Compare edit vs write: we need a new file, not a patch", ["write", "read"], ["edit", "bash"], "new vs edit"],
    ["Solo lectura: resume AGENTS.md sin ejecutar nada", ["read"], ["bash", "write", "edit"], "ES read-only"],
    ["Do not fetch URLs; grep the repo for the API base string", ["grep", "read"], ["webfetch", "websearch"], "no web"],
    ["Instala dependencias con npm — ejecuta en terminal", ["bash", "read"], ["webfetch"], "ES bash yes"],
    ["Refactor in place: change return type in existing src/api.ts", ["edit", "read"], ["write"], "edit not write"],
    ["Scaffold nueva ruta: crea archivo vacío bajo src/routes/", ["write", "read"], ["edit", "bash"], "write new"],
    ["Mixed: lee README, luego decide si hace falta web search (no hagas web)", ["read", "grep"], ["webfetch", "websearch"], "ES mixed gate"],
    ["Run tests only after reading the failing file — read first", ["read", "bash", "grep"], ["websearch"], "order gate"],
  ] as const
  moreConflict.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "conflict_gate",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob", "codesearch"],
      forbidden_tools: [...forb],
      notes: `Synthetic conflict gate extra ${i + 1}`,
    })
  })

  const moreEdit = [
    ["Rename variable x to sessionId across the file", ["edit", "read"], ["write"], "rename scope"],
    ["Añade un case al switch sin crear archivos nuevos", ["edit", "read"], ["write"], "ES edit"],
    ["Widen type of config port: number | string", ["edit", "read"], ["bash"], "types"],
    ["Replace deprecated import from 'fs/promises' in one file", ["edit", "read"], ["websearch"], "deprec"],
    ["Corrige imports rotos en tests/setup.ts", ["edit", "read"], ["write"], "ES fix imports"],
    ["Add error boundary — modify existing component file only", ["edit", "read"], ["write"], "react edit"],
    ["Export the helper from lib/foo.ts as a named export", ["edit", "read"], ["write"], "export edit"],
    ["Split the long function in handler.ts into two without new files", ["edit", "read"], ["write"], "split fn"],
    ["Quita el console.log de debug en producción en main.ts", ["edit", "read"], ["bash"], "ES remove log"],
    ["Inline the small helper instead of importing it — edit in place", ["edit", "read"], ["write"], "inline"],
  ] as const
  moreEdit.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "edit_write",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["grep", "glob"],
      forbidden_tools: [...forb, "websearch"],
      notes: `Synthetic edit_write extra ${i + 1}`,
    })
  })

  const moreTask = [
    ["Hand off codegen to a worker agent with repo read access", ["task", "read"], ["webfetch"], "delegate"],
    ["Subagent: trace all imports of @/config without editing", ["task", "read"], ["write"], "read-only sub"],
    ["Invoke skill markdownlint before saving docs", ["skill", "read"], ["bash"], "skill"],
    ["No delegation — you implement the one-line fix", ["read", "edit", "grep"], ["task"], "no task"],
    ["Orquesta sdd-verify y sdd-build en secuencia", ["task", "read"], ["webfetch"], "ES orchestrate"],
    ["Load skill nextjs and apply routing conventions", ["skill", "read"], ["websearch"], "skill next"],
  ] as const
  moreTask.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "task_skill",
      prompt,
      agent: orch,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob", "grep"],
      forbidden_tools: [...forb],
      notes: `Synthetic task_skill extra ${i + 1}`,
    })
  })

  const moreEdge2 = [
    ["this", ["read", "grep", "question"], ["bash", "write"], "ultra short"],
    ["that file", ["read", "grep"], ["webfetch"], "deictic"],
    ["it broke", ["read", "grep", "edit"], ["websearch"], "vague break"],
    ["ellos dijeron que lo arreglen sin decir dónde", ["read", "codesearch", "grep"], ["bash"], "ES pronoun"],
    ["Path: packages/opencode/src/x.ts — ?", ["read", "grep"], ["websearch"], "path only"],
    ["README luego grep \"TODO\" pero sin bash", ["read", "grep"], ["bash"], "ES-EN clause"],
    ["???", ["read", "question"], ["bash", "edit"], "punct short"],
    ["fix tests (no web)", ["read", "bash", "grep"], ["webfetch", "websearch"], "paren gate"],
    ["Solo mira el diff y dime si falta grep", ["read", "grep"], ["write", "bash"], "ES look"],
    ["After you read the spec, do NOT search the web", ["read", "grep"], ["webfetch", "websearch"], "neg multi"],
  ] as const
  moreEdge2.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "edge",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob", "codesearch"],
      forbidden_tools: [...forb],
      notes: `Synthetic edge extra ${i + 1}`,
    })
  })

  const multiConflict = [
    [
      "Read the router policy file, then grep for bash — do not run terminal",
      ["read", "grep"],
      ["bash"],
      "read then forbid bash",
    ],
    [
      "Busca en el repo la palabra \"deprecated\" y luego NO abras URLs",
      ["grep", "read"],
      ["webfetch", "websearch"],
      "ES grep no web",
    ],
    [
      "Semantic search for ToolRouter, then edit only if you find a typo (no write)",
      ["codesearch", "read", "edit"],
      ["write", "websearch"],
      "cs then edit gate",
    ],
  ] as const
  multiConflict.forEach(([prompt, req, forb], i) => {
    out.push({
      category: "multi_clause",
      prompt,
      agent: build,
      available_tools: palette,
      required_tools: [...req],
      allowed_tools: ["glob"],
      forbidden_tools: [...forb],
      notes: `Synthetic multi conflicting signals ${i + 1}`,
    })
  })

  return out
}

export function buildSyntheticRows(): RouterEvalRow[] {
  const specs = buildSyntheticSpecs()
  return specs.map((s, i) => synth(s, i))
}

export function tagSeedRows(rows: RouterEvalRow[]): RouterEvalRow[] {
  return rows.map((r) => ({
    ...r,
    source: "seed" as RouterEvalSource,
    category: r.category ?? "seed",
  }))
}

export type ExpandManifest = {
  row_count: number
  by_source: Record<string, number>
  by_category: Record<string, number>
  required_tool_counts: Record<string, number>
  forbidden_tool_counts: Record<string, number>
  en_es_rough: { es_hint: number; en_hint: number; unknown: number }
}

export type ExpandManifestExtended = ExpandManifest & {
  by_confidence: Record<string, number>
  reviewed_true: number
  category_vs_floor: Record<string, { floor: number; actual: number; gap: number }>
  underrepresented_categories: string[]
  review_candidate_count: number
}

export function computeManifest(rows: RouterEvalRow[]): ExpandManifest {
  const by_source: Record<string, number> = {}
  const by_category: Record<string, number> = {}
  const required_tool_counts: Record<string, number> = {}
  const forbidden_tool_counts: Record<string, number> = {}
  let es = 0
  let en = 0
  let unk = 0

  const esRe = /[áéíóúñü¿¡]|\b(el|la|los|las|un|una|para|luego|dónde|cómo|qué|busca|ejecuta|corrige|crea|lee|solo|gracias|hola)\b/i

  for (const r of rows) {
    const src = r.source ?? "unspecified"
    by_source[src] = (by_source[src] ?? 0) + 1
    const cat = r.category ?? "uncategorized"
    by_category[cat] = (by_category[cat] ?? 0) + 1
    for (const t of r.required_tools) required_tool_counts[t] = (required_tool_counts[t] ?? 0) + 1
    for (const t of r.forbidden_tools ?? []) forbidden_tool_counts[t] = (forbidden_tool_counts[t] ?? 0) + 1

    const p = r.prompt
    if (esRe.test(p)) es++
    else if (/[a-zA-Z]{3,}/.test(p)) en++
    else unk++
  }

  return {
    row_count: rows.length,
    by_source,
    by_category,
    required_tool_counts,
    forbidden_tool_counts,
    en_es_rough: { es_hint: es, en_hint: en, unknown: unk },
  }
}

/** Category order for satisfying floors before caps (weak routing categories first after seed). */
export const FLOOR_SATISFY_ORDER = [
  "seed",
  "conflict_gate",
  "task_skill",
  "edge",
  "edit_write",
  "multi_clause",
  "bash_gate",
  "web_pair",
  "grep_codesearch",
  "conversation",
  "sampled_heuristic",
  "uncategorized",
] as const

/** Minimum rows per category when the merged pool contains enough distinct rows. */
export const DEFAULT_CATEGORY_FLOORS: Partial<Record<string, number>> = {
  seed: 57,
  conflict_gate: 12,
  task_skill: 10,
  edge: 14,
  edit_write: 18,
  multi_clause: 22,
  bash_gate: 22,
  web_pair: 18,
  grep_codesearch: 18,
  conversation: 28,
  sampled_heuristic: 0,
}

/** Maximum rows per category after floors (tail trim). */
export const DEFAULT_CATEGORY_CAPS: Partial<Record<string, number>> = {
  seed: 57,
  conflict_gate: 22,
  task_skill: 18,
  edge: 28,
  edit_write: 32,
  multi_clause: 95,
  bash_gate: 52,
  web_pair: 42,
  grep_codesearch: 42,
  conversation: 72,
  sampled_heuristic: 165,
  uncategorized: 500,
}

export function balanceByFloorsAndCaps(
  rows: RouterEvalRow[],
  floors: Partial<Record<string, number>>,
  caps: Partial<Record<string, number>>,
): RouterEvalRow[] {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const byBucket = new Map<string, RouterEvalRow[]>()
  for (const r of sorted) {
    const c = r.category ?? "uncategorized"
    if (!byBucket.has(c)) byBucket.set(c, [])
    byBucket.get(c)!.push(r)
  }
  const used = new Set<string>()
  const out: RouterEvalRow[] = []
  const floorOrder = FLOOR_SATISFY_ORDER as readonly string[]
  const restKeys = [...byBucket.keys()].sort((a, b) => a.localeCompare(b))
  const order = [...floorOrder.filter((k) => restKeys.includes(k)), ...restKeys.filter((k) => !floorOrder.includes(k))]

  for (const cat of order) {
    const f = floors[cat]
    if (f === undefined || f <= 0) continue
    const bucket = byBucket.get(cat) ?? []
    let taken = 0
    for (const r of bucket) {
      if (taken >= f) break
      if (used.has(r.id)) continue
      used.add(r.id)
      out.push(r)
      taken++
    }
  }

  const rest = sorted.filter((r) => !used.has(r.id))
  const counts = new Map<string, number>()
  for (const r of out) {
    const c = r.category ?? "uncategorized"
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }

  for (const r of rest) {
    const c = r.category ?? "uncategorized"
    const cap = caps[c]
    const n = counts.get(c) ?? 0
    if (cap !== undefined && n >= cap) continue
    used.add(r.id)
    out.push(r)
    counts.set(c, n + 1)
  }

  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export type ReviewCandidate = { id: string; priority: number; reasons: string[] }

export function isSyntheticReviewableRow(r: RouterEvalRow): boolean {
  if (r.source !== "synthetic") return false
  const n = r.notes ?? ""
  const p = r.prompt
  if (/filler|small-talk probe|Synthetic small-talk/i.test(n)) return false
  if (/Synthetic small-talk/i.test(p)) return false
  return true
}

/** Deterministic high-priority rows for manual label review (not gold). */
export function selectReviewCandidates(rows: RouterEvalRow[]): ReviewCandidate[] {
  const out: ReviewCandidate[] = []
  for (const r of rows) {
    const reasons: string[] = []
    let priority = 0
    if (r.source === "sampled_heuristic") {
      priority += 40
      reasons.push("sampled_heuristic")
    }
    if (r.prompt.trim().length < 28) {
      priority += 25
      reasons.push("short_prompt")
    }
    const reqN = r.required_tools.length
    const allowN = r.allowed_tools?.length ?? 0
    if (reqN >= 3) {
      priority += 15
      reasons.push("many_required")
    }
    if (allowN >= 4) {
      priority += 10
      reasons.push("wide_allowed")
    }
    if (r.category === "edge" || r.category === "conflict_gate") {
      priority += 12
      reasons.push("weak_category")
    }
    if (/luego|then|y después|after you|first .* then/i.test(r.prompt)) {
      priority += 8
      reasons.push("multi_clause_shape")
    }
    if (priority < 30) continue
    out.push({ id: r.id, priority, reasons: [...new Set(reasons)].sort() })
  }
  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
}

const REVIEWED_SYNTH_PER_CAT = 9
const REVIEWED_MAX_TOTAL = 150
const REVIEWED_MIN_TOTAL = 80

/** Curated regression subset: all seed + capped non-filler synthetic (no sampled_heuristic). */
export function buildReviewedSubset(rows: RouterEvalRow[]): RouterEvalRow[] {
  const seed = rows
    .filter((r) => r.source === "seed")
    .map((r) => ({ ...r, confidence: "high" as RouterEvalConfidence, reviewed: true }))

  const synth = rows
    .filter((r) => r.source === "synthetic" && isSyntheticReviewableRow(r))
    .sort((a, b) => a.id.localeCompare(b.id))

  const byCat = new Map<string, RouterEvalRow[]>()
  for (const r of synth) {
    const c = r.category ?? "uncategorized"
    if (!byCat.has(c)) byCat.set(c, [])
    byCat.get(c)!.push(r)
  }

  const picked: RouterEvalRow[] = []
  for (const [, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const r of list.slice(0, REVIEWED_SYNTH_PER_CAT)) {
      picked.push({ ...r, confidence: "medium", reviewed: true })
    }
  }

  let combined = [...seed, ...picked].sort((a, b) => a.id.localeCompare(b.id))
  if (combined.length > REVIEWED_MAX_TOTAL) combined = combined.slice(0, REVIEWED_MAX_TOTAL)

  if (combined.length < REVIEWED_MIN_TOTAL) {
    const extra = synth
      .filter((r) => !combined.some((x) => x.id === r.id))
      .slice(0, REVIEWED_MIN_TOTAL - combined.length)
      .map((r) => ({ ...r, confidence: "medium" as RouterEvalConfidence, reviewed: true }))
    combined = [...combined, ...extra].sort((a, b) => a.id.localeCompare(b.id))
    if (combined.length > REVIEWED_MAX_TOTAL) combined = combined.slice(0, REVIEWED_MAX_TOTAL)
  }

  return combined
}

export function computeManifestExtended(
  rows: RouterEvalRow[],
  floors: Partial<Record<string, number>>,
): ExpandManifestExtended {
  const base = computeManifest(rows)
  const by_confidence: Record<string, number> = {}
  let reviewed_true = 0
  for (const r of rows) {
    const conf = r.confidence ?? "unspecified"
    by_confidence[conf] = (by_confidence[conf] ?? 0) + 1
    if (r.reviewed === true) reviewed_true++
  }

  const category_vs_floor: Record<string, { floor: number; actual: number; gap: number }> = {}
  const underrepresented_categories: string[] = []
  const cats = new Set([...Object.keys(base.by_category), ...Object.keys(floors)])
  for (const c of [...cats].sort()) {
    const floor = floors[c] ?? 0
    const actual = base.by_category[c] ?? 0
    const gap = floor > 0 ? Math.max(0, floor - actual) : 0
    if (floor > 0) category_vs_floor[c] = { floor, actual, gap }
    if (gap > 0) underrepresented_categories.push(c)
  }

  const candidates = selectReviewCandidates(rows)
  return {
    ...base,
    by_confidence,
    reviewed_true,
    category_vs_floor,
    underrepresented_categories,
    review_candidate_count: candidates.length,
  }
}

/** Balance by trimming excess rows per category toward targets (deterministic: drop from end). */
export function balanceByCategory(
  rows: RouterEvalRow[],
  caps: Partial<Record<ExpandCategory | "seed" | "sampled_heuristic" | "uncategorized", number>>,
): RouterEvalRow[] {
  const keys = Object.keys(caps) as (keyof typeof caps)[]
  if (keys.length === 0) return rows
  const counts: Record<string, number> = {}
  const kept: RouterEvalRow[] = []
  for (const r of rows) {
    const cat = (r.category ?? "uncategorized") as string
    const cap = caps[cat as keyof typeof caps]
    const n = counts[cat] ?? 0
    if (cap !== undefined && n >= cap) continue
    counts[cat] = n + 1
    kept.push(r)
  }
  return kept
}
