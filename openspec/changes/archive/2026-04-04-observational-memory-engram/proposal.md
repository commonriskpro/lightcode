# Proposal: Observational Memory + Engram Integration

## Intent

Implement a 3-layer memory system connecting observational memory (intra-session compression) with Engram (cross-session persistence). Currently, sessions start blind, and `AutoDream` lacks session context. This change gives the agent continuous memory across sessions by injecting past context into the system prompt and threading session data into the dreaming process.

## Scope

### In Scope

- Phase 1 (MVP):
  - Wire `sessionID` into `AutoDream` to read existing `summary: true` messages and pass them to the dream prompt.
  - Implement `SystemPrompt.recall()` to fetch context via Engram `mem_context`, expose it as a dedicated LLM input field (`recall?: string`), and insert it explicitly into `system[1]` in `session/llm.ts` by extending `LLM.StreamInput` (with `step === 1` guard).
  - Add minimal signal fallback for idle sessions with no compaction summaries: use the last 10 user+assistant text msgs capped at ~2000 tokens.
- Safe error handling if Engram is unavailable.

### Out of Scope

- Phase 2 (Full Observer) features: New `ObservationTable` DB migrations and proactive background observation every N tokens.
- Changes to existing prompt caching (BP1-BP4).

## Capabilities

### New Capabilities

- `continuous-memory`: Cross-session memory recall and session-aware dreaming.

### Modified Capabilities

- `session-management`: System prompt construction and idle dreaming behavior.

## Approach

**Phase 1 MVP:**

1. **Recall Fetch:** Update `prompt.ts` (lines 1679–1696) to add `SystemPrompt.recall()` inside the parallel `Effect.all`. Guard with `step === 1`, cache in the run closure, and return recall as a dedicated field.
2. **LLM Shape Update:** Add `recall?: string` to the LLM input shape so recall is kept separate from `input.system`.
3. **Cache-safe Placement:** In `session/llm.ts`, insert recall explicitly between base `system[0]` and volatile content (`system[2]`) so recall occupies `system[1]`.
4. **AutoDream Fix:** Keep `run(focus?: string)` as public API in `dream/index.ts`, add internal `idle(sid: string)`, and wire Idle events through `Bus.subscribe(Event.Idle, (event) => { void idle(event.properties.sessionID) })`. Read session summaries; if none exist, fallback to recent msgs and pass that context to the dream prompt.

## Affected Areas

| Area                    | Impact   | Description                                                        |
| ----------------------- | -------- | ------------------------------------------------------------------ |
| `src/session/prompt.ts` | Modified | Fetch recall on `step === 1` and return it as own field            |
| `src/session/llm.ts`    | Modified | Extend `LLM.StreamInput` and insert recall as `system[1]`          |
| `src/dream/index.ts`    | Modified | Keep `run(focus?)`, add internal `idle(sid)`, add summary fallback |
| `src/session/system.ts` | Modified | Implement `SystemPrompt.recall()` calling Engram                   |

## Risks

| Risk                           | Likelihood | Mitigation                                                                                                                                                                                                   |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Break prompt caching (BP1-BP4) | High       | Keep recall out of `input.system`; insert explicitly as `system[1]` via `system.splice(1, 0, input.recall)` AFTER the base join at line 115 of `session/llm.ts`; `system[0]` (BP2, 1h TTL) is never modified |
| Engram unavailable             | Medium     | Wrap Engram calls in `Effect.catchAll` to return `undefined` on failure                                                                                                                                      |
| AutoDream model failure        | Low        | Maintain existing fallback/error handling in dream execution                                                                                                                                                 |

## Rollback Plan

Revert changes to `prompt.ts` and `dream/index.ts` to restore the purely reactive, isolated session behavior. Since Phase 1 involves no DB migrations, rollback is a simple code revert.

## Dependencies

- Engram MCP (`dream/engram.ts`) must be installed and active.

## Success Criteria

- [ ] New sessions successfully recall context from previous sessions via Engram.
- [ ] Prompt caching metrics remain unaffected by the recall injection.
- [ ] AutoDream successfully reads session summaries when triggered by idle events.
