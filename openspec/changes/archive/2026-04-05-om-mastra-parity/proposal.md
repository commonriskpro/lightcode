# Proposal: OM Mastra Parity

## Intent

Close the remaining philosophical gaps between LightCode's OM implementation and Mastra's. The current implementation is architecturally correct but operates at 5% of Mastra's tool-result fidelity (500 vs 10,000 token cap), lacks message sealing (mega-message bug), lacks a secondary deduplication safeguard (`observedMessageIds`), and has two staleness issues in the observation boundary that cause one-turn suboptimal tail filtering.

## Scope

### In Scope

- **Raise `observer_max_tool_result_tokens` default** from 500 → 2,000 tokens (conservative step toward Mastra's 10,000)
- **Message sealing** — mark assistant messages as "sealed" at the buffering boundary so no new parts can be appended after the Observer snapshot is taken
- **`observedMessageIds` safeguard** — secondary deduplication Set stored on the OM record; filters already-observed messages even if timestamp cursor hasn't advanced
- **`obsRec` freshness** — re-read `OM.get(sessionID)` immediately before building the tail (after OM activation) so the boundary used for Gap F is always up to date
- **Tool result sanitization** — `sanitizeToolResult` strips oversized encrypted fields and handles circular refs before Observer serialization
- **Delta spec for `memory`** capability

### Out of Scope

- `ModelByInputTokens` (automatic model routing by context size) — deferred
- Cross-thread / `scope: 'resource'` multi-session OM — deferred
- `shareTokenBudget` dynamic threshold — deferred
- Fork step-0 observations — edge case, deferred
- Thread title generation from Observer — deferred
- `obscureThreadIds` option — deferred

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `memory`: observer fidelity, message sealing, boundary freshness, tool result sanitization

## Approach

1. **`observer_max_tool_result_tokens` default** — change config default from 500 → 2,000. No new API surface.
2. **Message sealing** — add `sealed_at?: number` column to `ObservationBufferTable`. When `OMBuf` computes the buffer snapshot (`unobserved`), mark the last message as "sealed" (write `sealed_at` to `MessageTable` or a lightweight in-memory Set). Observer input excludes parts added after `sealed_at`.
3. **`observedMessageIds`** — add `observed_message_ids: text` (JSON array) column to `ObservationTable`. After each Observer cycle, append observed message IDs to this Set. `unobserved` filter uses both timestamp AND `!observedMessageIds.has(id)`.
4. **`obsRec` freshness** — in `prompt.ts`, after `sig === "activate"` and `sig === "force"` complete, re-read `OM.get(sessionID)` before computing `omBoundary`. One extra SQLite read per turn OM fires.
5. **Tool result sanitization** — `sanitizeToolResult(output)` function in `om/observer.ts` that strips fields exceeding 256 chars named `*encrypted*` / `*secret*` / `*token*`, handles circular refs.

## Affected Areas

| Area                         | Impact   | Description                                                         |
| ---------------------------- | -------- | ------------------------------------------------------------------- |
| `src/session/om/observer.ts` | Modified | `sanitizeToolResult`, raise cap constant                            |
| `src/session/prompt.ts`      | Modified | `obsRec` re-read after activation, `observedMessageIds` filter      |
| `src/session/session.sql.ts` | Modified | `observed_message_ids` on `ObservationTable`, `sealed_at` on buffer |
| `src/session/om/record.ts`   | Modified | `OM.upsert` / `activate` persist `observed_message_ids`             |
| `src/config/config.ts`       | Modified | Default for `observer_max_tool_result_tokens` → 2,000               |

## Risks

| Risk                                             | Likelihood | Mitigation                                                                          |
| ------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| DB schema change breaks existing sessions        | Low        | `observed_message_ids` nullable, `sealed_at` nullable — no migration needed         |
| Raising cap floods Observer context              | Low        | 2,000 tokens is still 5× below Mastra's 10,000; tunable via config                  |
| `observedMessageIds` grows unbounded per session | Low        | Only IDs (strings), capped by session message count                                 |
| Sealing logic race with fast agentic loops       | Med        | Sealed marker is a timestamp, not a lock — worst case is one extra observed message |

## Rollback Plan

Git revert. DB columns are nullable additions — existing rows read fine with `null` values. No migration needed.

## Dependencies

- All om-replace-compaction gaps must be verified (they are — 2053 tests passing)

## Success Criteria

- [ ] `bun typecheck` passes
- [ ] `bun test` — 0 fail
- [ ] Observer receives tool results up to 2,000 tokens (not 500) — verified by test
- [ ] `observedMessageIds` populated after Observer cycle — verified by test
- [ ] `obsRec` used for tail filter is always post-activation — verified by test
- [ ] `sanitizeToolResult` strips `*encrypted*` fields > 256 chars — verified by test
