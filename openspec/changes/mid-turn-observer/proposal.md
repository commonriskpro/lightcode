# Proposal: mid-turn-observer

## Intent

Fire the background Observer mid-turn — after each LLM step — instead of waiting until the full turn completes. For long turns with many tool calls (20+ steps), the Observer currently runs too late: the actor works with stale memory for the entire turn. By checking the OM token budget after each step, the Observer can activate at step 5 when the threshold is crossed, compressing context while the turn is still in flight, so subsequent steps benefit from fresh observations.

## Scope

### In Scope

- Add a mid-turn `OMBuf.check()` call in the `finish-step` handler inside `processor.ts`.
- When the check returns `"buffer"`, fire `Observer.run()` asynchronously (fire-and-forget) using the `inFlight` mechanism, with all unobserved messages up to that point.
- Guard the mid-turn path: only fire if no Observer is already `inFlight` for the session.
- Pass the step's token count (`usage.tokens.input + usage.tokens.output`) to `OMBuf.check()`.
- Collect unobserved messages for Observer using the same boundary/seal/obsIds logic used by the end-of-turn check in `prompt.ts`.
- Preserve the end-of-turn check in `prompt.ts` as-is for `"activate"` and `"block"` signals; only the `"buffer"` branch needs deduplication awareness.
- Skip the end-of-turn `"buffer"` branch in `prompt.ts` when an Observer triggered mid-turn is already `inFlight`.

### Out of Scope

- `"activate"` and `"block"` signal handling — these remain end-of-turn only.
- Changes to the Observer LLM prompt, output parsing, or storage (`OM.addBufferSafe`).
- Changes to `OMBuf.check()` threshold logic or the INTERVAL constant.
- Changes to the Reflector pipeline.
- Provider-specific code — the hook is in `processor.ts` which is provider-agnostic.
- Reducing observation quality or changing observation semantics.

## Capabilities

### New Capabilities

- **Mid-turn observation**: the Observer can now compress context during a long turn instead of after it, reducing token pressure for later steps within the same turn.

### Modified Capabilities

- **`finish-step` event handler** (`processor.ts`): gains an `OMBuf.check()` call and conditional `Observer.run()` dispatch after per-step accounting.
- **End-of-turn `"buffer"` branch** (`prompt.ts`): gains an `inFlight` guard so it skips when a mid-turn Observer is already running or has just completed.

## Approach

1. **Import `OM`, `OMBuf`, `Observer` into `processor.ts`** — currently these are only imported in `prompt.ts`. The `ProcessorContext` has access to `sessionID` and `assistantMessage`; no new context fields are needed.

2. **In `finish-step`, after per-step token accounting**, compute `stepTok = usage.tokens.input + usage.tokens.output` and call `OMBuf.check(sessionID, stepTok, obsRec?.observation_tokens, cfgThreshold, cfgBlockAfter)`. The OM config must be fetched once per step (or cached in context); the Observer config is already in scope via `Config`.

3. **On `"buffer"` signal**, check `OMBuf.getInFlight(sessionID)`. If already in-flight, skip (the existing observer handles the messages). Otherwise:
   - Collect `unobserved` messages using the same `boundary`/`obsIds`/`sealed` filter used in `prompt.ts`.
   - The messages are available via `MessageV2.filterCompactedEffect(sessionID)` or, more efficiently, from `session.list(sessionID)` since `processor.ts` already has `session` in scope.
   - Launch `Observer.run()` in a fire-and-forget async closure; register it with `OMBuf.setInFlight()`.

4. **The end-of-turn `"buffer"` branch in `prompt.ts`** already checks `OMBuf.getInFlight(sessionID)` before firing — this guard is already correct and handles the deduplication case when a mid-turn Observer has fired. No change needed to `prompt.ts` for deduplication.

## Affected Areas

| Area                                           | Impact          | Description                                                                                            |
| ---------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/opencode/src/session/processor.ts`   | Modified        | `finish-step` handler: add mid-turn `OMBuf.check()` + conditional `Observer.run()` dispatch            |
| `packages/opencode/src/session/prompt.ts`      | None / Verified | `"buffer"` branch already guards with `getInFlight` — no change needed; verify the guard is sufficient |
| `packages/opencode/src/session/om/buffer.ts`   | None            | `OMBuf.check()`, `inFlight` API, and `seal` are reused without modification                            |
| `packages/opencode/src/session/om/observer.ts` | None            | `Observer.run()` signature and behaviour unchanged                                                     |
| `packages/opencode/src/session/om/record.ts`   | None            | `OM.addBufferSafe()`, `OM.get()` reused without modification                                           |

## Risks

| Risk                                                                        | Likelihood | Mitigation                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-observation: mid-turn and end-of-turn both observe the same messages | Low        | `inFlight` guard in `prompt.ts` `"buffer"` branch already prevents this; `addBufferSafe` + `observed_message_ids` is the durable fallback                                                                                                                                                                                                                                        |
| Mid-turn Observer delays or blocks step processing                          | None       | Observer is always fire-and-forget (`OMBuf.setInFlight` + async closure); `finish-step` does not await it                                                                                                                                                                                                                                                                        |
| Token double-counting in `OMBuf.state.tok`                                  | Low        | `OMBuf.check()` accumulates tokens additively; the end-of-turn check in `prompt.ts` passes the full turn's tokens. After adding the mid-turn call, the per-step tokens will have been added already. Must ensure the end-of-turn call uses the **delta** since last check, not the full turn total, or that `OMBuf.add()` is used instead of `check()` for one of the two sites. |
| `Config.get()` called once per step adds latency                            | Very Low   | `Config.get()` is memoized; the async call is sub-millisecond                                                                                                                                                                                                                                                                                                                    |
| Mid-turn Observer fires on a step with no meaningful messages               | Low        | `Observer.run()` returns `undefined` when context is empty; `addBufferSafe` is only called on a non-null result                                                                                                                                                                                                                                                                  |

## Rollback Plan

The change is entirely contained in `processor.ts` (`finish-step` handler additions and new imports). Reverting the three added import lines and the `finish-step` mid-turn block fully restores the previous behaviour. No schema, no DB change, no config change, no API change.

## Dependencies

- `OMBuf.check()`, `OMBuf.getInFlight()`, `OMBuf.setInFlight()`, `OMBuf.clearInFlight()`, `OMBuf.seal()`, `OMBuf.sealedAt()` — all exist in `buffer.ts`, no API changes needed.
- `Observer.run()` — exists in `observer.ts`, signature unchanged.
- `OM.get()`, `OM.addBufferSafe()` — exist in `record.ts`, unchanged.
- `MessageV2.filterCompactedEffect()` or `session.list()` — for collecting unobserved messages inside `processor.ts`.
- `Config.get()` — for reading `observer_message_tokens` and `observer_block_after` thresholds.

## Success Criteria

- [ ] On a 20-step turn where the token budget crosses the `"buffer"` threshold at step 5, the Observer fires at step 5 — not at the end of the turn.
- [ ] The Observer does not fire twice for the same set of messages within a single turn.
- [ ] Steps after the mid-turn Observer fires complete normally — no blocking, no delay.
- [ ] The end-of-turn `"buffer"` check in `prompt.ts` is skipped (via `inFlight` guard) when the mid-turn Observer already handled the messages.
- [ ] `"activate"` and `"block"` signals continue to be handled at end-of-turn only — no regression.
- [ ] `OMBuf.state.tok` accumulates correctly across both mid-turn and end-of-turn checks — no double-counting.
- [ ] Typecheck passes with no new errors.
- [ ] Existing tests pass without modification.
