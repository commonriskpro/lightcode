# Design: om-mastra-parity

## Overview

Five targeted changes to bring LightCode's OM implementation to full Mastra parity on the verified gap items. No new files needed. Schema requires one `bun run db generate`.

---

## Change 1 — `observer_max_tool_result_tokens` default: 500 → 2,000

**File:** `src/config/config.ts`

Change the `.describe()` default reference from 500 to 2,000. The actual default is applied in `observer.ts` via `?? 500`:

```ts
// observer.ts:249 — BEFORE
const cap = (cfg.experimental?.observer_max_tool_result_tokens ?? 500) * 4

// observer.ts:249 — AFTER
const cap = (cfg.experimental?.observer_max_tool_result_tokens ?? 2_000) * 4
```

Update `.describe()` in `config.ts` to match. No other changes needed — the cap logic already exists.

---

## Change 2 — `sanitizeToolResult` function

**File:** `src/session/om/observer.ts`

New pure function inserted above the `Observer` namespace. Walks the tool output recursively, replaces any field whose name matches `/encrypted|secret|token/i` AND whose serialized value exceeds 256 chars with `"[stripped: N chars]"`. Handles circular references via `WeakSet`.

```ts
function sanitizeToolResult(val: unknown, seen = new WeakSet()): unknown {
  if (typeof val !== "object" || val === null) return val
  if (seen.has(val)) return "[circular]"
  seen.add(val)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    const serialized = typeof v === "string" ? v : (JSON.stringify(v) ?? "")
    if (/encrypted|secret|token/i.test(k) && serialized.length > 256) out[k] = `[stripped: ${serialized.length} chars]`
    else out[k] = sanitizeToolResult(v, seen)
  }
  return out
}
```

Used in the `flatMap` inside `Observer.run()`:

```ts
// observer.ts — inside tool part handler
const sanitized =
  typeof p.state.output === "string" ? p.state.output : JSON.stringify(sanitizeToolResult(p.state.output))
const out = sanitized.length > cap ? sanitized.slice(0, cap) + "\n... [truncated]" : sanitized
```

---

## Change 3 — `observed_message_ids` deduplication safeguard

### 3a — Schema

**File:** `src/session/session.sql.ts`

Add nullable `text` column to `ObservationTable`:

```ts
observed_message_ids: text(),  // JSON array of MessageID strings, nullable
```

No migration for `ObservationBufferTable` — the IDs are tracked at the record level, not the buffer level.

Run: `bun run db generate --name om-observed-ids`

### 3b — Record type

`ObservationRecord = typeof ObservationTable.$inferSelect` picks up the new column automatically.

### 3c — `OM.upsert` and `activate`

**File:** `src/session/om/record.ts`

Helper (pure, private):

```ts
function mergeIds(existing: string | null, newIds: string[]): string {
  const set = new Set<string>(existing ? JSON.parse(existing) : [])
  for (const id of newIds) set.add(id)
  return JSON.stringify([...set])
}
```

In `activate()` — after building `updated`/`next`, merge IDs from all buffer records:

```ts
const allIds = bufs.flatMap((b) => [b.first_msg_id, b.last_msg_id]).filter(Boolean) as string[]
// + collect full range: bufs carry first/last only — use as proxy for the slice
const merged = mergeIds(rec?.observed_message_ids ?? null, allIds)
// set on updated/next: observed_message_ids: merged
```

> Note: buffers store only `first_msg_id` / `last_msg_id`. For full ID tracking we need to thread the ID list through from `OMBuf`. See Task T-3.2.

### 3d — `unobserved` filter in `prompt.ts`

**File:** `src/session/prompt.ts`

Both the `buffer` and `force` paths compute `unobserved`:

