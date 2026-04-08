# Design: mid-turn-observer

## Technical Approach

The Observer/Memory system compresses conversation history into observations via `Observer.run()`. Today `OMBuf.check()` is called once per turn in `prompt.ts` — after the full LLM stream has finished — with the accumulated token count of the last completed assistant message. For long turns (20+ steps), the check fires too late: the actor works with stale memory throughout the turn and only gets fresh observations on the next turn.

The fix is to hook into the `finish-step` event in `processor.ts`, which fires after every individual step (each model round-trip + tool execution cycle). After the per-step token accounting already done in `finish-step`, we call `OMBuf.check()` with the step's token count. If the accumulated total crosses the `"buffer"` threshold, we dispatch `Observer.run()` fire-and-forget using the existing `inFlight` mechanism.

The existing `inFlight` guard in the end-of-turn `"buffer"` branch in `prompt.ts` (`if (!OMBuf.getInFlight(sessionID))`) already handles deduplication — no change to `prompt.ts` is required. The `"activate"` and `"block"` signals remain end-of-turn only; mid-turn only acts on `"buffer"`.

**Token accounting**: `OMBuf.check()` accumulates tokens additively via `s.tok += tok`. The end-of-turn call in `prompt.ts` passes `lastFinished.tokens.input + lastFinished.tokens.output` — the full turn's total. After adding mid-turn calls, the per-step tokens are added during the turn; the end-of-turn call would double-count if it still passes the full turn total. **Solution**: at end-of-turn, pass `0` as `tok` to `OMBuf.check()` so the accumulator is not incremented again — the check still reads `s.tok` and returns the correct signal based on what was already accumulated mid-turn. Alternatively, switch the end-of-turn site to `OMBuf.check(sessionID, 0, ...)` once mid-turn accounting is active.

## Architecture Decisions

### Decision: hook in `processor.ts` `finish-step`, not `prompt.ts` loop

**Choice**: Add the mid-turn check inside the `finish-step` case in `SessionProcessor.handleEvent()` in `processor.ts`.

**Alternatives considered**:

- Hook in `prompt.ts` loop body using an `onFinishStep` callback passed to the LLM stream. This requires threading a callback through `LLM.stream()` and `streamInput` — significant interface churn for a small feature.
- Hook inside `llm.ts` `prepareStep` or via a custom `onFinishStep` option on the AI SDK call. The AI SDK's `onFinishStep` is not currently surfaced through LightCode's event abstraction.

**Rationale**: `finish-step` in `processor.ts` is the canonical post-step hook. It already has `ctx.sessionID`, `ctx.assistantMessage`, access to `value.usage`, and all dependencies. Zero interface changes needed.

---

### Decision: only handle `"buffer"` mid-turn; `"activate"` and `"block"` remain end-of-turn

**Choice**: The `finish-step` handler only acts when `OMBuf.check()` returns `"buffer"`. It ignores `"activate"` and `"block"`.

**Alternatives considered**:

- Handle `"activate"` mid-turn too. This would require running `OM.activate()` and optionally the Reflector mid-turn. The Reflector is expensive and involves another LLM call; running it mid-turn risks blocking or significantly delaying the turn. The end-of-turn check already handles `"activate"` correctly.

**Rationale**: `"buffer"` is fire-and-forget by design — it's safe mid-turn. `"activate"` and `"block"` require synchronous coordination (waiting for prior in-flight, calling `OM.activate()`, potentially running Reflector) that cannot be fire-and-forget. Keeping them end-of-turn avoids complexity and risk.

---

### Decision: reuse `inFlight` for deduplication — no new state

**Choice**: The existing `OMBuf.setInFlight` / `OMBuf.getInFlight` / `OMBuf.clearInFlight` API handles mid-turn concurrency without any new state fields.

**Alternatives considered**:

- Add a `midTurnFired` boolean to `ProcessorContext`. Simpler to read, but requires a new context field and doesn't cover the case where the async Observer from a prior step is still running when the next step's check fires — `inFlight` already covers this.

**Rationale**: `inFlight` is the canonical "observer in progress" signal, used by both `awaitInFlight` (in `activate`) and the `"buffer"` guard in `prompt.ts`. Reusing it keeps the deduplication logic in one place.

---

### Decision: end-of-turn `"buffer"` site passes `tok=0` after mid-turn accounting

