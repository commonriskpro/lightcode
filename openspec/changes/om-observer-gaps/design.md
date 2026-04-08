# Design: om-observer-gaps

## Technical Approach

Pure prompt engineering (3 of 4 gaps) + one additive parse/consume change for `<thread-title>`. No schema migrations, no new files, no Effect refactoring.

## Architecture Decisions

| Decision                      | Choice                                                                            | Alternatives                                   | Rationale                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Where to add ✅ guidance      | Inside existing `PROMPT` constant, new `## COMPLETION TRACKING` section           | Separate CONDENSE_PROMPT update                | Observer generates; Reflector already preserves — only Observer needs the new section             |
| Thread title persistence      | Call `Session.setTitle` (sync, non-Effect) in the `buffer` path in `processor.ts` | Store on `ObservationTable`, separate LLM call | `Session.setTitle` already exists; processor already has session context; avoids DB schema change |
| Where title guard lives       | `processor.ts` — check `Session.isDefaultTitle(session.title)` before calling     | Inside `parseObserverOutput`                   | `observer.ts` has no session context; guard belongs at the call site                              |
| ✅ marker position            | Start of bullet, before role emoji                                                | After role emoji                               | `truncateObsToBudget` already scans `includes("✅")` — position before emoji keeps that working   |
| Conversation context guidance | New `## CONVERSATION CONTEXT` section in `PROMPT`                                 | Separate prompt per message type               | One prompt, zero parsing changes                                                                  |
| Near-verbatim fidelity        | New `## USER MESSAGE FIDELITY` section in `PROMPT`                                | Post-process filter                            | Observer LLM decides at generation time — more accurate than a post-hoc filter                    |

## Data Flow

```
Observer.run()
  │
  ├─ PROMPT (modified) ──→ LLM ──→ raw text
  │                                    │
  │                           parseObserverOutput()
  │                                    │
  │                    ┌───────────────┴───────────────┐
  │               observations   currentTask   threadTitle (NEW)
  │               suggestedContinuation
  │
  └─ returns ObserverResult { ..., threadTitle?: string }

processor.ts (buffer path)
  │
  ├─ Observer.run() → result
  ├─ OM.addBufferSafe(...)         ← unchanged
  └─ if result.threadTitle && Session.isDefaultTitle(session.title)
       Session.setTitle(sid, result.threadTitle)  ← NEW (sync call)
```

## File Changes

| File                                              | Action | Description                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencode/src/session/om/observer.ts`    | Modify | Add `## COMPLETION TRACKING`, `## CONVERSATION CONTEXT`, `## USER MESSAGE FIDELITY` sections to `PROMPT`; add `<thread-title>` to output format; extend `ObserverResult` with `threadTitle?: string`; update `parseObserverOutput` to extract it |
| `packages/opencode/src/session/processor.ts`      | Modify | After `OM.addBufferSafe`, read current session info and conditionally call `Session.setTitle` with `result.threadTitle`                                                                                                                          |
| `packages/opencode/test/session/observer.test.ts` | Modify | Add tests for `parseObserverOutput` with `<thread-title>` tag; add test for missing tag                                                                                                                                                          |

## Interfaces / Contracts

```ts
// observer.ts — extended
export interface ObserverResult {
  observations: string
  currentTask?: string
  suggestedContinuation?: string
  threadTitle?: string // NEW — 2-5 words, may be undefined
}
```

```ts
// PROMPT additions (conceptual, not code)
## COMPLETION TRACKING
When the assistant has clearly completed a task in this turn, prefix the
observation with ✅ (before any 🔴/🟡 marker):
  ✅ 🔴 HH:MM Built authentication middleware using JWT (express, jsonwebtoken)
Only emit ✅ when completion is unambiguous. Never emit speculatively.

## CONVERSATION CONTEXT
Capture as 🔴 user assertions:
- Code snippets / file contents the user provides as current system state
  → Note language, key identifiers, constraints visible in the code
- Multi-step sequences: record each step as a separate bullet
- Explicit constraints ("must use X", "never do Y") — preserve verbatim

## USER MESSAGE FIDELITY
Near-verbatim (MUST preserve): names, numbers, identifiers, URLs, constraints
Summarize or omit: conversational filler, repeated acknowledgements, "thanks"
Rule: if a value could matter later, keep it exact.

## Output Format (addition)
<thread-title>
2-5 words capturing the session's current focus (e.g. "Fix JWT Auth Bug")
</thread-title>
```

## Testing Strategy

| Layer | What to Test                                                           | Approach                              |
| ----- | ---------------------------------------------------------------------- | ------------------------------------- |
| Unit  | `parseObserverOutput` extracts `threadTitle`                           | bun test, extend existing parse tests |
| Unit  | `parseObserverOutput` returns `undefined` when tag absent              | bun test                              |
| Unit  | `truncateObsToBudget` preserves `✅` lines (already tested implicitly) | verify existing tests pass            |
| Unit  | `processor.ts` title guard: isDefaultTitle check                       | integration test or manual            |

## Migration / Rollout

No migration required. The `PROMPT` change is backward-compatible — the Observer LLM will start emitting `<thread-title>` and `✅` markers; existing sessions that lack them continue to work. `parseObserverOutput` returns `undefined` for missing tags (existing fallback pattern).

## Open Questions

- None. All design decisions are resolvable from existing code.
