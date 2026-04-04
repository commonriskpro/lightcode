# Proposal: Observational Memory Observer (Phase 2)

## Intent

Implement a proactive background Observer agent that fires during active sessions (at a 30k token threshold) to compress unobserved message history into a local `ObservationTable`. This prevents context rot and token overflow without blocking the user, feeding into the cross-session recall pipeline built in Phase 1.

## Scope

### In Scope

- **DB Migration**: Add `session_observation` and `session_observation_buffer` tables.
- **CRUD Layer**: `om/record.ts` for logging active observations.
- **Buffer State Machine**: `om/buffer.ts` for async chunk pre-computation.
- **Observer Agent**: `om/observer.ts` for background LLM compression.
- **Injection Hook**: Trigger Observer in `runLoop` (`prompt.ts`) via `Effect.forkIn` at 30k unobserved tokens.
- **AutoDream Extension**: Update `dream/index.ts` to read local observations.

### Out of Scope

- **Reflector (Phase 3)**: Deep synthesis and insight generation.
- **Cross-session Recall (Phase 1)**: Already completed.
- UI changes for observations (internal state only).

## Capabilities

### New Capabilities

- `observational-memory-observer`: Background agent for intra-session token compression into observations.

### Modified Capabilities

- `session-context`: Enhanced to include local observations injected at `system[2]`.
- `autodream`: Extended to read session local observations.

## Approach

1. Create Drizzle migrations for new tables (snake_case, FK to SessionTable).
2. Implement `om/` namespace inside `session/` containing `record.ts`, `buffer.ts`, and `observer.ts`.
3. The Observer will trigger every 30k unobserved tokens via a background fiber (`Effect.forkIn(scope)`) in `prompt.ts`, mirroring the title generation pattern.
4. Pre-compute buffer intervals will occur every 6k tokens (20%), with a blocking force-sync at 36k tokens (1.2×).
5. Inject the generated local observations into the prompt at `system[2]` (shifting the volatile layer to `system[3]`), keeping the Phase 1 Engram cache at `system[1]` intact.
6. The Observer LLM (`experimental.observer_model`, default: `google/gemini-2.5-flash`) will follow the `runCompactionLLM` pattern.

## Affected Areas

| Area                                         | Impact   | Description                                              |
| -------------------------------------------- | -------- | -------------------------------------------------------- |
| `packages/opencode/src/db/schema.ts`         | New      | Add `session_observation` & `session_observation_buffer` |
| `packages/opencode/src/session/om/*`         | New      | Add `record.ts`, `buffer.ts`, `observer.ts`              |
| `packages/opencode/src/session/prompt.ts`    | Modified | Add `Effect.forkIn` Observer trigger hook                |
| `packages/opencode/src/session/transform.ts` | Modified | Shift system[2] to [3], inject observations at [2]       |
| `packages/opencode/src/dream/index.ts`       | Modified | Read local observations in `summaries()`                 |

## Risks

| Risk                        | Likelihood | Mitigation                                                                                                   |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Destabilizing BP2/BP3 Cache | High       | Explicitly verify `applyCaching()` handles 4 segments correctly, leaving `system[0]` and `system[1]` cached. |
| Token Estimation Inaccuracy | Medium     | Use `lastFinished.tokens` (exact counts) instead of char-based estimation, or set conservative 25k trigger.  |
| Observer LLM Quality        | Medium     | Follow `runCompactionLLM` pattern closely; rigorous prompt testing.                                          |
| Effect Layer Complexity     | Low        | Use plain async namespace (like AutoDream) for simplicity if Effect gets tangled.                            |

## Rollback Plan

- Revert changes to `prompt.ts`, `transform.ts`, and `dream/index.ts`.
- Remove `om/` namespace files.
- Apply a down migration to drop `session_observation` and `session_observation_buffer` tables.

## Dependencies

- **Phase 1 (Cross-session recall via Engram)**: Must be fully merged and functional (specifically `system[1]` Engram recall).

## Success Criteria

- [ ] Observer successfully triggers in the background at 30k tokens.
- [ ] Observations are saved to SQLite without blocking user interaction.
- [ ] Observations are correctly injected at `system[2]` without breaking BP2/BP3 caches.
- [ ] AutoDream successfully reads session local observations.