**Choice**: Once mid-turn checks are active, the end-of-turn `OMBuf.check()` call in `prompt.ts` passes `0` as the `tok` argument instead of `lastFinished.tokens.input + lastFinished.tokens.output`.

**Alternatives considered**:

- Keep the end-of-turn call unchanged and accept that `s.tok` may be slightly inflated. The threshold is 6 000 tokens per INTERVAL — inflating by one step's tokens would trigger the next "buffer" at most one INTERVAL early. Tolerable but impure.
- Replace the end-of-turn `check()` with a read-only `OMBuf.peek()` that returns the current signal without incrementing. Cleaner semantics, requires a new API on `buffer.ts`.

**Rationale**: passing `tok=0` requires zero API changes, is correct, and is the least surprising change. A comment at the call site explains why.

## Data Flow

```
LLM stream (multi-step turn)
│
├─ step 1 → finish-step
│   ├─ per-step token accounting (existing)
│   ├─ OMBuf.check(sid, stepTok, obsTokens, threshold, blockAfter)
│   │   → "idle"  (below next INTERVAL boundary)
│   └─ no action
│
├─ step 2 → finish-step
│   ├─ per-step token accounting
│   ├─ OMBuf.check(sid, stepTok, ...)
│   │   → "idle"
│   └─ no action
│
├─ step 5 → finish-step                         ← threshold crossed
│   ├─ per-step token accounting
│   ├─ OMBuf.check(sid, stepTok, ...) → "buffer"
│   ├─ OMBuf.getInFlight(sid) → undefined
│   ├─ collect unobserved = msgs filtered by boundary/obsIds/seal
│   ├─ launch p = async () → Observer.run({ sid, msgs: unobserved, ... })
│   │     → OM.addBufferSafe(...)
│   │     → OMBuf.seal(sid, sealAt)
│   │     → OMBuf.clearInFlight(sid)  [finally]
│   └─ OMBuf.setInFlight(sid, p)
│
├─ steps 6-19 → finish-step
│   ├─ OMBuf.check() → "idle" (INTERVAL not crossed again)
│   └─ no action
│
└─ turn ends → prompt.ts end-of-turn check
    ├─ OMBuf.check(sid, tok=0, ...)  → "buffer" (or "idle")
    ├─ OMBuf.getInFlight(sid) → p (still in-flight or already nil)
    │   → if non-nil: skip dispatch (deduplication)
    │   → if nil: unobserved is empty (addBufferSafe wrote observed_message_ids)
    └─ "activate" / "block" handled normally if threshold crossed
```

## File Changes

| File                                         | Action            | Description                                                                                           |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/processor.ts` | Modified          | Import `OM`, `OMBuf`, `Observer` from `./om`; add mid-turn check + dispatch in `finish-step` handler  |
| `packages/opencode/src/session/prompt.ts`    | Modified (1 line) | Change `tok` arg of end-of-turn `OMBuf.check()` from full-turn tokens to `0` to avoid double-counting |

## Interfaces / Contracts

### `finish-step` mid-turn hook (`processor.ts`)

```ts
// Top of file — add imports
import { OM, OMBuf, Observer } from "./om"
import { Token } from "@/util/token"
import { Config } from "@/config/config"
import { MessageV2 } from "./message-v2"
import { ulid } from "ulid"

// Inside finish-step case, after the existing per-step accounting block
// (after the PromptProfile.updateCache call, before SessionSummary.summarize):

