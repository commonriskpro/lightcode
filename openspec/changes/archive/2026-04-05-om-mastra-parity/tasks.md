# Tasks: om-mastra-parity

## T-1 — Raise `observer_max_tool_result_tokens` default: 500 → 2,000

- [x] **T-1.1** `src/session/om/observer.ts:249` — change `?? 500` to `?? 2_000`
- [x] **T-1.2** `src/config/config.ts` — update `.describe()` string: "Default 500" → "Default 2000"

---

## T-2 — `sanitizeToolResult` function

- [x] **T-2.1** `src/session/om/observer.ts` — add `sanitizeToolResult(val, seen)` pure function above the `Observer` namespace. Strips fields matching `/encrypted|secret|token/i` with value > 256 chars. Handles circular refs via `WeakSet`.
- [x] **T-2.2** `src/session/om/observer.ts` — use `sanitizeToolResult` in the `flatMap` tool part handler, before the length/cap check:
  ```ts
  const sanitized =
    typeof p.state.output === "string" ? p.state.output : JSON.stringify(sanitizeToolResult(p.state.output))
  ```
- [x] **T-2.3** Add tests to `test/session/observer.test.ts`:
  - `sanitizeToolResult` strips string field matching pattern > 256 chars
  - `sanitizeToolResult` strips nested field
  - `sanitizeToolResult` handles circular reference (`"[circular]"`)
  - `sanitizeToolResult` leaves short fields intact
  - `sanitizeToolResult` leaves non-matching field names intact

---

## T-3 — `observed_message_ids` deduplication safeguard

- [x] **T-3.1** `src/session/session.sql.ts` — add `observed_message_ids: text()` (nullable) to `ObservationTable`
- [x] **T-3.2** Run `bun run db generate --name om-observed-ids` to generate migration
- [x] **T-3.3** `src/session/om/record.ts` — add private `mergeIds(existing, newIds)` helper that merges into a `Set` and returns `JSON.stringify([...set])`
- [x] **T-3.4** `src/session/om/record.ts` — in `activate()`: after computing `obs`, collect all observed message IDs from the buffers (`bufs.flatMap(b => [b.first_msg_id, b.last_msg_id]).filter(Boolean)`) and call `mergeIds` to update `observed_message_ids` on `updated`/`next`
- [x] **T-3.5** `src/session/prompt.ts` — in `buffer` path: after `Observer.run()` returns result, collect `ids = unobserved.map(m => m.info.id)` and pass to `OM.addBuffer` (extend `ObservationBuffer` type if needed or use a separate `OM.mergeIds` call)

  > Simpler approach: instead of changing `addBuffer` signature, call a new `OM.trackObserved(sid, ids)` that updates `observed_message_ids` directly.

- [x] **T-3.6** `src/session/prompt.ts` — in `force` path: after `OM.upsert`, call `OM.trackObserved(sessionID, unobserved.map(m => m.info.id))`
- [x] **T-3.7** `src/session/om/record.ts` — add `OM.trackObserved(sid, ids)` function: reads current record, merges IDs, updates `observed_message_ids` in DB
- [x] **T-3.8** `src/session/prompt.ts` — in both `buffer` and `force` `unobserved` computation, add ID exclusion filter:
  ```ts
  const obsIds = new Set<string>(rec?.observed_message_ids ? JSON.parse(rec.observed_message_ids) : [])
  const unobserved = msgs.filter((m) => (m.info.time?.created ?? 0) > boundary && !obsIds.has(m.info.id))
  ```
- [x] **T-3.9** Add tests to `test/session/observer.test.ts`:
  - `OM.trackObserved` persists IDs to DB
  - `unobserved` filter excludes IDs in `observed_message_ids`
  - Legacy record with `null` `observed_message_ids` skips ID filter (no throw)
  - `mergeIds` deduplicates correctly

---

## T-4 — `obsRec` freshness for `force` path

- [x] **T-4.1** `src/session/prompt.ts` — declare `let freshObsRec: typeof obsRec = undefined` at the top of the loop body (line ~1521)
- [x] **T-4.2** `src/session/prompt.ts` — at the end of the `sig === "force"` handler (after `OM.upsert` + optional Reflector), add:
  ```ts
  freshObsRec = OM.get(sessionID)
  ```
- [x] **T-4.3** `src/session/prompt.ts` — at line 1780 (`omBoundary` computation), change to:
  ```ts
  const omBoundary = (freshObsRec ?? obsRec)?.last_observed_at ?? 0
  ```
- [x] **T-4.4** Reset `freshObsRec = undefined` at the top of each loop iteration (or use a fresh `let` inside the loop body)
- [x] **T-4.5** Add test to `test/session/observer.test.ts` or `test/session/prompt.test.ts`:
  - After `force` path fires, `omBoundary` reflects post-upsert `last_observed_at`
  <!-- TODO: test freshObsRec — after force path, omBoundary uses post-upsert boundary -->

---

## T-5 — Message sealing (in-memory `OMBuf.seal`)

- [x] **T-5.1** `src/session/om/buffer.ts` — add `const seals = new Map<string, number>()` inside `OMBuf` namespace
- [x] **T-5.2** `src/session/om/buffer.ts` — add `seal(sid, at)` and `sealedAt(sid)` functions
- [x] **T-5.3** `src/session/prompt.ts` — in `buffer` path, after `unobserved` is computed and before `OMBuf.setInFlight`:
  ```ts
  const sealAt = unobserved.at(-1)?.info.time?.created ?? 0
  if (sealAt > 0) OMBuf.seal(sessionID, sealAt)
  ```
- [x] **T-5.4** `src/session/prompt.ts` — in both `buffer` and `force` `unobserved` filters, add seal exclusion:
  ```ts
  const sealed = OMBuf.sealedAt(sessionID)
  const unobserved = msgs.filter(
    (m) =>
      (m.info.time?.created ?? 0) > boundary &&
      !obsIds.has(m.info.id) &&
      (sealed === 0 || (m.info.time?.created ?? 0) > sealed),
  )
  ```
- [x] **T-5.5** Add tests to `test/session/observer.test.ts`:
  - [x] `OMBuf.seal` sets the seal for a session
  - [x] `OMBuf.sealedAt` returns 0 for unsealed session
  - [x] `OMBuf.seal` does not decrease — higher value wins
  - [x] `unobserved` filter excludes messages at or before `sealed_at`
  - [x] `unobserved` filter includes messages after `sealed_at`

---

## T-6 — Typecheck + test run

- [ ] **T-6.1** `bun typecheck` from `packages/opencode` — 0 errors
- [ ] **T-6.2** `bun test --timeout 30000` from `packages/opencode` — 0 fail
- [ ] **T-6.3** Verify migration was generated: `ls migration/ | grep om-observed-ids`
