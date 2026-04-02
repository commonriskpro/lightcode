/** Post-processing for embed-ranked tools: exact-match-oriented filters (no fixed top-k cap). */

export type ExactMatchFlags = {
  dynamic_ratio?: boolean
  per_tool_min?: boolean
  intent_gating?: boolean
  redundancy?: boolean
  calibration?: boolean
  two_pass?: boolean
}

const PER_TOOL_MIN: Record<string, number> = {
  write: 0.4,
  edit: 0.38,
  bash: 0.42,
  read: 0.3,
  websearch: 0.3,
  webfetch: 0.3,
  glob: 0.28,
  grep: 0.28,
  task: 0.32,
  skill: 0.32,
  todowrite: 0.32,
  question: 0.32,
  codesearch: 0.32,
}

export function compositeIntent(userText: string, intentLabel?: string) {
  if (intentLabel?.includes("/")) return true
  return /\b(and|y luego|then|y después|luego|and then|después)\b/i.test(userText)
}

function calibrate(s: number) {
  return 1 / (1 + Math.exp(-14 * (s - 0.32)))
}

export function applyIntentGating(
  scored: { id: string; score: number }[],
  intentLabel: string | undefined,
  userText: string,
) {
  if (!intentLabel?.startsWith("web/")) return scored
  const strong = /\b(edit|patch|bash|run|npm|pnpm|bun|refactor|implement|refactoriza)\b/i.test(userText)
  if (strong) return scored
  return scored.map((row) => {
    if (row.id === "edit" || row.id === "bash") return { ...row, score: row.score * 0.55 }
    return row
  })
}

export function applyPerToolMin(scored: { id: string; score: number }[], globalMin: number) {
  return scored.filter((row) => row.score >= (PER_TOOL_MIN[row.id] ?? globalMin))
}

export function applyCalibration(scored: { id: string; score: number }[]) {
  return scored.map((row) => ({ ...row, score: calibrate(row.score) }))
}

export function dedupeWebPair(
  ids: string[],
  scored: Map<string, number>,
  userText: string,
) {
  if (!ids.includes("websearch") || !ids.includes("webfetch")) return ids
  const hasUrl = /https?:\/\//i.test(userText)
  const a = scored.get("websearch") ?? 0
  const b = scored.get("webfetch") ?? 0
  if (!hasUrl && Math.abs(a - b) < 0.09) return ids.filter((x) => x !== "webfetch")
  return ids
}

export function twoPassConsistency(ids: string[], userText: string) {
  let out = [...ids]
  if (out.includes("bash") && !/\b(run|execute|npm|pnpm|yarn|bun|cargo|make|test|build|shell)\b/i.test(userText)) {
    out = out.filter((x) => x !== "bash")
  }
  return out
}

export function effectiveAutoRatio(
  baseRatio: number,
  userText: string,
  intentLabel: string | undefined,
  exact?: ExactMatchFlags,
) {
  if (!exact?.dynamic_ratio) return baseRatio
  return compositeIntent(userText, intentLabel) ? 0.82 : 0.92
}
