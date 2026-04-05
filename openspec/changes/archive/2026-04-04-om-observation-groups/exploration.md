# Exploration: Gap 5 — Observation Groups + Recall Tool

**Change**: `om-observation-groups`
**Date**: 2026-04-04
**Stack**: TypeScript strict, Bun, Effect, Drizzle/SQLite

---

## 1. Current LightCode OM Storage

### ObservationTable schema (`session.sql.ts`, lines 105–127)

```
session_observation
├── id              text PK (SessionID)
├── session_id      text FK → session
├── observations    text        ← flat string blob; NO grouping metadata
├── reflections     text        ← post-reflector compressed blob; same flat format
├── current_task    text
├── suggested_continuation text
├── last_observed_at integer    ← UNIX timestamp only; no message IDs
├── generation_count integer
├── observation_tokens integer
├── time_created, time_updated
```

### ObservationBufferTable schema (`session.sql.ts`, lines 129–144)

```
session_observation_buffer
├── id              text PK (ulid)
├── session_id      text FK → session
├── observations    text        ← single observer run output (flat string)
├── message_tokens  integer
├── observation_tokens integer
├── starts_at       integer     ← timestamp of boundary before this run
├── ends_at         integer     ← timestamp at the end of this run
├── time_created, time_updated
```

### Key findings

- Observations are stored as a **flat newline-delimited bullet string** — no XML grouping, no message-ID ranges.
- `starts_at`/`ends_at` on `ObservationBufferTable` are **Unix timestamps**, not message IDs.
- `last_observed_at` on `ObservationTable` is also a **timestamp**, used as a filter boundary:
  ```ts
  const unobserved = msgs.filter((m) => (m.info.time?.created ?? 0) > boundary)
  ```
- **No group/range tracking** exists anywhere today.
- There is no `first_message_id` or `last_message_id` column — message provenance is lost after the Observer runs.
- `OM.get(sid)` returns the single `ObservationRecord` blob — no per-group retrieval.

---

## 2. Mastra `observation-groups.ts` — Five Functions

### `wrapInObservationGroup(observations, range, id?, kind?)`

Wraps observer output in an XML envelope:

```xml
<observation-group id="abc123" range="msgId1:msgId2">
...bullet observations...
</observation-group>
```

- `range` is `"startMsgId:endMsgId"` — uses actual message IDs, not timestamps.
- `id` defaults to `randomBytes(8).toString('hex')` — 16-char hex anchor.
- `kind` optional (`"reflection"` used by reconciler).

### `parseObservationGroups(text)`

Regex-extracts all `<observation-group>` tags into `ObservationGroup[]` (id, range, content, kind?).
Stateless; returns `[]` for old flat strings — **backward-compatible by design**.

### `stripObservationGroups(text)`

Removes XML wrappers, keeping only the inner content. Used **before sending to Reflector LLM** so the model sees clean bullet text and is not confused by XML metadata.

### `renderObservationGroupsForReflection(text)`

Replaces each `<observation-group>` wrapper with a `## Group \`id\``markdown heading plus a`_range: \`range\`_`metadata line. Returns`null` if no groups exist (backward compat path). Used as input to the Reflector LLM so the model can preserve group structure in its output.

### `reconcileObservationGroupsFromReflection(reflected, sourceObservations)`

After Reflector compresses, re-applies group lineage:

1. Parses source groups from pre-reflection observations.
2. Splits the reflected text by `## Group` headings.
3. For each section, finds matching source groups by line-overlap heuristic.
4. Re-wraps each section in `<observation-group>` preserving or combining the source range.
5. Falls back to a single wrapped group (kind=`"reflection"`) when structure is lost.
   Returns `null` when source had no groups (backward compat).

---

## 3. Recall Tool Design

### How tools are implemented

- `Tool.define(id, def)` in `tool/tool.ts` — returns a `Tool.Info` with an `init` fn.
- `init()` returns a `Def<Parameters, Metadata>` with `description`, `parameters` (Zod), `execute(args, ctx)`.
- `ctx` provides: `sessionID`, `messageID`, `messages: MessageV2.WithParts[]`, `ask()` (permission), `abort`.
- Tools are registered in `tool/registry.ts` by adding to the `all` array inside `ToolRegistry.layer`.

### Message storage and range queries

- Messages live in `MessageTable` (SQLite), keyed by `id: MessageID` (branded string, ULID-ascending).
- `MessageV2.stream(sessionID)` yields all messages in order.
- `MessageV2.get({ sessionID, messageID })` fetches a single message with parts.
- `MessageV2.page(...)` supports cursor-based pagination.
- **Range query** by message ID is NOT implemented today but is trivial to add:
  ```ts
  // Drizzle: all re-exports from drizzle-orm, including gte/lte
  import { gte, lte, and, eq } from "../../storage/db"
  db.select()
    .from(MessageTable)
    .where(and(eq(MessageTable.session_id, sid), gte(MessageTable.id, startId), lte(MessageTable.id, endId)))
    .all()
  ```
  This works because MessageIDs are ULID-ascending — lexicographic ordering equals chronological ordering.

### What `recall(groupId | range)` needs to do

