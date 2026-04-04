# Tasks: Observational Memory Reflector

## Phase 1: Reflector foundation

- [x] 1.1 Create `packages/opencode/src/session/om/reflector.ts` with `Reflector.THRESHOLD`, prompt text, and `Reflector.run(sid)`.
- [x] 1.2 Add `OM.reflect(sid, txt)` to `packages/opencode/src/session/om/record.ts` as a targeted `reflections` update only.
- [x] 1.3 Re-export `Reflector` from `packages/opencode/src/session/om/index.ts`.

## Phase 2: System injection

- [x] 2.1 Update `packages/opencode/src/session/system.ts` to prefer `rec.reflections ?? rec.observations` before `wrapObservations()`.

## Phase 3: Trigger wiring

- [x] 3.1 Hook `Reflector.run(sid)` into `packages/opencode/src/session/prompt.ts` after Observer `upsert`, gated by `observation_tokens > 40_000`.
- [x] 3.2 Preserve the existing activate/force behavior: fork non-blocking on activate, keep force inline for Observer, and trigger Reflector without touching `observations`.

## Phase 4: Tests and verification

- [x] 4.1 Extend `packages/opencode/test/session/observer.test.ts` with Reflector threshold, prompt, and `OM.reflect` cases.
- [x] 4.2 Add `packages/opencode/test/session/system.test.ts` coverage for `reflections` priority, raw `observations` fallback, and `undefined` when both are null.
- [x] 4.3 Add `packages/opencode/test/session/prompt.test.ts` coverage for threshold gating and activate/force trigger paths.
- [x] 4.4 Verify from `packages/opencode`: `bun typecheck` and `bun test --timeout 30000`.
