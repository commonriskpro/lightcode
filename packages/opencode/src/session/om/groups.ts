import { Identifier } from "@/id/id"

export type ObservationGroup = { id: string; range: string; content: string }

const TAG = /<observation-group\s([^>]*)>([\s\S]*?)<\/observation-group>/g
const ATTR = /([\w][\w-]*)="([^"]*)"/g
const GROUP_SPLIT = /^##\s+Group\s+/m

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR)) {
    if (m[1] && m[2] !== undefined) out[m[1]] = m[2]
  }
  return out
}

export function wrapInObservationGroup(obs: string, range: string, id?: string): string {
  const anchor = id ?? Identifier.ascending("session").slice(0, 16)
  return `<observation-group id="${anchor}" range="${range}">\n${obs.trim()}\n</observation-group>`
}

export function parseObservationGroups(text: string): ObservationGroup[] {
  if (!text) return []
  const groups: ObservationGroup[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(TAG.source, TAG.flags)
  while ((m = re.exec(text)) !== null) {
    const a = attrs(m[1] ?? "")
    if (a.id && a.range) groups.push({ id: a.id, range: a.range, content: (m[2] ?? "").trim() })
  }
  return groups
}

export function stripObservationGroups(text: string): string {
  if (!text) return text
  return text
    .replace(new RegExp(TAG.source, TAG.flags), (_m, _a, c: string) => c.trim())
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function renderObservationGroupsForReflection(text: string): string {
  const groups = parseObservationGroups(text)
  if (!groups.length) return text
  const lookup = new Map(groups.map((g) => [g.content.trim(), g]))
  return text
    .replace(new RegExp(TAG.source, TAG.flags), (_m, _a: string, c: string) => {
      const g = lookup.get(c.trim())
      if (!g) return c.trim()
      return `## Group \`${g.id}\`\n_range: \`${g.range}\`_\n\n${g.content}`
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function reconcileObservationGroupsFromReflection(reflected: string, source: string): string {
  const groups = parseObservationGroups(source)
  if (!groups.length) return reflected
  if (!reflected.trim()) return reflected

  // Try structured split by ## Group headings
  const sections = reflected
    .trim()
    .split(GROUP_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sections.length > 1) {
    // Reflector preserved group structure — re-wrap each section
    const wrapped = sections.map((sec, i) => {
      const nl = sec.indexOf("\n")
      const heading = (nl >= 0 ? sec.slice(0, nl) : sec).trim()
      const body = (nl >= 0 ? sec.slice(nl + 1) : "").replace(/^_range:\s*`[^`]*`_\s*\n?/m, "").trim()

      // Match heading id to source group
      const id = heading.match(/`([^`]+)`/)?.[1]?.trim() ?? `derived-${i + 1}`
      const match = groups.find((g) => g.id === id) ?? groups[Math.min(i, groups.length - 1)]
      return wrapInObservationGroup(body, match?.range ?? groups[0]!.range, id)
    })
    return wrapped.join("\n\n")
  }

  // Reflector flattened structure — line-overlap heuristic
  const lines = reflected.split("\n").filter((l) => l.trim())
  const assigned = new Map<number, string[]>()
  groups.forEach((_, i) => assigned.set(i, []))

  for (const line of lines) {
    const trimmed = line.trim()
    let best = -1
    let score = 0
    for (let i = 0; i < groups.length; i++) {
      const gl = groups[i]!.content.split("\n").map((l) => l.trim())
      const overlap = gl.filter((l) => trimmed.includes(l) || l.includes(trimmed)).length
      if (overlap > score) {
        score = overlap
        best = i
      }
    }
    if (best >= 0) {
      assigned.get(best)!.push(line)
    }
  }

  // Unassigned lines → closest group by index proximity
  const unassigned = lines.filter((l) => !Array.from(assigned.values()).flat().includes(l))
  if (unassigned.length && groups.length) {
    const target = assigned.get(groups.length - 1)!
    target.push(...unassigned)
  }

  const parts = groups
    .map((g, i) => {
      const content = assigned.get(i)!
      if (!content.length) return null
      return wrapInObservationGroup(content.join("\n"), g.range, g.id)
    })
    .filter(Boolean)

  // Fallback: wrap everything in single group spanning full range
  if (!parts.length) {
    const first = groups[0]!.range.split(":")[0]
    const last = groups[groups.length - 1]!.range.split(":").at(-1)
    const range = first && last ? `${first}:${last}` : groups[0]!.range
    return wrapInObservationGroup(reflected.trim(), range)
  }

  return parts.join("\n\n")
}
