# Technical Spec: Reactive Compact

## 1. Overview

When the LLM API returns a "prompt too long" / context overflow error, instead of failing, the system should:

1. Detect the error
2. Automatically compact/summarize the conversation
3. Retry the LLM call with the compacted context

## 2. Codebase Analysis — Current State

### The mechanism ALREADY EXISTS but has gaps

The processor's `halt()` function correctly detects `ContextOverflowError`, sets `needsCompaction = true`, and returns `"compact"`. The `runLoop` in `prompt.ts` creates a compaction request and processes it on the next iteration.

### Error Detection (Already Comprehensive)

**File:** `src/provider/error.ts` lines 9-29

Regex patterns that trigger `ContextOverflowError`:

```
/prompt is too long/i                                    — Anthropic
/input is too long for requested model/i                 — Amazon Bedrock
/exceeds the context window/i                            — OpenAI
/input token count.*exceeds the maximum/i                — Google Gemini
/maximum prompt length is \d+/i                          — xAI (Grok)
/reduce the length of the messages/i                     — Groq
/maximum context length is \d+ tokens/i                  — OpenRouter, DeepSeek, vLLM
/exceeds the limit of \d+/i                              — GitHub Copilot
/exceeds the available context size/i                    — llama.cpp
/greater than the context length/i                       — LM Studio
/context window exceeds limit/i                          — MiniMax
/exceeded model token limit/i                            — Kimi/Moonshot
/context[_ ]length[_ ]exceeded/i                         — Generic
/request entity too large/i                              — HTTP 413
/context length is only \d+ tokens/i                     — vLLM
/input length.*exceeds.*context length/i                 — vLLM
/prompt too long; exceeded (?:max )?context length/i     — Ollama
/too large for model with \d+ maximum context length/i   — Mistral
/model_context_window_exceeded/i                         — z.ai
```

Structural checks:

- HTTP status 413 (line 176)
- JSON body `error.code === "context_length_exceeded"` (lines 127, 176)
- `400 (no body)` / `413 (no body)` pattern (line 46) — Cerebras, Mistral

### Current Flow

```
processor.ts halt() → detects ContextOverflowError
  → sets ctx.needsCompaction = true
  → publishes Session.Event.Error  ← BUG: flashes error UI on recoverable overflow
  → returns "compact"

prompt.ts runLoop → receives "compact"
  → creates compaction request
  → processes compaction
  → loops back to retry
```

## 3. Required Changes

### 3.1 Remove Error Event on Recoverable Overflow

**Problem:** `halt()` publishes `Session.Event.Error` even for overflow errors that will be retried after compaction. The user sees an error flash.

**File:** `src/session/processor.ts`, line 421

**Change:** Skip error publish when the error is a `ContextOverflowError`:

```typescript
// Before halt() publishes the error:
if (!isContextOverflow(error)) {
  Bus.publish(Session.Event.Error, { sessionID, error: errorMessage })
}
```

### 3.2 Add Compaction Loop Guard

**Problem:** If compaction doesn't reduce context enough, the system could loop indefinitely: overflow → compact → overflow → compact → ...

**File:** `src/session/prompt.ts`, lines 1614-1623

**Change:** Add a counter and max:

```typescript
const MAX_COMPACTS = 3
let compacts = 0

// Inside the runLoop, when result === "compact":
if (result === "compact") {
  compacts++
  if (compacts > MAX_COMPACTS) {
    // Break with error — compaction cannot reduce context enough
    break
  }
  // ... existing compaction logic
}
```

### 3.3 Clean Up Empty Assistant Message on Overflow

**Problem:** When overflow occurs before the model produces any content, an empty assistant message is left in history.

**File:** `src/session/prompt.ts`, lines 1614-1623

**Change:** Before compacting, check if the assistant message has meaningful content. If not, remove it:

```typescript
if (result === "compact") {
  const parts = MessageV2.parts(handle.message.id)
  const meaningful = parts.some((p) => p.type === "text" || p.type === "tool" || p.type === "reasoning")
  if (!meaningful) {
    yield * sessions.removeMessage({ sessionID, messageID: handle.message.id })
  }
  // ... compaction logic
}
```

### 3.4 Add "compacting" Status (DEFERRED)

Add a `"compacting"` status variant to `SessionStatus` so the UI can show "Compacting conversation..." instead of generic "busy". Non-blocking, nice-to-have.

### 3.5 Pre-flight Token Estimation (DEFERRED)

Before making the LLM call, estimate the current message payload size and pre-emptively compact if it would overflow. Separate follow-up PR.

## 4. Files to Modify

| File                        | Change                                                       | Priority |
| --------------------------- | ------------------------------------------------------------ | -------- |
| `src/session/processor.ts`  | Remove error event publish on overflow (line 421)            | P0       |
| `src/session/prompt.ts`     | Add compaction loop guard + orphan cleanup (lines 1402-1637) | P0       |
| `src/session/retry.ts`      | No changes needed — already correct                          | —        |
| `src/session/compaction.ts` | No changes needed — already correct                          | —        |
| `src/session/overflow.ts`   | No changes needed — already correct                          | —        |
| `src/provider/error.ts`     | No changes needed — patterns comprehensive                   | —        |

## 5. Edge Cases and Risks

| Edge Case                                   | Handling                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Compaction itself overflows**             | `compaction.ts` line 274-283 handles this. Loop guard adds second layer.                             |
| **Partial response before overflow**        | Meaningful-content check ensures we only remove truly empty messages.                                |
| **Race between error event and compaction** | Fixed by removing error publish for overflow errors.                                                 |
| **System prompts alone overflow**           | `compaction.process` checks for content to compact (lines 171-176). Falls back to overflow guidance. |
| **Concurrent requests**                     | `Runner` mechanism ensures one active work item per session. No concurrency risk.                    |
| **Subtask overflow**                        | Subtasks don't go through `runLoop` compaction logic. Pre-existing limitation, out of scope.         |

## 6. Testing Strategy

### Unit Tests

**File:** `test/session/processor-effect.test.ts`

- "processor returns compact on API overflow error without publishing error event"
- "processor returns compact on regex-matched overflow message"

### Integration Tests

**File:** `test/session/compaction.test.ts`

- "reactive compact recovers from API overflow in live flow"
- "reactive compact loop guard stops after MAX_COMPACTS"
- "empty assistant message is removed on overflow before compaction"

### Existing Tests (Verify No Regressions)

- `processor-effect.test.ts`: "compact on structured context overflow"
- `processor-effect.test.ts`: "stop after token overflow requests compaction"
- `compaction.test.ts`: "marks summary message as errored on compact result"
- `compaction.test.ts`: "replays the prior user turn on overflow"
- `retry.test.ts`: all tests unchanged

## 7. Summary

| #   | Change                                     | File                         | Impact                          |
| --- | ------------------------------------------ | ---------------------------- | ------------------------------- |
| 1   | Remove error event on recoverable overflow | `processor.ts:421`           | Eliminates UI error flash       |
| 2   | Add compaction loop guard                  | `prompt.ts:1615`             | Prevents infinite compact loops |
| 3   | Clean up empty assistant message           | `prompt.ts:1615`             | Removes orphaned messages       |
| 4   | _(Deferred)_ Add "compacting" status       | `status.ts`, `compaction.ts` | Better UX                       |
| 5   | _(Deferred)_ Pre-flight token estimation   | `prompt.ts:1477`             | Proactive overflow prevention   |

**Estimated effort:** Changes 1-3 are ~30-40 lines of code.