1. Accept either a `groupId` (hex string) or a `range` string (`"startId:endId"`).
2. If `groupId` given: look up the group in current `observations` string, extract its `range`.
3. Parse `range` → `[startId, endId]`.
4. Query `MessageTable` for messages in `[startId, endId]` for the current session.
5. Format and return the source messages as text (role: user/assistant, text parts only).
6. **Permission**: `ask()` not required — observation data is session-local, no filesystem access.

**Critical gap**: Today's `range` is a timestamp pair (not message IDs). The recall tool requires message IDs in the range. This means **the Observer must store message IDs, not just timestamps**.

---

## 4. Schema Impact

### Mastra approach: inline in observations string

Groups are stored **inside the `observations` text blob** as XML tags — zero schema changes required.

**Pros**:

- No migration needed for `ObservationTable` or `ObservationBufferTable`
- Old sessions with flat strings degrade gracefully (`parseObservationGroups` returns `[]`, `stripObservationGroups` is a no-op)
- Reflector sees stripped text (via `stripObservationGroups` before send), so old codepath still works

**Cons**:

- `range` must contain message IDs but today `starts_at`/`ends_at` are timestamps
- Need to thread actual `MessageID` values into `Observer.run()` — currently only `msgs: MessageV2.WithParts[]` is passed, which has `.info.id`, so the first/last IDs are **already available**
- The `ObservationBufferTable.starts_at`/`ends_at` remain timestamp-based; that is fine because they are only used to order buffer activation — not for recall

### Alternative: separate `group_metadata` column

Store a `JSON` column `group_ranges: { id: string, range: string }[]` alongside `observations`.

**Pros**: Cleaner separation, easier to query individual groups without parsing the blob.
**Cons**: Adds schema migration, breaks the simple single-blob model, complicates the reconciler (two things to keep in sync).

### Recommendation: inline (Mastra approach)

No schema change needed. Backward compat is free. The only threading change is that `Observer.run()` receives message IDs for the first/last observed messages (already available via `input.msgs`).

### Migration story

- Existing sessions have flat `observations` strings → `parseObservationGroups` returns `[]` → recall tool returns "no groups found" gracefully.
- No DB migration needed.
- New sessions accumulate grouped observations transparently.

---

## 5. Integration Points

### 5a. `Observer.run()` → wrap in group

**Location**: `packages/opencode/src/session/om/observer.ts`, `Observer.run()`, after `parseObserverOutput()` returns.

**What to do**:

1. Extract `firstId = input.msgs[0]?.info.id` and `lastId = input.msgs.at(-1)?.info.id`.
2. If both exist and `result.observations` is non-empty:
   ```ts
   const range = `${firstId}:${lastId}`
   result.observations = wrapInObservationGroup(result.observations, range)
   ```
3. Return the wrapped `ObserverResult`.

**Note**: `Observer.condense()` (used by `OM.activate()`) also receives raw chunks. The `condense()` function should either:

- Strip groups before sending to LLM (using `stripObservationGroups`), then re-wrap the result.
- Or skip wrapping in `condense()` and rely on reconciliation afterward.

