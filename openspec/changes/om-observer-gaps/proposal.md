# Proposal: om-observer-gaps

## Problem

The Observer prompt has four documented gaps relative to Mastra's reference implementation:

1. **Completion tracking** — Observer generates observations but has no instruction to emit `✅` markers when tasks are done. The Reflector preserves them but they're never created.
2. **Conversation context** — The prompt captures generic facts but says nothing about code snippets, requirements, or multi-step sequences that appear in technical conversations.
3. **User message capture** — No guidance on whether to capture user messages near-verbatim vs. summarize — critical distinction for fidelity.
4. **Thread title** — The Observer already emits `<suggested-response>` and `<current-task>`. Adding `<thread-title>` (2–5 words) would give the UI a LLM-generated title without a separate agent call.

## Scope

Affects only `packages/opencode/src/session/om/observer.ts` (the `PROMPT` constant) and `packages/opencode/src/session/processor.ts` (consuming `threadTitle` from `ObserverResult`). No schema changes. No new files.

## Capabilities

### Modified Capabilities

- `memory` — Delta spec adds four new requirements to the existing observer prompt spec.

## Approach

- Add `✅` completion marker instructions to the `PROMPT` constant.
- Add conversation-context guidance (code snippets, sequences, requirements).
- Add near-verbatim vs. summarize distinction for user message capture.
- Add `<thread-title>` XML tag to the Observer output format, parsed in `parseObserverOutput`.
- Consume `threadTitle` in `processor.ts` → call `Session.setTitle` when session title is still default.

## Impact Assessment

- **Prompt caching**: `PROMPT` is in `system` (volatile segment) — no cache impact.
- **Rollback**: Revert the string change to `PROMPT` and remove `threadTitle` field.
- **Risk**: Low. Pure prompt engineering + additive parse change.
