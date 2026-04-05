# Design: Observation Groups + Recall Tool

## Technical Approach

Port Mastra's inline XML observation-group pattern adapted to LightCode conventions: pure string utilities in `om/groups.ts`, surgical integration into Observer → Reflector → system prompt pipeline, plus a new `recall` tool for source message retrieval. Groups are stored inline in the `observations` text blob — zero schema changes to `ObservationTable`. One schema addition: `first_msg_id`/`last_msg_id` on `ObservationBufferTable` to enable `OM.activate()` range tracking (REQ-2.4).

## Architecture Decisions

| ID    | Decision                                              | Alternatives                                      | Rationale                                                                                                                                                                                                                                  |
| ----- | ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-1 | Inline XML in observations string                     | Separate `group_metadata` JSON column             | Zero migration for main table; backward compat is free (`parseObservationGroups` returns `[]` for flat strings); avoids two-source-of-truth sync between column and blob                                                                   |
| ADR-2 | Line-overlap heuristic for reconciliation             | Exact string match; embedding similarity          | LLM compression rewrites lines — exact match fails. Embeddings add latency + dependency. Line-contains check is fast, stateless, and handles the common case where reflector preserves key phrases. Positional fallback catches edge cases |
| ADR-3 | Recall tool is session-scoped                         | Global message access                             | Messages queried with `eq(MessageTable.session_id, ctx.sessionID)` — prevents cross-session data leakage. Agent only sees its own conversation                                                                                             |
| ADR-4 | Nullable `first_msg_id`/`last_msg_id` on buffer table | Infer from timestamps; store in observations blob | Buffer records are the activation unit — message IDs must survive condense/merge. Nullable for backward compat with existing buffers. Timestamps can't be used for recall ranges                                                           |

## Data Flow

```
User msg → Observer.run(msgs)
               │
               ├─ parseObserverOutput(raw)
               ├─ wrapInObservationGroup(obs, "firstId:lastId")  ← NEW
               └─ stored to ObservationBufferTable (with first_msg_id, last_msg_id)

OMBuf.check() → "activate"
               │
               ├─ Observer.condense(chunks)
               ├─ wrapInObservationGroup(merged, "buf[0].first:buf[-1].last")  ← NEW
               └─ OM.upsert() → ObservationTable.observations

Reflector.run(sid)
               │
               ├─ renderObservationGroupsForReflection(observations) → LLM input  ← NEW
               ├─ LLM compresses
               ├─ reconcileObservationGroupsFromReflection(output, source)  ← NEW
               └─ OM.reflect(sid, reconciled)

SystemPrompt.observations(sid)
               │
               ├─ parseObservationGroups(body) → has groups?
               ├─ wrapObservations(body) + OBSERVATION_RETRIEVAL_INSTRUCTIONS  ← NEW
               └─ recall tool available

Agent calls recall({ range: "id1:id2" })
               │
               ├─ Parse range → [start, end]
               ├─ Query MessageTable WHERE session_id AND id BETWEEN start..end
               └─ Return formatted messages (truncated to 4000 tok budget)
```

## File Changes

| File                          | Action | Description                                                  |
| ----------------------------- | ------ | ------------------------------------------------------------ |
| `src/session/om/groups.ts`    | Create | 5 pure string utilities + `ObservationGroup` type            |
| `src/tool/recall.ts`          | Create | Recall tool — query messages by range                        |
| `src/session/om/observer.ts`  | Modify | Wrap output in group; strip groups before truncation         |
| `src/session/om/reflector.ts` | Modify | Render groups for LLM; reconcile after compression           |
| `src/session/om/record.ts`    | Modify | Wrap merged output in `activate()` with buffer range         |
| `src/session/om/index.ts`     | Modify | Re-export groups utilities                                   |
| `src/session/session.sql.ts`  | Modify | Add `first_msg_id`/`last_msg_id` to `ObservationBufferTable` |
| `src/session/system.ts`       | Modify | Inject retrieval instructions when groups present            |
| `src/tool/registry.ts`        | Modify | Register `RecallTool`                                        |

## Interfaces / Contracts

### om/groups.ts — Full Implementation

```ts
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
```

### Schema Change — ObservationBufferTable

```ts
// In session.sql.ts — add to ObservationBufferTable:
first_msg_id: text().$type<MessageID>(),
last_msg_id: text().$type<MessageID>(),
```

Migration: `bun run db generate --name add-om-buffer-msg-ids` from `packages/opencode`.

### Observer.run() Changes

```ts
// After parseObserverOutput(result.text) at line 288:
import { wrapInObservationGroup, stripObservationGroups } from "./groups"

const parsed = parseObserverOutput(result.text)
const first = input.msgs[0]?.info.id
const last = input.msgs.at(-1)?.info.id
if (first && last && parsed.observations) {
  parsed.observations = wrapInObservationGroup(parsed.observations, `${first}:${last}`)
}
return parsed

// Before truncation at line 267 — strip groups from prev:
const raw = budget === false ? input.prev : truncateObsToBudget(stripObservationGroups(input.prev), budget ?? 2000)
const prev = raw
```