Simpler path: `condense()` operates on stripped text (it's a merge step, not a new observation run), so its output goes through `activate()` which already calls `upsert()`. Groups from individual buffers are preserved as-is; `condense()` produces unwrapped merged text.

### 5b. `Reflector.run()` → strip before LLM, reconcile after

**Location**: `packages/opencode/src/session/om/reflector.ts`, `Reflector.run()`.

**Step 1 — Strip before sending** (line 135 in current code):

```ts
// current:
prompt: rec.observations,
// new:
prompt: stripObservationGroups(rec.observations),
```

Or use `renderObservationGroupsForReflection(rec.observations)` to preserve group headings as markdown — this is the Mastra approach, better for structure-preserving compression.

**Step 2 — Reconcile after getting result** (lines 155–167):

```ts
// current:
OM.reflect(sid, result.text)
// new:
const reconciled = reconcileObservationGroupsFromReflection(result.text, rec.observations)
OM.reflect(sid, reconciled ?? result.text)
```

This preserves group lineage through compression cycles.

### 5c. `truncateObsToBudget` interaction with groups

**Location**: `packages/opencode/src/session/om/observer.ts`, `truncateObsToBudget()`.

Current behavior: truncates line-by-line, preserving `🔴` and `✅` lines.

With groups: lines inside `<observation-group>` tags get truncated individually — the XML wrapper lines themselves may break if an inner line is truncated away but the closing tag remains.

**Options**:

1. **Strip groups before truncating** — apply `stripObservationGroups()` first. Loses group metadata but keeps truncation correct. Only needed when truncating for context (not for storage).
2. **Group-aware truncation** — truncate whole groups as atomic units.

Option 1 is simpler and correct: `truncateObsToBudget` is only called when passing `prev` observations to the Observer LLM (context window use, not storage). Groups don't need to be preserved in that context. Strip before truncate.

**Location in `Observer.run()`** (line 267):

```ts
// current:
const prev = budget === false ? input.prev : truncateObsToBudget(input.prev, budget ?? 2000)
// new:
const raw = budget === false ? input.prev : truncateObsToBudget(input.prev, budget ?? 2000)
const prev = stripObservationGroups(raw)
```

### 5d. Recall tool registration

**File to create**: `packages/opencode/src/tool/recall.ts`

```ts
// Pattern from read.ts / tool.ts
export const RecallTool = Tool.define("recall", {
  description: "Retrieve source conversation messages for an observation group. ...",
  parameters: z.object({
    range: z.string().describe("Message range as 'startId:endId' or group id"),
  }),
  async execute(params, ctx) {
    // 1. Parse range or look up groupId in current observations
    // 2. Query MessageTable for messages in range within ctx.sessionID
    // 3. Format and return text
  },
})
```

**Registration**: add `RecallTool` to `ToolRegistry.layer` in `tool/registry.ts` alongside other tools.

---

## Recommended Approach

**Port Mastra's inline XML group approach as-is, with one adaptation: use message IDs (not timestamps) for ranges.**

### Why

1. Zero schema changes — backward compat is free
2. Mastra's 5 utility functions are pure string transforms — trivial to copy/adapt to LightCode conventions
3. The integration points are surgical: 3 lines changed in `observer.ts`, 2 lines in `reflector.ts`
4. Message IDs are ULID-ascending, so range queries are simple lexicographic DB queries

### Adaptation from Mastra

The only delta vs. Mastra is that `wrapInObservationGroup` receives `MessageID` pairs (from `input.msgs`) rather than timestamps. No conceptual change — just different ID type.

### Tradeoffs

|                    | Inline XML (recommended) | Separate column          |
| ------------------ | ------------------------ | ------------------------ |
| Schema migration   | None                     | Required                 |
| Backward compat    | Free                     | Requires dual read logic |
| Query complexity   | Parse blob               | Direct SQL               |
| Reflector coupling | Wrap/strip in 2 places   | Keep in sync separately  |
| Code complexity    | Low                      | Medium                   |

---

## Affected Files

| File                                            | Change                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/om/observer.ts`  | Wrap `result.observations` in group after `parseObserverOutput`; strip groups before `truncateObsToBudget`      |
| `packages/opencode/src/session/om/reflector.ts` | Use `renderObservationGroupsForReflection` as prompt; call `reconcileObservationGroupsFromReflection` on result |
| `packages/opencode/src/session/om/record.ts`    | No schema changes; `OM.reflect()` already takes plain string — works unchanged                                  |
| `packages/opencode/src/session/session.sql.ts`  | **No changes** — inline approach requires none                                                                  |
| `packages/opencode/src/tool/recall.ts`          | **New file** — RecallTool implementation                                                                        |
| `packages/opencode/src/tool/registry.ts`        | Add `RecallTool` import + registration                                                                          |
| `packages/opencode/src/session/om/groups.ts`    | **New file** — port Mastra's 5 utility functions (pure string transforms)                                       |

---

## Risks

1. **Range is timestamps today, not message IDs**: `starts_at`/`ends_at` in `ObservationBufferTable` are timestamps. The inline group format needs message IDs. This requires threading `msgs[0].info.id` and `msgs.at(-1).info.id` into the group wrapper inside `Observer.run()`. The data is already available in `input.msgs` — it's a matter of extracting it.

2. **`condense()` breaks group wrapping**: `Observer.condense()` merges multiple buffer chunks. The merged output won't be wrapped in a group. This is acceptable — `condense()` is a merge of pre-wrapped chunks; the individual buffer groups are in the buffers. After activation, the merged text could receive a new group wrapping the full range. This needs explicit handling in `OM.activate()`.

3. **Reflector LLM may not preserve `## Group` headings**: The reconciler relies on `## Group \`id\`` headings in the LLM output. Aggressive compression may remove them. The fallback (`reconcileObservationGroupsFromReflection` wraps the whole thing in one group with combined range) handles this, but fine-grained provenance is lost.

4. **`truncateObsToBudget` sees unwrapped text after strip**: If `stripObservationGroups` is called before `truncateObsToBudget`, the `🔴`/`✅` priority logic still works correctly — it operates on the inner bullet lines.

5. **Existing sessions with flat observations**: `parseObservationGroups` returns `[]`, recall returns "no groups". Non-blocking but should return a helpful message.

6. **Recall tool security**: Fetches messages from DB by ID range. Must validate that the messages belong to `ctx.sessionID` — add `eq(MessageTable.session_id, ctx.sessionID)` to the query.

---

## Ready for Proposal

**Yes.**

All integration points are clearly identified. The implementation is low-risk (pure string transforms + surgical 3-file changes). The only open design question is how `OM.activate()` / `condense()` assigns a group wrapper to the merged output — recommend wrapping the merged result with the full span range of all buffers (first buffer's `starts_at` → last buffer's `ends_at`, but using the first/last message IDs that need to be stored in the buffer table or inferred differently).

**One clarification needed before proposal**: Should the recall tool be exposed to the agent as a standard tool (always available), or only when observations have groups (dynamic registration)? Recommend: always registered, returns graceful "no groups in this session yet" when observations are flat.
