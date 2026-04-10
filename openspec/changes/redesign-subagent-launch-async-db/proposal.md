# Proposal: Redesign subagent launch for async DB

## Intent

Eliminate `SQLITE_BUSY` during parent→child agent launch by redesigning `task` around the async libSQL lifecycle instead of the old sync-style inline flow.

## Scope

### In Scope

- Introduce a dedicated subagent launch workflow with explicit `prepare` and `start` phases.
- Add coordinated DB write ownership for launch-critical writes (`session`, `handoff`, `fork`).
- Update task launch semantics so child execution starts only after durable launch state is committed.

### Out of Scope

- Replacing SQLite/libSQL with another database.
- Broad memory-feature changes unrelated to subagent launch semantics.

## Capabilities

### New Capabilities

- `subagent-launch`: Durable, async-safe parent→child launch lifecycle with explicit states and recovery boundaries.

### Modified Capabilities

- `memory`: Handoff/fork persistence requirements change to align with async-safe launch preparation and child hydration.

## Approach

Create a `SubagentLaunch` service that owns parent snapshot capture, child session creation, durable launch persistence, and child start. Split DB API usage into explicit read/write/tx paths and serialize launch-critical writes through a writer coordinator. Keep `task.ts` as orchestration only.

## Affected Areas

| Area                                      | Impact   | Description                                     |
| ----------------------------------------- | -------- | ----------------------------------------------- |
| `packages/opencode/src/tool/task.ts`      | Modified | Remove inline launch persistence/orchestration  |
| `packages/opencode/src/storage/db.ts`     | Modified | Add explicit async-safe write coordination      |
| `packages/opencode/src/memory/handoff.ts` | Modified | Align handoff/fork writes with launch lifecycle |
| `packages/opencode/src/subagent/*`        | New      | Add launch domain service and persistence       |
| `openspec/specs/memory/spec.md`           | Modified | Update durable handoff/fork requirements        |
| `openspec/specs/subagent-launch/spec.md`  | New      | Define launch lifecycle contract                |

## Risks

| Risk                                 | Likelihood | Mitigation                                                      |
| ------------------------------------ | ---------- | --------------------------------------------------------------- |
| Launch refactor breaks child startup | Med        | Introduce explicit lifecycle states and recovery tests          |
| Write serialization hurts latency    | Low        | Limit coordination to write paths, keep reads separate          |
| Prompt caching regressions           | Med        | Preserve existing prompt assembly boundaries and verify BP1-BP4 |

## Rollback Plan

Revert the new launch service and DB coordination changes, restore current `task.ts` launch path, and keep handoff fallback behavior unchanged until a revised design is ready.

## Dependencies

- Existing libSQL async storage migration in `openspec/changes/migrate-storage-to-libsql-async/`

## Success Criteria

- [ ] Parent→child launch no longer throws `SQLITE_BUSY: cannot commit transaction - SQL statements in progress` under normal subagent flow.
- [ ] `task.ts` no longer performs inline handoff/fork persistence orchestration directly.
- [ ] Launch-critical writes have a single coordinated ownership path.
- [ ] Child sessions start only after durable launch preparation succeeds.
- [ ] Prompt caching guarantees (BP1-BP4) remain intact.
