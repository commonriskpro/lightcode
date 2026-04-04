/**
 * Deterministic policy after embedding/rule candidates: hard gates, conflicts,
 * minimal dependencies, minimum-set bias. Keeps offline router precise.
 */

const STRONG_CONNECTORS = [
  /\s+and\s+then\s+/i,
  /\s+y\s+luego\s+/i,
  /\s+then\s+/i,
  /\s+after\s+that\s+/i,
  /\s+y\s+después\s+/i,
  /\s+después\s+de\s+eso\s+/i,
  /\s+después\s+/i,
  /\s+luego\s+/i,
  /\s*,\s*and\s+/i,
  /\s*;\s+/,
] as const

/** Split multi-action prompts on strong connectors (EN/ES). Conservative: no bare " y ". */
export function splitClauses(text: string): string[] {
  const t = text.trim()
  if (t.length < 6) return [t]
  let parts: string[] = [t]
  for (const re of STRONG_CONNECTORS) {
    const next: string[] = []
    for (const p of parts) {
      next.push(
        ...p
          .split(re)
          .map((x) => x.trim())
          .filter(Boolean),
      )
    }
    parts = next
    if (parts.length > 1) break
  }
  const cap = 6
  return parts.length > cap ? [t] : parts.length ? parts : [t]
}

export type LexicalSignals = {
  hasUrl: boolean
  strongBash: boolean
  strongEdit: boolean
  strongWrite: boolean
  strongModify: boolean
  /** ES/EN delete file or rm — not covered by English-only strongEdit. */
  strongDelete: boolean
  webResearch: boolean
  literalSearch: boolean
  semanticSearch: boolean
  todoIntent: boolean
  questionIntent: boolean
  codesearchIntent: boolean
}

