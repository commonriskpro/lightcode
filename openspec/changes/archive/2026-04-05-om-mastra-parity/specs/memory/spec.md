# Delta Spec: om-mastra-parity → memory capability

## Modified Requirements

---

### MODIFIED: Observer tool result token cap

The Observer tool result cap MUST default to **2,000 tokens** (not 500).

#### Scenario: Tool result within cap

- GIVEN a completed tool part whose output is ≤ 2,000 tokens
- WHEN the Observer builds its context string
- THEN the full output MUST be included verbatim
- AND no truncation suffix is appended

#### Scenario: Tool result exceeds cap

- GIVEN a completed tool part whose output exceeds 2,000 tokens
- WHEN the Observer builds its context string
- THEN the output MUST be truncated at `experimental.observer_max_tool_result_tokens ?? 2000` tokens
- AND the suffix `"\n... [truncated]"` MUST be appended
- AND the truncated string MUST NOT exceed `cap × 4` characters

#### Scenario: Encrypted / secret fields stripped before cap

- GIVEN a tool result object containing a field whose name matches `*encrypted*`, `*secret*`, or `*token*`
- AND that field's serialized value exceeds 256 characters
- WHEN `sanitizeToolResult(output)` is called before truncation
- THEN that field's value MUST be replaced with `"[stripped: N chars]"`
- AND the sanitized object MUST be serialized to JSON before the token cap is applied

---

### NEW: Message sealing at Observer snapshot boundary

The system MUST "seal" the observation snapshot boundary to prevent the mega-message bug — where a long agentic loop keeps appending parts to the same assistant message after the Observer has already snapshotted it.

#### Scenario: Observer buffer snapshot taken

- GIVEN `OMBuf.check()` returns `"buffer"` signal
- AND the buffer snapshot `unobserved` is computed
- WHEN `OM.addBuffer()` is called with the snapshot
- THEN the `ends_at` field MUST be set to `unobserved.at(-1)?.info.time?.created`
- AND `sealed_at` MUST be recorded in-memory (per-session Map) as the `ends_at` value
- AND any assistant message whose `time.created ≤ sealed_at` MUST be excluded from future `unobserved` slices even if new parts are appended to it

#### Scenario: Observer force path taken

- GIVEN `OMBuf.check()` returns `"force"` signal
- WHEN `Observer.run()` completes and `OM.upsert()` is called
- THEN the `last_observed_at` boundary MUST be set to `unobserved.at(-1)?.info.time?.created`
- AND the in-memory seal MUST be updated to this value

---

### NEW: `observedMessageIds` deduplication safeguard

The OM system MUST maintain a secondary deduplication Set of observed message IDs to prevent re-observation of the same messages even if the timestamp cursor fails to advance correctly.

#### Scenario: Observer cycle completes

- GIVEN `Observer.run()` returns a valid result
- WHEN `OM.upsert()` or `OM.addBuffer()` records the result
- THEN the IDs of all messages in `unobserved` MUST be appended to `observed_message_ids` on the `ObservationTable` record
- AND `observed_message_ids` MUST be persisted as a JSON array

#### Scenario: Next turn `unobserved` slice computation

- GIVEN an `ObservationRecord` exists with a non-empty `observed_message_ids`
- WHEN the `unobserved` slice is computed for the next Observer trigger
- THEN messages whose `info.id` is in `observed_message_ids` MUST be excluded
- AND BOTH the timestamp filter AND the ID filter MUST be applied (conjunction — message must pass both)

#### Scenario: `observed_message_ids` missing (legacy record)

- GIVEN an `ObservationRecord` with `observed_message_ids IS NULL`
- WHEN the `unobserved` slice is computed
- THEN the ID filter MUST be skipped
- AND behavior MUST be identical to the current timestamp-only filter

---

### MODIFIED: `obsRec` boundary freshness

The tail boundary used for Gap F MUST reflect the post-activation state of the OM record, not the pre-activation snapshot captured at the start of the loop iteration.

#### Scenario: OM activates synchronously (`force` path) on turn N

- GIVEN `OMBuf.check()` returns `"force"` on turn N
- AND `Observer.run()` completes and `OM.upsert()` writes new `last_observed_at`
- WHEN `omBoundary` is computed for the Gap F tail filter on the same turn N
- THEN `omBoundary` MUST use the `last_observed_at` from the **post-upsert** record
- AND NOT the value captured before the force path executed

#### Scenario: OM activates asynchronously (`activate` path) on turn N

- GIVEN `OMBuf.check()` returns `"activate"` on turn N
- AND `OM.activate()` is forked (non-blocking)
- WHEN `omBoundary` is computed for the Gap F tail filter on the same turn N
- THEN `omBoundary` MAY use the pre-activation snapshot (fork is non-blocking by design)
- AND the next turn (N+1) MUST use the post-activation boundary
- AND no data loss or message double-sending MUST occur

#### Scenario: No OM activation on turn N

- GIVEN no OM signal fires on turn N
- WHEN `omBoundary` is computed
- THEN `omBoundary` MUST equal `OM.get(sessionID)?.last_observed_at ?? 0`
- AND behavior MUST be identical to current implementation
