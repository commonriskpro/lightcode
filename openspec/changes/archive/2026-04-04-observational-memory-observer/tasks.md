# Tasks: Observational Memory Observer (Phase 2)

## Phase 1: Infrastructure

- [x] 1.1 Add `session_observation` and `session_observation_buffer` to `packages/opencode/src/session/session.sql.ts:14-103` with FK/indexes and `snake_case` columns.
- [x] 1.2 Run `bun run db generate --name add_observation_tables` from `packages/opencode` and confirm the new migration folder contains `migration.sql` + `snapshot.json`.

## Phase 2: CRUD Layer

- [x] 2.1 Create `packages/opencode/src/session/om/record.ts` with `get(sid)`, `upsert(rec)`, `getBuffer(sid)`, `addBuffer(buf)`, and `activateBuffer(sid)`.
- [x] 2.2 Keep CRUD DB access direct via `Instance.database`, matching the existing session/dream persistence style.

## Phase 3: Observer Agent

- [x] 3.1 Create `packages/opencode/src/session/om/observer.ts` with the LLM call, prompt template, and markdown output parsing.
- [x] 3.2 Wire `experimental.observer_model` resolution from `packages/opencode/src/config/config.ts` into the observer model selection path.

## Phase 4: Buffer State Machine

- [x] 4.1 Create `packages/opencode/src/session/om/buffer.ts` with module-level `Map<SessionID, { tokens, pending }>` state and 6k/30k/36k trigger logic.
- [x] 4.2 Create `packages/opencode/src/session/om/index.ts` to re-export the OM namespace for session wiring.

## Phase 5: Hook in `runLoop`

- [x] 5.1 Update `packages/opencode/src/session/prompt.ts:1457-1762` to check OM thresholds after each turn, fork background work with `Effect.forkIn(scope)`, and block on 36k.
- [x] 5.2 Pass `observations` into `handle.process()` and thread `LLM.StreamInput.observations` through `packages/opencode/src/session/llm.ts:39,125-134`.

## Phase 6: System Prompt

- [x] 6.1 Add `observations(sid)` in `packages/opencode/src/session/system.ts:73-96` to load the local observation payload from SQLite.
- [x] 6.2 Inject observations at `system[2]` in `llm.ts` without disturbing BP2/BP3 cache layout.

## Phase 7: AutoDream Extension

- [x] 7.1 Update `packages/opencode/src/dream/index.ts:67-100,172-198` so `summaries()` reads `ObservationTable` before summary messages.
- [x] 7.2 Preserve the existing fallback order when no local observations exist.

## Phase 8: Config

- [x] 8.1 Add `experimental.observer_model` to `packages/opencode/src/config/config.ts` alongside the existing `autodream_model` pattern.
- [x] 8.2 Keep observer disabled gracefully when the model is absent.

## Phase 9: Tests

- [x] 9.1 Add `packages/opencode/test/session/observer.test.ts` for CRUD, buffer thresholds, and activation paths using the real DB via `Instance.provide`.
- [x] 9.2 Add a cache-safety case proving `system[2]` does not break prompt caching or the `applyCaching()` BP2/BP3 layout.

## Phase 10: Integration Verification

- [x] 10.1 Run `bun typecheck` from `packages/opencode` and fix any typing regressions from the new OM surface.
- [x] 10.2 Run `bun test --timeout 30000` from `packages/opencode` and verify the session, dream, and prompt wiring end to end.
