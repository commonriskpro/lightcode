# OM Replaces Compaction — Architecture Decision Record

**Date:** 2026-04-05  
**Status:** ✅ Implemented  
**Change:** `om-replace-compaction`

---

## Decision

Delete the emergency compaction system entirely and make the Observational Memory (OM) Observer the **sole mechanism** for keeping context size in check.

---

## What Was Deleted (and Why)

### Files removed

| File                                  | Lines | Reason                                           |
| ------------------------------------- | ----- | ------------------------------------------------ |
| `session/compaction.ts`               | 558   | Emergency LLM-based compaction at ~192k tokens   |
| `session/cut-point.ts`                | 60    | Cut-point algorithm (summarize old, keep recent) |
| `session/overflow.ts`                 | 22    | Overflow detector (context_size - max_output)    |
| `agent/prompt/compaction.txt`         | ~30   | Compaction agent prompt                          |
| `test/session/compaction.test.ts`     | 1212  | Compaction unit tests                            |
| `test/session/cut-point.test.ts`      | 193   | Cut-point unit tests                             |
| `test/session/revert-compact.test.ts` | 621   | Revert-compact integration tests                 |

**Total deleted: ~2700 lines**

### Also removed

- Compaction agent from `agent/agent.ts`
- `compaction` config block from `config/config.ts` (keys: `auto`, `prune`, `reserved`, `keep`)
- `POST /session/:id/compact` endpoint from `server/routes/session.ts`
- `needsCompaction` flag and `Stream.takeUntil` from `processor.ts`
- All 6 compaction call sites from `prompt.ts`
- `SessionCompaction.defaultLayer` from the service layer stack

### Why the architectures are incompatible

The emergency compaction and the OM Observer are philosophically opposite:

- **Compaction**: let context grow → panic at ~192k → LLM summarizes entire history in one blocking call
- **OM**: compress proactively every ~30k tokens → context never grows unbounded → no emergency

Running both simultaneously was wasteful: OM did the work, but the message array never shrank because `filterCompacted` returned all post-compaction messages regardless. Compaction still fired at ~192k tokens even when OM was producing good observations.

---

## What Replaced It

### Tail filtering (Gap F)

**File:** `session/prompt.ts`

```ts
const omBoundary = obsRec?.last_observed_at ?? 0
const lastMessages = omCfg.experimental?.last_messages ?? 40
const tail = omBoundary > 0 ? msgs.filter((m) => (m.info.time?.created ?? 0) > omBoundary) : msgs.slice(-lastMessages)
```

After the Observer activates (~30k tokens), the LLM call only sees messages created after `last_observed_at`. Everything before that is in the observations block (`system[1]`). The message array is always small.

### lastMessages safety cap (Gap 3)

**File:** `session/prompt.ts` + `config/config.ts`

When `omBoundary === 0` (new session, Observer hasn't fired yet), `msgs.slice(-lastMessages)` limits the array. Default: 40 messages. Configurable via `experimental.last_messages`.

### Continuation hint (Gap 1)

**File:** `session/system.ts` + `session/prompt.ts`

When the tail starts mid-conversation, a synthetic `role: "user"` message with `time.created=0` is prepended:

```
<system-reminder>
Please continue naturally with the conversation so far and respond to the latest message.
Use the earlier context only as background. ...
</system-reminder>
```

This orients the model when the array begins abruptly because older turns are already in observations.

### Provider overflow errors

If the LLM provider returns a context overflow error (413 / `context_length_exceeded`), it is now surfaced as a **visible session error** instead of triggering compaction. The user sees the error and can start a new session.

This is the expected behavior in normal use: with OM active, the context never approaches the limit. If it somehow does (e.g., a single massive file attachment), the error is shown clearly.

---

## What Was Kept for Backwards Compatibility

### `filterCompacted` / `filterCompactedEffect` in `message-v2.ts`

Kept because existing sessions in SQLite may have `CompactionPart` entries (from before the migration). `filterCompacted` loads the message history correctly for those sessions — it detects compaction boundaries and returns messages from the last compaction point forward.

### `CompactionPart` schema type in `message-v2.ts`

The `type: z.literal("compaction")` schema type is kept so that existing DB rows deserialize without error. The `toModelMessages` function still converts compaction parts to `"What did we do so far?"` text for display purposes.

### `filterCompacted` in the run loop

`prompt.ts:1475` still calls `filterCompactedEffect(sessionID)` to load all messages (including legacy compacted sessions). The tail filter is applied on top of this, AFTER loading.

---

## Configuration Changes

### Removed keys

```jsonc
// REMOVED — no longer valid
{
  "compaction": {
    "auto": true, // deleted
    "prune": true, // deleted
    "reserved": 20000, // deleted
    "keep": 20000, // deleted
  },
}
```

### New keys

```jsonc
{
  "experimental": {
    "last_messages": 40, // safety cap before first Observer cycle
    "observer_max_tool_result_tokens": 500, // per-tool cap for Observer input
  },
}
```

---

## Migration Behavior for Existing Sessions

Existing sessions with compacted history work transparently:

- `filterCompacted` detects legacy compaction boundaries and returns messages from the last summary point forward
- `CompactionPart` rows deserialize correctly
- The model receives the legacy compaction message as "What did we do so far?" text
- No DB migration required

---

## Test Coverage

Compaction test files deleted. New behavior covered by:

- `test/session/observer.test.ts` — Observer tool parts (Gap E), slot order (Gap D+C)
- `test/session/prompt-effect.test.ts` — full session loop without compaction
- `test/session/processor-effect.test.ts` — `ContextOverflowError` now surfaces as session error (not compaction trigger)
- `test/agent/agent.test.ts` — compaction agent no longer exists
- `test/session/message-v2.test.ts` — `filterCompacted` still works for legacy sessions

**Test count after deletion:** 2053 pass, 0 fail (net: removed 2026 compaction-specific tests, added 3 replacement tests).
