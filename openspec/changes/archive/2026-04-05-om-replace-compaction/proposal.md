# Proposal: Replace Emergency Compaction with OM-Primary Context Management

## Intent

Remove the legacy emergency compaction system (cut-point LLM summary triggered at ~192k tokens) and make the Observational Memory (OM) Observer the **sole mechanism** for keeping context size in check. Additionally implement the missing OM integration gaps (D, C, E, F) that prevent OM from actually reducing the message array sent to the LLM.

The emergency compaction is architecturally incompatible with the OM philosophy: it lets context grow indefinitely then panics, while OM compresses proactively. Running both is wasteful and produces confusing behavior.

## Scope

### In Scope

- **Gap D**: Stable sentinel at `system[1]` when `recall` is undefined — eliminates BP3 cache-bust
- **Gap C**: Reorder system slots so `observations` sits at BP3 (cacheable) and `recall` at `system[2]`
- **Gap E**: Observer receives tool parts with per-tool token cap (~500 tokens default)
- **Gap F**: Apply `lastObservedAt` boundary to the main LLM call — message array becomes the unobserved tail only
- **Delete** `session/compaction.ts`, `session/cut-point.ts`, `session/overflow.ts`
- **Delete** `agent/prompt/compaction.txt`
- **Remove** all compaction call sites from `session/prompt.ts` and `session/processor.ts`
- **Remove** `POST /session/:id/compact` API route from `server/routes/session.ts`
- **Remove** compaction agent definition from `agent/agent.ts`
- **Remove** compaction config keys from `config/config.ts`
- **Keep** `filterCompactedEffect` / `filterCompacted` in `message-v2.ts` — needed to load post-legacy-compaction sessions from DB (backwards compat)
- **Keep** `CompactionPart` schema type in `message-v2.ts` — existing DB rows must still deserialize
- **Delete** compaction tests: `compaction.test.ts`, `cut-point.test.ts`, `revert-compact.test.ts`
- **Add** tests for Gaps D, C, E, F

### Out of Scope

- Changing the OM Observer thresholds or Reflector logic
- `lastMessages:N` config key (Gap A) — deferred, OM tail boundary is sufficient
- Full Gap B (Observer compression replacing prune strategy) — prune code removed along with compaction
- Migrating existing compacted sessions — `filterCompacted` handles that transparently

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `memory`: Requirements change for how observations enter the system prompt (Gap C slot reorder), how Observer processes tool results (Gap E), and how the message array is built per LLM call (Gap F)

## Approach

1. Implement Gaps D+C together (5+10 LOC in `llm.ts` + `transform.ts`) — observations become BP3, recall moves to `system[2]`, sentinel ensures slot is always stable
2. Implement Gap E (30 LOC in `observer.ts` + `config.ts`) — Observer sees tool parts, capped at `observer_max_tool_result_tokens`
3. Implement Gap F (15 LOC in `prompt.ts`) — after loading `msgs`, filter to `lastObservedAt` tail before passing to `toModelMessages`
4. Delete compaction machinery — remove files, imports, call sites, config keys, tests
5. Handle `result === "compact"` return from processor: replace with no-op log (the OM+F combination makes this unreachable in normal use; a real provider overflow becomes a session error instead of a compaction trigger)

## Affected Areas

| Area                                  | Impact      | Description                                                                   |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `src/session/compaction.ts`           | **Deleted** | Entire file removed                                                           |
| `src/session/cut-point.ts`            | **Deleted** | Entire file removed                                                           |
| `src/session/overflow.ts`             | **Deleted** | Entire file removed                                                           |
| `src/agent/prompt/compaction.txt`     | **Deleted** | Compaction agent prompt removed                                               |
| `src/session/prompt.ts`               | Modified    | Remove 6 compaction call sites, add Gap F tail filter                         |
| `src/session/processor.ts`            | Modified    | Remove `needsCompaction` flag, handle `ContextOverflowError` as session error |
| `src/session/llm.ts`                  | Modified    | Gap D+C slot reorder                                                          |
| `src/provider/transform.ts`           | Modified    | Gap C cache breakpoint reorder                                                |
| `src/session/om/observer.ts`          | Modified    | Gap E tool part inclusion                                                     |
| `src/session/system.ts`               | Modified    | Gap C — wrapObservations used at BP3 slot                                     |
| `src/server/routes/session.ts`        | Modified    | Remove `/compact` endpoint                                                    |
| `src/agent/agent.ts`                  | Modified    | Remove compaction agent definition                                            |
| `src/config/config.ts`                | Modified    | Remove compaction config block                                                |
| `src/session/message-v2.ts`           | **Kept**    | `filterCompacted` stays for DB backwards compat                               |
| `test/session/compaction.test.ts`     | **Deleted** | Compaction tests removed                                                      |
| `test/session/cut-point.test.ts`      | **Deleted** | Cut-point tests removed                                                       |
| `test/session/revert-compact.test.ts` | **Deleted** | Revert-compact tests removed                                                  |

## Risks

| Risk                                                                                                    | Likelihood | Mitigation                                                                           |
| ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| First ~30k tokens of a new session have no OM observations yet — Gap F returns full `msgs` (boundary=0) | Low        | `boundary === 0` → use full `msgs` as today. No regression.                          |
| Real provider overflow (413) before OM fires                                                            | Low        | `ContextOverflowError` becomes a visible session error; user can start a new session |
| Existing sessions with compacted history in DB                                                          | Low        | `filterCompacted` stays — deserialization and display unaffected                     |
| Plugin `experimental.session.compacting` hook removed                                                   | Low        | Plugin API breaking change — document in release notes                               |

## Rollback Plan

Git revert of the change commit. No DB migration involved — `CompactionPart` schema stays in message-v2, existing rows deserialize normally.

## Dependencies

- OM Observer must be functional (it is — all om-mastra-gaps, om-quality, om-observation-groups changes are merged)
- Engram must be connected for best-case behavior (recall at system[1]); system degrades gracefully without it

## Success Criteria

- [ ] `compaction.ts`, `cut-point.ts`, `overflow.ts` deleted — no references remain in non-test source
- [ ] `bun typecheck` passes
- [ ] Full test suite passes (`bun test`)
- [ ] A session that accumulates >40k tokens of tool results does NOT trigger compaction — instead, the message tail is small (only post-`lastObservedAt` messages sent to LLM)
- [ ] Observations block hits BP3 cache on turn N+1 (verified via `cache_write` → `cache_read` progression in token usage)
- [ ] Observer receives and compresses tool result summaries in observations