case "finish-step": {
  // ... existing token accounting (lines 276-307) ...

  // Mid-turn OM check — fire background Observer when INTERVAL budget crossed.
  // Only handles "buffer"; "activate" and "block" remain end-of-turn only.
  const stepTok = usage.tokens.input + usage.tokens.output
  const omCfg = await Config.get()
  const obsRec = OM.get(ctx.sessionID)
  const midSig = OMBuf.check(
    ctx.sessionID,
    stepTok,
    obsRec?.observation_tokens,
    omCfg.experimental?.observer_message_tokens,
    omCfg.experimental?.observer_block_after,
  )
  if (midSig === "buffer" && !OMBuf.getInFlight(ctx.sessionID)) {
    const boundary = obsRec?.last_observed_at ?? 0
    const obsIds = new Set<string>(
      obsRec?.observed_message_ids ? (JSON.parse(obsRec.observed_message_ids) as string[]) : [],
    )
    const sealed = OMBuf.sealedAt(ctx.sessionID)
    // Collect all session messages, then filter to unobserved.
    // MessageV2.filterCompactedEffect is Effect-based; use the sync store instead.
    const all = MessageV2.list(ctx.sessionID)
    const unobserved = all.filter(
      (m) =>
        (m.info.time?.created ?? 0) > boundary &&
        !obsIds.has(m.info.id) &&
        (sealed === 0 || (m.info.time?.created ?? 0) > sealed),
    )
    if (unobserved.length > 0) {
      const sealAt = unobserved.at(-1)?.info.time?.created ?? 0
      const msgIds = unobserved.map((m) => m.info.id)
      const p = (async () => {
        OMBuf.setObserving(true)
        try {
          const result = await Observer.run({
            sid: ctx.sessionID,
            msgs: unobserved,
            prev: obsRec?.observations ?? undefined,
            priorCurrentTask: obsRec?.current_task ?? undefined,
          })
          if (result) {
            OM.addBufferSafe(
              {
                id: ulid(),
                session_id: ctx.sessionID,
                observations: result.observations,
                message_tokens: stepTok,
                observation_tokens: Token.estimate(result.observations),
                starts_at: boundary,
                ends_at: unobserved.at(-1)?.info.time?.created ?? Date.now(),
                first_msg_id: unobserved[0]?.info.id ?? null,
                last_msg_id: unobserved.at(-1)?.info.id ?? null,
                time_created: Date.now(),
                time_updated: Date.now(),
              },
              ctx.sessionID,
              msgIds,
            )
            if (sealAt > 0) OMBuf.seal(ctx.sessionID, sealAt)
          }
        } catch (err) {
          log.error("mid-turn observer failed", { err })
        } finally {
          OMBuf.setObserving(false)
          OMBuf.clearInFlight(ctx.sessionID)
        }
      })()
      OMBuf.setInFlight(ctx.sessionID, p)
    }
  }

  // ... rest of finish-step (LSP diagnostics, SessionSummary) ...
}
```

### End-of-turn `OMBuf.check()` — token argument fix (`prompt.ts`)

```ts
// Before (line ~1698-1708):
const tok = (lastFinished?.tokens?.input ?? 0) + (lastFinished?.tokens?.output ?? 0)
const obsRec = OM.get(sessionID)
let freshObsRec: typeof obsRec
const omCfg = yield * Effect.promise(() => Config.get())
const sig = OMBuf.check(
  sessionID,
  tok, // ← passes full-turn total
  obsRec?.observation_tokens,
  omCfg.experimental?.observer_message_tokens,
  omCfg.experimental?.observer_block_after,
)