/** User explicitly forbids web search / fetch — do not treat as web-research intent. */
function negatesWebResearch(text: string): boolean {
  const u = text
  return (
    /\bnever\s+use\s+web\s+search\b/i.test(u) ||
    /\bdon'?t\s+use\s+web\s+search\b/i.test(u) ||
    /\bdo\s+not\s+use\s+web\s+search\b/i.test(u) ||
    /\b(never|no|don't|do not|sin)\s+(?:usar\s+)?(?:web\s+search|websearch|la\s+búsqueda\s+web)\b/i.test(u) ||
    /\bonly\s+use\s+the\s+repo\b/i.test(u) ||
    /\bwithout\s+(?:opening\s+)?urls?\b/i.test(u) ||
    /\bnunca\s+uses\s+web\b/i.test(u) ||
    /\bsin\s+(?:usar\s+)?(?:web|internet|urls?)\b/i.test(u)
  )
}

/** OR lexical cues across clauses so a multi-step prompt keeps edit/write/bash when one clause carries the verb. */
export function lexicalSignalsMerged(fullText: string, clauses: string[]): LexicalSignals {
  if (clauses.length <= 1) return lexicalSignals(fullText)
  const acc = lexicalSignals(fullText)
  for (const c of clauses) {
    const s = lexicalSignals(c)
    acc.hasUrl = acc.hasUrl || s.hasUrl
    acc.strongBash = acc.strongBash || s.strongBash
    acc.strongEdit = acc.strongEdit || s.strongEdit
    acc.strongWrite = acc.strongWrite || s.strongWrite
    acc.strongModify = acc.strongModify || s.strongModify
    acc.strongDelete = acc.strongDelete || s.strongDelete
    acc.webResearch = acc.webResearch || s.webResearch
    acc.literalSearch = acc.literalSearch || s.literalSearch
    acc.semanticSearch = acc.semanticSearch || s.semanticSearch
    acc.todoIntent = acc.todoIntent || s.todoIntent
    acc.questionIntent = acc.questionIntent || s.questionIntent
    acc.codesearchIntent = acc.codesearchIntent || s.codesearchIntent
  }
  return acc
}

export function lexicalSignals(text: string): LexicalSignals {
  const u = text
  /** Bare "internet" / "en internet" are not enough; require search/doc/research phrasing (see tool-router web/research RULE). */
  const webResearchPos =
    !negatesWebResearch(u) &&
    (/\b(search\s+the\s+web|web\s+search|look\s+up\s+online|documentaci[oó]n\s+(oficial|online|externa|pública)|documentaci[oó]n\s+sobre|documentaci[oó]n\s+de\b|wikipedia|investigaci[oó]n|research\s+on|third[- ]party|external\s+(api|tool|library)|busca\s+en\s+(?:internet|la\s+web)|buscar\s+en\s+(?:internet|la\s+web)|busca\s+documentaci[oó]n\s+oficial)\b/i.test(
      u,
    ) ||
      /\blook\s+up\b.*\bonline\b/i.test(u))
  return {
    hasUrl: /https?:\/\/[^\s]+|www\.[^\s]+/i.test(u),
    strongBash:
      /\b(run|execute|npm|pnpm|yarn|bun|cargo|make|test|build|shell|bash|terminal|typecheck|jest|vitest|mocha|pytest|cargo test|compile|install|pnpm|git\s+(?:status|push|pull|commit|rebase|checkout|fetch)|ejecuta|ejecutar|tests\s+failing)\b/i.test(
        u,
      ),
    strongWrite:
      (/\b(create|new file|scaffold|new component|add file|add\s+a\s+unit\s+test\s+file|create\s+a\s+new\s+test\s+file|finalize\s+the\s+plan\s+document|write\s+(?:a|the|to)|from scratch|crear\s+(?:un|una|archivo)|crea\s+un\s+archivo|cr[eé]ame\s+un\s+archivo|creame\s+un\s+archivo|haceme\s+un\s+archivo|hazme\s+un\s+archivo|archivo\s+que\s+se\s+llame|un\s+archivo\s+que\s+se\s+llame|create\s+a\s+file\s+(?:named|called)|create\s+a\s+file\s+in\s+the\s+repo\s+root|create\s+a\s+new\s+markdown\s+file|create\s+a\s+new\s+file\s+in\s+the\s+repo\s+root|nuevo\s+archivo|documenta\s+(?:la|el|los|un|una)|documentar\s+(?:en|la|el))\b/i.test(
        u,
      ) ||
        (/\b(?:en\s+el\s+root\s+del\s+repo|at\s+the\s+repo\s+root|in\s+the\s+repo\s+root|en\s+la\s+raíz\s+del\s+repositorio|en\s+la\s+raíz)\b/i.test(u) &&
          /\b(?:archivo|file|\.md|llame|named|called)\b/i.test(u))),
    strongEdit:
      /\b(edit|edits|patch|refactor|change|update|modify|fix|rename|move|delete|remove|replace|apply\s+edits|search_replace|implement\s+in\s+|implementa|corrige|corrígelo|arregla|arreglalo|reescribe|renombra|añade\s+jsdoc|add\s+jsdoc)\b/i.test(u),
    strongModify:
      /\b(edit|patch|refactor|fix|change|modify|update|delete|remove|move|rename|implement|write|create)\b/i.test(u),
    webResearch: webResearchPos,
    literalSearch:
      /\b(grep|ripgrep|regex|pattern|symbol|string literal|TODO|FIXME|exact\s+match)\b/i.test(u) ||
      /['"`][^'"`]{2,}['"`]/.test(u) ||
      (/¿qué\s+hace/i.test(u) && /\b(?:en este repo|in this repo)\b/i.test(u)),
    semanticSearch:
      /\b(code\s*search|codesearch|semantic|conceptual|find\s+by\s+meaning|by\s+meaning\b|por\s+significado|explica\s+el\s+flujo|search\s+the\s+codebase\s+for|where\s+we\s+handle|where\s+is\s+.*\s+implemented|how\s+does\s+.*\s+work)\b/i.test(
        u,
      ),
    todoIntent: /\b(todo\s+list|task\s+list|checklist|mark\s+(?:done|todo)|todowrite)\b/i.test(u),
    questionIntent:
      /\b(which\s+option|choose\s+(?:one|between)|pick\s+(?:A|B)|should\s+I\s+use|or\s+\w+\s*\?)\b/i.test(u) ||
      /\?\s*$/.test(u.trim()) ||
      /^\s*¿\s*\?/i.test(u.trim()) ||
      /^this\s*\(/i.test(u.trim()) ||
      /^ask\s+me\b/i.test(u.trim()) ||
      /^pregúntame\b/i.test(u.trim()),
    codesearchIntent:
      /\b(code\s*search|codesearch|semantic\s+(?:search|codebase)|busqueda\s+semantica|búsqueda\s+sem[aá]ntica|find\s+by\s+meaning|por\s+significado|search\s+the\s+codebase\s+for)\b/i.test(
        u,
      ),
    strongDelete:
      /\b(borr(?:a|alo|ala|ar|as|ame|án|an|ad|adlo|adla|e|es|en|emos)|elimin(?:a|ar|alo|ala|me)?|suprim|rm\s+[-\w./]|unlink|delete\s+(?:this|the|that)\s+file|remove\s+(?:this|the|that)\s+file|(?:delete|remove)\s+it\b)\b/i.test(
        u,
      ) || /^(borralo|borrala|borralos|borralas|eliminalo|elimínalo|borrálo|borrála)\b/i.test(u.trim()),
  }
}

const BASH_ALLOW = (t: string) =>
  /\b(run|execute|npm|pnpm|yarn|bun|cargo|make|test|build|shell|bash|terminal|compile|install|typecheck|jest|vitest|mocha|pytest|ejecuta|ejecutar)\b/i.test(
    t,
  ) ||
  /\bgit\s+(?:status|push|pull|commit|rebase|checkout|fetch|clone|merge)\b/i.test(t) ||
  /\b(?:rename|move)\s+\S+\s+to\s+\S+/i.test(t) ||
  /\b(?:delete|remove)\s+(?:the\s+)?(?:temporary\s+)?(?:folder|directory)\b/i.test(t)

/** User forbids delegating to a subagent — strip task from merged ids. */
export function negatesTaskDelegation(text: string): boolean {
  const u = text
  return (
    /\bdo\s+not\s+spawn\s+(?:a\s+)?subagent\b/i.test(u) ||
    /\bnever\s+spawn\s+(?:a\s+)?subagent\b/i.test(u) ||
    /\bno\s+delegation\b/i.test(u) ||
    /\bno\s+subagent\b/i.test(u)
  )
}

/** Matches the same research phrasing used for websearch hard gate (minus intent embed). */
function webResearchTextOk(text: string): boolean {
  return (
    /\b(search|lookup|find)\s+(?:on\s+)?(?:the\s+)?(?:web|internet|online)\b/i.test(text) ||
    /\b(documentation|docs|reference)\s+(?:for|about|on)\b/i.test(text) ||
    /\b(busca|buscar)\s+en\s+(?:internet|la\s+web)\b/i.test(text) ||
    /\blook\s+up\s+online\b/i.test(text) ||
    /\bdocumentaci[oó]n\s+(oficial|online|externa|pública)\b/i.test(text) ||
    /\bdocumentaci[oó]n\s+sobre\b/i.test(text) ||
    /\bbusca\s+documentaci[oó]n\b/i.test(text)
  )
}

function forbidsShellExecution(text: string): boolean {
  return (
    /\b(?:do\s+not|don'?t|never)\s+(?:run|use|open)\s+(?:the\s+)?(?:terminal|shell)\b/i.test(text) ||
    /\b(?:do\s+not|don'?t)\s+run\b/i.test(text) ||
    /\(don'?t\s+run\s+it\)/i.test(text) ||
    /\bno\s+execution\b/i.test(text) ||
    /\bno\s+git\s+commands\b/i.test(text) ||
    /\bsolo\s+lectura\b/i.test(text) ||
    /\bsolo\s+explica\b/i.test(text) ||
    /\bsin\s+ejecutar\s+nada\b/i.test(text) ||
    /\bno\s+(?:usar|ejecutar|correr)\s+(?:la\s+)?(?:terminal|shell|consola)\b/i.test(text) ||
    /\bsin\s+(?:usar|ejecutar)\s+(?:la\s+)?(?:terminal|shell)\b/i.test(text)
  )
}

/** True when offline intent embed selected web/url or web/research (trust web tools vs lexical-only gates). */
export function isWebIntentEmbed(primary: string, labels?: string[]): boolean {
  const w = (l: string) => l === "web/url" || l === "web/research"
  if (w(primary)) return true
  return labels?.some(w) ?? false
}

function applyHardGates(
  ids: Set<string>,
  text: string,
  sig: LexicalSignals,
  multiClause?: boolean,
  intentEmbedWeb?: boolean,
): Set<string> {
  const out = new Set(ids)
  if (out.has("task") && negatesTaskDelegation(text)) out.delete("task")

  if (out.has("bash")) {
    const listOrGlobListing =
      /\blist\b.*\bfiles?\s+under\b/i.test(text) ||
      /\blist\s+\*?\./i.test(text) ||
      /\blist\s+\w+\s+files?\s+in\b/i.test(text) ||
      /\bglob\s+pattern\b/i.test(text) ||
      /\blist\s+markdown\s+files\b/i.test(text)
    if (listOrGlobListing) out.delete("bash")
    else if (forbidsShellExecution(text)) out.delete("bash")
    else if (!sig.strongBash && !BASH_ALLOW(text) && !sig.strongDelete) out.delete("bash")
  }

  if (out.has("edit") && !sig.strongEdit && !sig.strongModify && !sig.strongDelete) {
    if (!(multiClause && sig.strongWrite)) out.delete("edit")
  }
  if (out.has("write") && !sig.strongWrite && !sig.strongModify) out.delete("write")

  if (out.has("webfetch")) {
    const ok =
      intentEmbedWeb ||
      sig.hasUrl ||
      /\b(fetch|curl|download)\s+(?:the\s+)?(?:page|url|site|content)\b/i.test(text) ||
      sig.webResearch ||
      webResearchTextOk(text)
    if (!ok) out.delete("webfetch")
  }

  if (out.has("websearch")) {
    const ok =
      intentEmbedWeb ||
      sig.webResearch ||
      /\b(search|lookup|find)\s+(?:on\s+)?(?:the\s+)?(?:web|internet|online)\b/i.test(text) ||
      /\b(documentation|docs|reference)\s+(?:for|about|on)\b/i.test(text) ||
      /\b(busca|buscar)\s+en\s+(?:internet|la\s+web)\b/i.test(text) ||
      /\blook\s+up\s+online\b/i.test(text) ||
      /\bdocumentaci[oó]n\s+(oficial|online|externa|pública)\b/i.test(text) ||
      /\bdocumentaci[oó]n\s+sobre\b/i.test(text) ||
      /\bbusca\s+documentaci[oó]n\b/i.test(text)
    if (!ok) out.delete("websearch")
  }

  if (negatesWebResearch(text)) {
    out.delete("websearch")
    out.delete("webfetch")
  }

  if (out.has("question") && !sig.questionIntent) out.delete("question")

  if (out.has("todowrite") && !sig.todoIntent) out.delete("todowrite")

  if (out.has("codesearch") && !sig.codesearchIntent && !sig.semanticSearch) out.delete("codesearch")

  return out
}

function resolveConflicts(
  ids: Set<string>,
  text: string,
  sig: LexicalSignals,
  multiClause?: boolean,
  intentEmbedWeb?: boolean,
): Set<string> {
  const out = new Set(ids)
  if (out.has("webfetch") && out.has("websearch")) {
    const researchPhrasing =
      intentEmbedWeb === true ||
      sig.webResearch ||
      webResearchTextOk(text) ||
      /\b(search|find|lookup|busca|buscar|web\s+search|investigaci[oó]n|research\s+on|third[- ]party|external\s+(api|tool|library))\b/i.test(
        text,
      )
    const pureUrlFetch = sig.hasUrl && !researchPhrasing
    if (pureUrlFetch) out.delete("websearch")
  }

  if (out.has("edit") && out.has("write")) {
    if (multiClause && sig.strongWrite) {
      /* read/review then document: create/implement often needs both */
    } else if (sig.strongWrite && !sig.strongEdit) out.delete("edit")
    else if (sig.strongEdit && !sig.strongWrite) out.delete("write")
    else if (sig.strongWrite) out.delete("edit")
    else out.delete("write")
  }

  if (out.has("grep") && out.has("codesearch")) {
    if (/\bsearch\s+the\s+codebase\s+for\b/i.test(text)) {
      /* keep both: codebase search for a symbol then summarize */
    } else if (sig.literalSearch || /\b(string|pattern|regex|symbol)\b/i.test(text)) out.delete("codesearch")
    else if (sig.semanticSearch || sig.codesearchIntent) out.delete("grep")
    else out.delete("codesearch")
  }

  return out
}

function addReadDeps(ids: Set<string>, available: Set<string>): Set<string> {
  const out = new Set(ids)
  const needs = ["edit", "write", "grep", "codesearch", "glob"].some((k) => out.has(k))
  if (needs && available.has("read")) out.add("read")
  return out
}

/** Priority for trimming extras (keep low index = higher priority). */
const PRIORITY: string[] = [
  "read",
  "task",
  "skill",
  "grep",
  "glob",
  "codesearch",
  "edit",
  "write",
  "bash",
  "webfetch",
  "websearch",
  "question",
  "todowrite",
  "apply_patch",
  "batch",
  "lsp",
  "plan_exit",
]

function rank(id: string): number {
  const i = PRIORITY.indexOf(id)
  return i === -1 ? PRIORITY.length + 1 : i
}

/** Sort ids by policy priority, then stable for unknowns. */
export function orderByPolicy(ids: string[]): string[] {
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Trim to max while keeping priority order; prefer dropping low-priority first. */
export function trimToMax(ids: string[], max: number): string[] {
  if (ids.length <= max) return ids
  const ordered = orderByPolicy(ids)
  return ordered.slice(0, max)
}

export type RouterPolicyInput = {
  ids: Set<string>
  text: string
  /** Full prompt (for signals); may equal text for single-clause. */
  fullText: string
  /** When set (e.g. from splitClauses), OR per-clause signals for hard gates. */
  clauses?: string[]
  available: Set<string>
  max: number
  /** Intent embed classified web/url or web/research — do not strip websearch/webfetch for weak "internet" phrasing alone. */
  intentEmbedWeb?: boolean
  /** When false, skip applyHardGates (default true). */
  applyHardGates?: boolean
}

export function applyRouterPolicy(input: RouterPolicyInput): string[] {
  const multi = !!(input.clauses && input.clauses.length > 1)
  const sig = multi ? lexicalSignalsMerged(input.fullText, input.clauses!) : lexicalSignals(input.fullText)
  const intentEmbed = input.intentEmbedWeb === true
  let s = new Set(input.ids)
  if (sig.hasUrl && s.has("websearch") && !s.has("webfetch") && input.available.has("webfetch")) {
    s.add("webfetch")
  }
  const expandWeb =
    intentEmbed ||
    sig.webResearch ||
    sig.hasUrl ||
    webResearchTextOk(input.fullText)
  if ((s.has("websearch") || s.has("webfetch")) && expandWeb) {
    if (input.available.has("webfetch")) s.add("webfetch")
    if (input.available.has("websearch")) s.add("websearch")
  }
  if (input.applyHardGates !== false) {
    s = applyHardGates(s, input.fullText, sig, multi, intentEmbed)
  }
  s = resolveConflicts(s, input.fullText, sig, multi, intentEmbed)
  s = addReadDeps(s, input.available)
  const filtered = [...s].filter((id) => input.available.has(id))
  const ordered = orderByPolicy(filtered)
  return trimToMax(ordered, input.max)
}