```ts
// BEFORE
const unobserved = msgs.filter((m) => (m.info.time?.created ?? 0) > boundary)

// AFTER
const obsIds = rec
  ? new Set<string>(rec.observed_message_ids ? JSON.parse(rec.observed_message_ids) : [])
  : new Set<string>()
const unobserved = msgs.filter((m) => (m.info.time?.created ?? 0) > boundary && !obsIds.has(m.info.id))
```

After `Observer.run()` returns a valid result, collect IDs of the observed messages and persist:

```ts
const ids = unobserved.map((m) => m.info.id)
// include ids in OM.upsert / OM.addBuffer
```

---

## Change 4 — `obsRec` freshness for `force` path

**File:** `src/session/prompt.ts`

The `force` path is synchronous (no `forkIn`). After it completes, we can re-read `obsRec` before computing `omBoundary`. The `activate` path is forked (non-blocking) — staleness there is acceptable by design (one-turn lag).

```ts
// Inside sig === "force" handler (prompt.ts:1588–1630)
// AFTER OM.upsert + Reflector.run:
// Re-read so omBoundary on THIS turn uses the fresh boundary
const freshRec = OM.get(sessionID)
// ... then at line 1786, use freshRec instead of obsRec for force turns
```

Implementation: add a `let freshObsRec: ObservationRecord | undefined` variable, set it after the `force` path completes, and compute `omBoundary` as:

```ts
const omBoundary = (freshObsRec ?? obsRec)?.last_observed_at ?? 0
```

---

## Change 5 — Message sealing (in-memory)

**Rationale:** Full DB-level sealing adds complexity. An in-memory `Map<SessionID, number>` is sufficient — sealing is a session-lifetime concern and the server process holds the map. If the process restarts, `last_observed_at` (persisted in DB) serves as the boundary anyway.

**File:** `src/session/om/buffer.ts`

Add to `OMBuf` namespace:

```ts
// In-memory seal map: session → sealed_at timestamp
const seals = new Map<string, number>()

export function seal(sid: string, at: number): void {
  const existing = seals.get(sid)
  if (!existing || at > existing) seals.set(sid, at)
}

export function sealedAt(sid: string): number {
  return seals.get(sid) ?? 0
}
```

**File:** `src/session/prompt.ts`

After `unobserved` is computed in the `buffer` path:

```ts
const sealAt = unobserved.at(-1)?.info.time?.created ?? 0
if (sealAt > 0) OMBuf.seal(sessionID, sealAt)
```

Then in the `unobserved` filter, add the seal check:

```ts
const sealed = OMBuf.sealedAt(sessionID)
const unobserved = msgs.filter(
  (m) =>
    (m.info.time?.created ?? 0) > boundary &&
    !obsIds.has(m.info.id) &&
    (sealed === 0 || (m.info.time?.created ?? 0) > sealed),
)
```

> Note: the seal check uses `>` not `>=` for the boundary, but `>` not `>= sealed` for the seal — we want to exclude messages AT or BEFORE `sealed_at`, not just before.

---

## DB Migration

```bash
bun run db generate --name om-observed-ids
```

Creates: `migration/<timestamp>_om-observed-ids/migration.sql`

The migration adds `observed_message_ids TEXT` (nullable) to `session_observation`. Existing rows read as `null` — safeguarded by the `?? null` fallback.

---

## Test Plan

| Test file                       | Coverage                                                               |
| ------------------------------- | ---------------------------------------------------------------------- |
| `test/session/observer.test.ts` | `sanitizeToolResult` strips encrypted fields, handles circular refs    |
| `test/session/observer.test.ts` | Cap applied at 2,000 tokens (not 500) by default                       |
| `test/session/observer.test.ts` | `OMBuf.seal` / `sealedAt` — seal map updated, excludes sealed messages |
| `test/session/observer.test.ts` | `observedMessageIds` populated after Observer cycle                    |
| `test/session/observer.test.ts` | `unobserved` filter excludes already-observed IDs                      |
| `test/session/observer.test.ts` | `obsRec` freshness — force path uses post-upsert boundary              |