// After:
const tok = (lastFinished?.tokens?.input ?? 0) + (lastFinished?.tokens?.output ?? 0)
const obsRec = OM.get(sessionID)
let freshObsRec: typeof obsRec
const omCfg = yield * Effect.promise(() => Config.get())
const sig = OMBuf.check(
  sessionID,
  0, // ← 0: mid-turn checks already accumulated; don't double-count
  obsRec?.observation_tokens,
  omCfg.experimental?.observer_message_tokens,
  omCfg.experimental?.observer_block_after,
)
// Note: `tok` is still used below for OM.addBufferSafe message_tokens — keep the variable.
```

### How the existing `inFlight` guard prevents double-observation (`prompt.ts`)

The end-of-turn `"buffer"` branch already has the correct guard — no change needed:

```ts
// prompt.ts ~line 1731-1800 (existing, unchanged):
if (sig === "buffer") {
  if (!OMBuf.getInFlight(sessionID)) {
    // ← guard: skip if mid-turn observer in-flight
    // ... collect unobserved, launch Observer.run() ...
    OMBuf.setInFlight(sessionID, p)
  }
}
```

When a mid-turn Observer is still running, `getInFlight()` returns its promise → guard prevents a second launch. When the mid-turn Observer already finished, `observed_message_ids` has been updated by `addBufferSafe` → the `unobserved` filter returns an empty array → `Observer.run()` gets no context → returns `undefined` → `addBufferSafe` is not called.

## Testing Strategy

### Unit — mid-turn check fires at INTERVAL boundary

```ts
// buffer.test.ts (extend existing)
it("mid-turn check returns buffer at first INTERVAL crossing", () => {
  OMBuf.reset("s1")
  expect(OMBuf.check("s1", 5_999)).toBe("idle")
  expect(OMBuf.check("s1", 1)).toBe("buffer") // crosses 6_000
  expect(OMBuf.check("s1", 1)).toBe("idle") // same interval
})
```

### Unit — double-dispatch prevention via inFlight

```ts
it("second buffer signal is skipped when inFlight is set", () => {
  const p = Promise.resolve()
  OMBuf.setInFlight("s2", p)
  expect(OMBuf.getInFlight("s2")).toBe(p)
  // Caller-side: if (getInFlight) skip → no second Observer.run() call
  OMBuf.clearInFlight("s2")
  expect(OMBuf.getInFlight("s2")).toBeUndefined()
})
```

### Unit — end-of-turn tok=0 does not increment accumulator

```ts
it("check with tok=0 reads current state without advancing", () => {
  OMBuf.reset("s3")
  OMBuf.check("s3", 5_000) // → idle, s.tok = 5_000
  const before = OMBuf.tokens("s3") // 5_000
  OMBuf.check("s3", 0) // → idle, s.tok still 5_000
  expect(OMBuf.tokens("s3")).toBe(before)
})
```

### Integration — Observer fires at step 5 not step 20

Simulate a 20-step turn by calling `OMBuf.check()` in a loop with synthetic step tokens. Assert that `Observer.run` is called after the step that crosses the INTERVAL, not after step 20.

```ts
it("observer fires mid-turn, not at end of turn", async () => {
  const runs: number[] = []
  let step = 0
  for (; step < 20; step++) {
    const sig = OMBuf.check("s4", 400) // 400 tok/step → crosses 6_000 at step 15
    if (sig === "buffer" && !OMBuf.getInFlight("s4")) {
      runs.push(step)
      const p = (async () => {
        /* mock Observer.run */
      })()
      OMBuf.setInFlight("s4", p)
      await p
      OMBuf.clearInFlight("s4")
    }
  }
  expect(runs).toEqual([15]) // fires once, at step 15 (6_000 / 400)
  expect(runs.length).toBe(1) // not twice
})
```

### Regression — existing buffer/activate/block tests unchanged

Run the existing `om/buffer.test.ts` suite. No changes to `OMBuf.check()` logic means all existing tests should pass unmodified.

### Manual verification

1. Start a session with a large codebase and send a prompt that triggers 20+ tool calls.
2. Watch the TUI sidebar footer for the "observing" indicator — it should appear mid-turn (before the final response), not only after.
3. Check the OM buffer table: a new buffer entry should exist with `ends_at` timestamped during the turn, not at turn end.
4. Verify the next turn's prompt includes the mid-turn observations in `observationsStable`.

## Open Questions

1. **`MessageV2.list()` vs `filterCompactedEffect()`**: `processor.ts` uses Effect throughout. Is there a synchronous `MessageV2.list(sessionID)` call available, or must we use the Effect-based `filterCompactedEffect`? If the latter, the mid-turn block must be wrapped in `yield* Effect.promise(async () => { ... })` or equivalent. Check `message-v2.ts` for a sync accessor before finalising the code.

2. **`Config.get()` once per step**: the mid-turn check calls `Config.get()` on every `finish-step`. Since `Config.get()` is memoized/cached, this should be sub-millisecond — but confirm there's no per-call overhead that would accumulate over 20 steps.

3. **`message_tokens` in mid-turn `addBufferSafe`**: the end-of-turn write uses `tok` (full turn tokens). The mid-turn write should use either the step's token count or the accumulated total at the moment of dispatch. Using the step's `stepTok` is conservative; using `OMBuf.tokens(sessionID)` at dispatch time is more accurate. Decide before implementation.

4. **`tok=0` end-of-turn change**: passing `0` means the end-of-turn check can never return `"buffer"` on its own after mid-turn has been active — the accumulator won't advance. This is correct for the buffer signal but consider whether `"activate"` and `"block"` thresholds also depend on the per-turn increment. Verify that by the end of the turn, `OMBuf.state.tok` has enough accumulated from mid-turn steps to correctly trigger `"activate"` if the budget is truly exhausted.
