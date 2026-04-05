# Proposal: Observational Memory Quality — 6 Gaps from Mastra

## Intent

Close 6 behavioral gaps identified by comparing LightCode's OM implementation against Mastra's production package. Core problems: (1) Reflector stores expanded observations silently, (2) Observer output has no continuity hints when it replaces messages, (3) no agent task continuity between Observer cycles, (4) degenerate LLM output (Gemini repeat bug) gets stored verbatim, (5) no model instructions for interpreting observations with temporal conflicts, (6) fixed thresholds don't shrink when observations already occupy budget.

## Scope

### In Scope

- Reflector compression retry loop (levels 0–4) with `validateCompression` gate + best-result tracking
- Observer structured XML output: `<observations>`, `<current-task>`, `<suggested-response>` with plain-text fallback
- `currentTask` persistence in `ObservationTable` + round-trip to next Observer cycle as `priorCurrentTask`
- `suggestedContinuation` stored in DB + injected as `<system-reminder>` in `system[2]`
- `detectDegenerateRepetition()` — shared utility, used by both Observer and Reflector
- `OBSERVATION_CONTEXT_INSTRUCTIONS` appended after observations block every turn
- `ThresholdRange { min, max }` opt-in config type; `calculateDynamicThreshold()` in `OMBuf.check()`

### Out of Scope

- Working Memory — superseded by Engram
- Semantic Recall — superseded by Engram FTS5
- Observation Groups + `recall` tool — requires incompatible storage model
- Multi-thread / resource-scope — not applicable
- `bufferActivation` / retentionFloor — requires buffer→activate pattern not yet wired

## Capabilities

### Modified Capabilities

- `memory`: Observer returns `ObserverResult` struct instead of plain string; Reflector gains retry loop; new constants in `system.ts`; two new nullable columns in `ObservationTable`; `OMBuf.check()` extended with optional `obsTokens` param

## Approach

Bottom-up: DB schema first (new nullable columns), then shared degenerate detection utility, then Observer structured output + `currentTask` round-trip (two call sites in `prompt.ts` both updated), then Reflector retry loop, then context instructions in `system.ts`. Each layer is independently testable.

## Affected Areas

| Area                          | Impact | Description                                                                                                                          |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/session/session.sql.ts`  | Modify | +2 nullable columns on `ObservationTable`                                                                                            |
| `src/session/om/observer.ts`  | Modify | Structured output, `ObserverResult`, degenerate detection, `priorCurrentTask` param                                                  |
| `src/session/om/reflector.ts` | Modify | Compression retry loop, `validateCompression`, degenerate import                                                                     |
| `src/session/om/buffer.ts`    | Modify | `ThresholdRange`, `calculateDynamicThreshold`, optional `obsTokens` in `check()`                                                     |
| `src/session/system.ts`       | Modify | `OBSERVATION_CONTEXT_INSTRUCTIONS`, updated `wrapObservations(body, hint?)`                                                          |
| `src/session/om/record.ts`    | Modify | `OM.upsert` writes `current_task` + `suggested_continuation`                                                                         |
| `src/session/prompt.ts`       | Modify | **Both** Observer call sites (~1525 and ~1563): destructure `ObserverResult`, write new fields; `OMBuf.check()` receives `obsTokens` |
| `src/config/config.ts`        | Modify | `observer_message_tokens?: number \| ThresholdRange` in experimental block                                                           |

## Risks

| Risk                                                                  | Likelihood | Mitigation                                                                                                      |
| --------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| XML prompt change causes Observer to produce worse extraction quality | Medium     | Fallback path: if `<observations>` tag absent, full text treated as observations — behaviour identical to today |
| Two duplicate call sites in `prompt.ts` — easy to update only one     | Medium     | Task 3.6 and 3.7 are explicitly separate tasks for each call site                                               |
| Reflector retry increases latency noticeably                          | Low        | Max 4 retries; only fires when `observation_tokens > 40k`; each call is a cheap fast-model call                 |
| `detectDegenerateRepetition` false-positive discards valid output     | Low        | 2000-char minimum; 90% similarity threshold; normal varied observation text won't trigger                       |

## Rollback Plan

All DB columns are nullable — reverting the code leaves them as dead columns, no data corruption. `git revert` of the implementation commit restores all changed files. No migration rollback needed.

## Success Criteria

- [ ] Reflector output token count is always ≤ input token count after `OM.reflect` is called
- [ ] `suggestedContinuation` from Observer appears as `<system-reminder>` in `system[2]` on next turn
- [ ] `currentTask` in DB is updated each Observer cycle and appears in next Observer's prompt
- [ ] Degenerate Observer/Reflector outputs are logged as warnings and never written to DB
- [ ] `OBSERVATION_CONTEXT_INSTRUCTIONS` present in every `system[2]` that contains observations
- [ ] `calculateDynamicThreshold` returns correct values for range inputs (verified by unit tests)
- [ ] All existing tests pass; new tests cover each gap (unit + integration)
