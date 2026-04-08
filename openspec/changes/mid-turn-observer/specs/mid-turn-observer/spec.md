# Delta for mid-turn-observer

## ADDED Requirements

### Requirement: mid-turn-om-check

After each LLM step completes, the system MUST call `OMBuf.check()` with the step's token count (input + output tokens from `value.usage`). This check MUST happen inside the `finish-step` event handler in `processor.ts`, after per-step token accounting is complete.

The check MUST use the same OM configuration parameters (`observer_message_tokens`, `observer_block_after`) as the end-of-turn check in `prompt.ts`.

#### Scenario: check fires after each step

- GIVEN a session where the actor is mid-turn with multiple steps
- WHEN a `finish-step` event is emitted by the LLM stream
- THEN `OMBuf.check(sessionID, stepTok, obsRec?.observation_tokens, cfgThreshold, cfgBlockAfter)` is called with the step's `input + output` token count
- AND `OMBuf.state.tok` accumulates correctly without double-counting against the end-of-turn check

#### Scenario: idle signal produces no action

- GIVEN the token accumulator has not crossed a new INTERVAL boundary
- WHEN `OMBuf.check()` is called mid-turn
- THEN the result is `"idle"` and no Observer is dispatched

---

### Requirement: mid-turn-buffer-dispatch

When `OMBuf.check()` returns `"buffer"` mid-turn AND no Observer is already `inFlight` for the session, the system MUST fire `Observer.run()` asynchronously (fire-and-forget) with all unobserved messages accumulated up to that point in the session.

The async closure MUST be registered with `OMBuf.setInFlight(sessionID, p)` before returning from the `finish-step` handler so that subsequent checks (both mid-turn and end-of-turn) can detect the in-flight state.

The mid-turn Observer dispatch MUST NOT block or delay the `finish-step` handler — it is always fire-and-forget.

#### Scenario: observer fires mid-turn when budget crossed

- GIVEN a turn with 20 steps where the `"buffer"` threshold is crossed at step 5
- WHEN step 5's `finish-step` handler calls `OMBuf.check()` and receives `"buffer"`
- AND no Observer is currently `inFlight`
- THEN `Observer.run()` is called asynchronously with the messages unobserved since `boundary` and not in `observed_message_ids`
- AND `OMBuf.setInFlight(sessionID, p)` is called before the handler returns
- AND the `finish-step` handler returns without awaiting the Observer

#### Scenario: no duplicate dispatch when already in-flight

- GIVEN a mid-turn Observer was already launched at step 5 and is still `inFlight`
- WHEN step 8's `finish-step` handler calls `OMBuf.check()` and receives `"buffer"` again
- THEN `OMBuf.getInFlight(sessionID)` returns a non-null promise
- AND no new `Observer.run()` call is made

#### Scenario: observer skipped when buffer signal on activate/block threshold

- GIVEN the token accumulator has crossed the `"activate"` threshold
- WHEN `OMBuf.check()` is called mid-turn
- THEN the result is `"activate"` or `"block"` — not `"buffer"`
- AND the mid-turn handler takes no action (activate/block are handled end-of-turn only)

---

### Requirement: mid-turn-message-collection

The mid-turn Observer MUST be passed all messages that are unobserved at the moment of dispatch. "Unobserved" is defined identically to the end-of-turn check: messages whose `time.created` is after `OM.get(sessionID).last_observed_at`, whose `id` is not in `observed_message_ids`, and whose `time.created` is after the current `OMBuf.sealedAt(sessionID)` boundary (if non-zero).

#### Scenario: unobserved messages collected correctly

- GIVEN a session with 10 messages, 4 of which are already in `observed_message_ids`
- WHEN the mid-turn Observer fires at step 5
- THEN `Observer.run()` receives exactly the 6 unobserved messages
- AND the 4 already-observed messages are excluded

#### Scenario: empty unobserved set skips observer

- GIVEN all messages are already observed (`observed_message_ids` covers them all)
- WHEN `OMBuf.check()` returns `"buffer"` mid-turn
- THEN `unobserved` is empty
- AND `Observer.run()` is NOT called (or returns immediately on empty context)

---

### Requirement: mid-turn-no-double-observe

When a mid-turn Observer fires and writes its result via `OM.addBufferSafe()`, the end-of-turn `"buffer"` branch in `prompt.ts` MUST NOT observe the same messages again.

The existing `inFlight` guard in `prompt.ts` (`if (!OMBuf.getInFlight(sessionID))`) is the primary deduplication mechanism. The durable `observed_message_ids` written by `addBufferSafe` is the secondary fallback.

#### Scenario: end-of-turn skips when mid-turn observer in-flight

- GIVEN a mid-turn Observer was launched at step 5 and is still running when the turn ends
- WHEN the end-of-turn `OMBuf.check()` in `prompt.ts` returns `"buffer"`
- THEN `OMBuf.getInFlight(sessionID)` is non-null
- AND the end-of-turn `"buffer"` branch does NOT launch a new `Observer.run()`

#### Scenario: end-of-turn skips when mid-turn observer already completed

- GIVEN a mid-turn Observer completed at step 12 and wrote its result (clearing `inFlight`)
- AND the messages it observed are now in `observed_message_ids`
- WHEN the end-of-turn `"buffer"` check fires
- THEN `unobserved` filtered by `observed_message_ids` is empty (or contains only post-step-12 messages)
- AND no duplicate observation is written

---

### Requirement: mid-turn-observer-result-write

When `Observer.run()` produces a non-null result mid-turn, the system MUST write it via `OM.addBufferSafe()` using the same fields as the end-of-turn write: `id`, `session_id`, `observations`, `message_tokens`, `observation_tokens`, `starts_at`, `ends_at`, `first_msg_id`, `last_msg_id`, `time_created`, `time_updated`.

After a successful write, `OMBuf.seal(sessionID, sealAt)` MUST be advanced to the timestamp of the last observed message.

`OMBuf.clearInFlight(sessionID)` MUST be called in the `finally` block of the async closure regardless of success or failure.

#### Scenario: successful mid-turn write advances seal

- GIVEN the mid-turn Observer runs successfully and returns observations
- WHEN `OM.addBufferSafe()` is called
- THEN `OMBuf.seal(sessionID, sealAt)` is called with the `time.created` of the last observed message
- AND `OMBuf.clearInFlight(sessionID)` is called in `finally`

#### Scenario: failed observer clears in-flight

- GIVEN `Observer.run()` throws or returns `undefined`
- WHEN the async closure's `finally` block executes
- THEN `OMBuf.clearInFlight(sessionID)` is called
- AND no write to `OM.addBufferSafe()` occurs
- AND the turn continues normally

---

### Requirement: activate-block-end-of-turn-only

The `"activate"` and `"block"` signals from `OMBuf.check()` MUST continue to be handled at end-of-turn only (in `prompt.ts`). The mid-turn check in `processor.ts` MUST only act on the `"buffer"` signal.

#### Scenario: activate signal ignored mid-turn

- GIVEN `OMBuf.check()` returns `"activate"` during a `finish-step` event
- WHEN the mid-turn handler evaluates the signal
- THEN no `OM.activate()` call is made
- AND no Reflector is run
- AND the turn continues to completion where the end-of-turn check will handle `"activate"`
