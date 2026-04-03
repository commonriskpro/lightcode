/** Offline router eval dataset (JSONL lines). */

export type RouterEvalSource = "seed" | "synthetic" | "sampled_heuristic"

export type RouterEvalConfidence = "high" | "medium" | "low"

export type RouterEvalRow = {
  id: string
  prompt: string
  agent: string
  available_tools: string[]
  required_tools: string[]
  allowed_tools?: string[]
  forbidden_tools?: string[]
  /** If set, row is treated as conversation-tier expectation (empty tools expected). */
  expect_conversation?: boolean
  notes?: string
  /** Dataset provenance (expand pipeline). */
  source?: RouterEvalSource
  /** High-level scenario tag for balancing and analysis. */
  category?: string
  /** Label confidence (reviewed subset uses high/medium; sampled_heuristic is typically omitted or low). */
  confidence?: RouterEvalConfidence
  /** Curated regression rows (reviewed JSONL); not set on heuristic bulk rows. */
  reviewed?: boolean
}

export function parseRouterEvalLine(line: string): RouterEvalRow | undefined {
  const t = line.trim()
  if (!t || t.startsWith("#")) return undefined
  const o = JSON.parse(t) as Record<string, unknown>
  if (typeof o.id !== "string" || typeof o.prompt !== "string") return undefined
  if (typeof o.agent !== "string") return undefined
  if (!Array.isArray(o.available_tools) || !o.available_tools.every((x) => typeof x === "string"))
    return undefined
  if (!Array.isArray(o.required_tools) || !o.required_tools.every((x) => typeof x === "string"))
    return undefined
  const row: RouterEvalRow = {
    id: o.id,
    prompt: o.prompt,
    agent: o.agent,
    available_tools: o.available_tools as string[],
    required_tools: o.required_tools as string[],
  }
  if (Array.isArray(o.allowed_tools) && o.allowed_tools.every((x) => typeof x === "string"))
    row.allowed_tools = o.allowed_tools as string[]
  if (Array.isArray(o.forbidden_tools) && o.forbidden_tools.every((x) => typeof x === "string"))
    row.forbidden_tools = o.forbidden_tools as string[]
  if (typeof o.expect_conversation === "boolean") row.expect_conversation = o.expect_conversation
  if (typeof o.notes === "string") row.notes = o.notes
  if (o.source === "seed" || o.source === "synthetic" || o.source === "sampled_heuristic") row.source = o.source
  if (typeof o.category === "string") row.category = o.category
  if (o.confidence === "high" || o.confidence === "medium" || o.confidence === "low") row.confidence = o.confidence
  if (typeof o.reviewed === "boolean") row.reviewed = o.reviewed
  return row
}

export function loadRouterEvalJsonl(raw: string): RouterEvalRow[] {
  const out: RouterEvalRow[] = []
  for (const line of raw.split(/\r?\n/)) {
    const row = parseRouterEvalLine(line)
    if (row) out.push(row)
  }
  return out
}