### OM.activate() Changes

```ts
// In record.ts activate() — after condense:
import { wrapInObservationGroup } from "./groups"

const merged = await Observer.condense(chunks, rec?.observations ?? undefined)
const first = bufs[0]!
const last = bufs[bufs.length - 1]!
const range = first.first_msg_id && last.last_msg_id ? `${first.first_msg_id}:${last.last_msg_id}` : ""
const wrapped = range ? wrapInObservationGroup(merged, range) : merged
// Use `wrapped` instead of `merged` in the upsert below
```

### Reflector.run() Changes

```ts
// Before LLM call at line 135:
import { renderObservationGroupsForReflection, reconcileObservationGroupsFromReflection } from "./groups"

const rendered = renderObservationGroupsForReflection(rec.observations)
// Use `rendered` instead of `rec.observations` as prompt

// After validation at line 156:
const reconciled = reconcileObservationGroupsFromReflection(result.text, rec.observations)
OM.reflect(sid, reconciled)
```

### Recall Tool

```ts
// src/tool/recall.ts
import z from "zod"
import { Tool } from "./tool"
import { Database, eq, and, gte, lte } from "../storage/db"
import { MessageTable, PartTable } from "../session/session.sql"
import type { MessageID } from "../session/schema"

export const RecallTool = Tool.define("recall", {
  description:
    "Retrieve source conversation messages for an observation group by message range. " +
    "Use the range from <observation-group range='startId:endId'> markers in your observations.",
  parameters: z.object({
    range: z.string().describe("Message range in format 'startId:endId' from an observation group"),
  }),
  async execute(params, ctx) {
    const parts = params.range.split(":")
    if (parts.length !== 2)
      return { title: "recall", output: "Invalid range format. Expected 'startId:endId'.", metadata: {} }
    const [start, end] = parts as [string, string]

    const rows = Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(
          and(
            eq(MessageTable.session_id, ctx.sessionID),
            gte(MessageTable.id, start as MessageID),
            lte(MessageTable.id, end as MessageID),
          ),
        )
        .all(),
    )

    if (!rows.length) return { title: "recall", output: "No messages found for this range.", metadata: {} }

    const budget = 16_000 // char budget ≈ 4000 tokens
    let out = ""
    for (const row of rows) {
      const role = row.data.role === "user" ? "User" : "Assistant"
      const msgParts = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.message_id, row.id)).all())
      const text = msgParts
        .filter((p) => (p.data as any).type === "text")
        .map((p) => (p.data as any).text as string)
        .join("\n")
      if (!text.trim()) continue
      const line = `[${role}]: ${text}\n\n`
      if (out.length + line.length > budget) {
        out += `[...truncated, ${rows.length} messages total]`
        break
      }
      out += line
    }

    return { title: "recall", output: out.trim() || "No text content in range.", metadata: {} }
  },
})
```

### System Prompt Changes

```ts
// In system.ts — new constant:
const OBSERVATION_RETRIEVAL_INSTRUCTIONS = `Your observations contain <observation-group range="startId:endId"> markers.
Each group represents observations extracted from a specific range of conversation messages.
When you need the exact source messages (e.g., user asks for precise wording, code, or context):
- Extract the range attribute from the relevant observation group
- Call: recall({ range: "startId:endId" })
- The tool returns the original messages for that range
Only use recall when you need verbatim source content — your observations already contain the key facts.`

// In observations() function:
export async function observations(sid: SessionID): Promise<string | undefined> {
  const rec = OM.get(sid)
  if (!rec) return undefined
  const body = rec.reflections ?? rec.observations
  if (!body) return undefined
  const { parseObservationGroups } = await import("./om/groups")
  const hasGroups = parseObservationGroups(body).length > 0
  let out = wrapObservations(body, rec.suggested_continuation ?? undefined)
  if (hasGroups) out += "\n\n" + OBSERVATION_RETRIEVAL_INSTRUCTIONS
  return out
}
```

### Tool Registration

```ts
// In registry.ts — add import:
import { RecallTool } from "./recall"

// In the `all` array, after `skill`:
defer(safe(RecallTool), "Retrieve source messages for an observation group by range"),
```

## Testing Strategy

| Layer | What to Test                          | Approach                                                                                                                        |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Unit  | `groups.ts` — all 5 functions         | Pure function tests: wrap/parse round-trip, strip idempotency, reconcile with/without groups, backward compat with flat strings |
| Unit  | `recall` tool execute                 | Feed mock DB rows, verify output format and truncation                                                                          |
| Unit  | Observer/Reflector integration points | Verify wrapped output format, stripped truncation input                                                                         |

## Migration / Rollout

- Add nullable `first_msg_id`/`last_msg_id` to `ObservationBufferTable` — backward compat.
- Migration: `bun run db generate --name add-om-buffer-msg-ids`.
- Existing flat observations degrade gracefully — `parseObservationGroups` returns `[]`.
- No data migration needed for existing sessions.

## Open Questions

- None blocking.
