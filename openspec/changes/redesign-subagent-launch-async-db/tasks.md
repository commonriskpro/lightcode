# Tasks: Redesign subagent launch for async DB

## Phase 1: Storage foundation

- [ ] 1.1 Add `packages/opencode/src/subagent/launch.sql.ts` with `subagent_launch` schema, status indexes, and snake_case columns.
- [ ] 1.2 Generate a migration that creates `subagent_launch` and indexes on `child_session_id` and `status`.
- [ ] 1.3 Modify `packages/opencode/src/storage/db.ts` to add `Database.read`, `Database.write`, and `Database.tx`, keeping `use()` as a compatibility wrapper.
- [ ] 1.4 Write RED tests in `packages/opencode/test/storage/` proving concurrent write callers serialize through the new coordinator while reads still work.

## Phase 2: Launch domain service

- [ ] 2.1 Create `packages/opencode/src/subagent/launch.ts` with state model, row mappers, `prepare`, `start`, `fail`, and `listPending` APIs.
- [ ] 2.2 Add RED tests in `packages/opencode/test/subagent/launch.test.ts` for `preparing → prepared`, failed prepare, and `prepared → started` transitions.
- [ ] 2.3 Implement `SubagentLaunch.prepare()` to create the child session, capture parent OM/WM/fork snapshot, and persist `snapshot_json` durably.
- [ ] 2.4 Implement `SubagentLaunch.start()` to resolve prompt parts, guard aborts, and mark `starting → started` around `SessionPrompt.prompt()`.
- [ ] 2.5 Add recovery tests for `prepared`, `preparing`, and cancelled rows in `packages/opencode/test/subagent/launch.test.ts`.

## Phase 3: Memory ownership refactor

- [ ] 3.1 Modify `packages/opencode/src/memory/handoff.ts` so write helpers accept caller-owned write/tx context and no longer open nested `Database.transaction()` for single upserts.
- [ ] 3.2 Update `packages/opencode/src/memory/provider.ts` to preserve the public API while routing launch-owned writes through the new `Handoff` helpers.
- [ ] 3.3 Write RED tests in `packages/opencode/test/memory/handoff-fallback.test.ts` and/or new handoff tests for launch-owned persistence and failed launch write behavior.

## Phase 4: Task tool integration

- [ ] 4.1 Refactor `packages/opencode/src/tool/task.ts` to delegate child session preparation/start to `SubagentLaunch` and remove inline handoff/fork orchestration.
- [ ] 4.2 Update `packages/opencode/test/tool/task.test.ts` to assert `task.ts` delegates persistence, preserves `task_id`, and aborts cleanly between `prepare` and `start`.
- [ ] 4.3 Verify `packages/opencode/src/session/prompt.ts` durable hydration still reads handoff/fork snapshots correctly after the refactor.

## Phase 5: Verification and cleanup

- [ ] 5.1 Add integration coverage proving normal parent→child launches do not raise `SQLITE_BUSY` during repeated subagent creation.
- [ ] 5.2 Run `bun test --timeout 30000 test/tool test/memory test/storage test/session test/subagent` from `packages/opencode` and fix failures.
- [ ] 5.3 Run `bun typecheck` from `packages/opencode` and remove any temporary compatibility code that is no longer needed.
