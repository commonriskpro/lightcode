# Proposal: Observational Memory Reflector

## Intent

Reduce context window bloat and maintain agent focus in long-running sessions by condensing large `observations` strings into tighter `reflections`. This addresses the problem of `observations` growing unbounded over time.

## Scope

### In Scope

- Create background Reflector LLM logic.
- Add `OM.reflect(sid, text)` update method.
- Trigger Reflector automatically when `observation_tokens > 40_000`.
- Inject `reflections` (if present) instead of `observations` into the system prompt.
- Conservative prompt design preserving key markers (🔴🟡) and user assertions.

### Out of Scope

- Database schema changes (using existing `reflections` column).
- Multi-level compression (Mastra levels 0-4).
- Thread attribution and XML output tags.
- Current-task/suggested-response tracking.
- New configuration keys (reusing `observer_model`).

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `observational-memory`: Now supports background reflection compression when observations exceed 40k tokens to optimize system prompt injection.

## Approach

Keep `observations` accumulating as the Observer input, but use `reflections` as the condensed injection surface for the main agent context (`system[2]`). The Reflector will be triggered via a non-blocking `Effect.forkIn(scope)` after an Observer upsert if the 40k token threshold (estimated via `char/4`) is met. The Reflector prompt will borrow principles from Mastra: condense older context more aggressively, preserve priority markers, and prioritize user assertions over questions.

## Affected Areas

| Area                      | Impact   | Description                                          |
| ------------------------- | -------- | ---------------------------------------------------- |
| `session/om/reflector.ts` | New      | Reflector logic and execution namespace              |
| `session/om/record.ts`    | Modified | Add `OM.reflect(sid, text)` targeted UPDATE          |
| `session/om/index.ts`     | Modified | Re-export `Reflector`                                |
| `session/system.ts`       | Modified | Inject `reflections ?? observations`                 |
| `session/prompt.ts`       | Modified | Trigger Reflector after Observer upsert > 40k tokens |

## Risks

| Risk                                              | Likelihood | Mitigation                                                       |
| ------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| Information loss if prompt is too aggressive      | Medium     | Use a conservative prompt focusing on preserving 🔴🟡 and facts. |
| One-turn race window for reflections to appear    | Low        | Acceptable tradeoff for non-blocking background execution.       |
| Double background LLM call (Observer + Reflector) | Low        | Acceptable; both run forked and don't block the user turn.       |

## Rollback Plan

1. Revert `session/system.ts` to exclusively use `observations` (remove `?? reflections`).
2. Remove Reflector trigger from `session/prompt.ts`.
   (No DB rollback required since the `reflections` column already exists and is nullable).

## Dependencies

- None

## Success Criteria

- [ ] Sessions with > 40k observation tokens successfully populate the `reflections` DB column.
- [ ] The agent's `system[2]` prompt injects `reflections` instead of `observations` when available.
- [ ] Background execution completes without blocking the main conversation turn.
- [ ] No regression in standard observation tracking below the 40k threshold.
