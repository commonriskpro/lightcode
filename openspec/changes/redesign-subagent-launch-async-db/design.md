# Design: Redesign subagent launch for async DB

## Technical Approach

Replace the current inline `task.ts` launch script with a dedicated `SubagentLaunch` workflow that owns: (1) child session creation, (2) parent snapshot capture, (3) durable launch persistence, and (4) child start. The design keeps prompt assembly and memory hydration contracts intact, but moves launch-critical writes behind a single coordinated async write path. This maps directly to `subagent-launch` and `memory` specs.

## Architecture Decisions

| Decision                | Choice                                                                                                    | Alternatives considered                                     | Rationale                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch owner            | New `src/subagent/launch.ts` namespace                                                                    | Keep logic in `tool/task.ts`                                | `task.ts` currently mixes permission, persistence, aborts, and child start. A dedicated domain service gives one owner for lifecycle and recovery. |
| Lifecycle model         | Explicit states: `preparing`, `prepared`, `starting`, `started`, `failed`, `cancelled`                    | Stateless best-effort flow                                  | Async DB means failures can happen between awaits. Explicit states make aborts/retries observable and testable.                                    |
| Durable record          | New `subagent_launch` table in `src/subagent/launch.sql.ts`                                               | Reuse only `memory_agent_handoffs` / `memory_fork_contexts` | Handoff/fork are snapshots, not the business event. We need a first-class record for launch ownership, status, and recovery.                       |
| Write coordination      | Add `Database.read`, `Database.write`, `Database.tx` and serialize write/tx entry through one coordinator | Keep generic `Database.use` everywhere                      | Current `use()` hides intent. Explicit read/write APIs let launch-critical writes share one ownership path and reduce accidental interleaving.     |
| Session creation timing | Child session is created during `prepare`, before child prompt                                            | Create session lazily at `start`                            | Existing APIs and UI expect a child session id early; keeping that timing preserves resume/task_id behavior while making it durable.               |
| Handoff/fork ownership  | `Handoff` writes remain in memory layer but are called only from `SubagentLaunch.prepare()`               | Let `task.ts` call `Memory.write*` inline                   | Keeps memory schema reusable but moves orchestration out of the tool.                                                                              |

## Data Flow

```text
TaskTool.execute
  ├─ permission / agent resolution
  ├─ SubagentLaunch.prepare(input)
  │    ├─ Database.write → create child session
  │    ├─ read parent OM / WM / active fork context
  │    ├─ Database.tx → insert subagent_launch(preparing→prepared)
  │    └─ Database.tx → persist handoff or fork snapshot
  ├─ ctx.metadata(sessionId, model)
  └─ SubagentLaunch.start(prepared)
       ├─ resolve prompt parts
       ├─ mark launch starting→started
       └─ SessionPrompt.prompt(...)
```

Recovery path:

```text
process restart / replay
  └─ SubagentLaunch.listPending()
       ├─ prepared  → may resume start
       ├─ preparing → mark failed/cancelled
       └─ started   → no-op
```

## File Changes

| File                                             | Action | Description                                                                                    |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| `packages/opencode/src/subagent/launch.ts`       | Create | Main lifecycle service (`prepare`, `start`, `fail`, `listPending`).                            |
| `packages/opencode/src/subagent/launch.sql.ts`   | Create | Drizzle schema for `subagent_launch`.                                                          |
| `packages/opencode/src/tool/task.ts`             | Modify | Keep permission + agent selection; delegate launch workflow to service.                        |
| `packages/opencode/src/storage/db.ts`            | Modify | Introduce explicit `read/write/tx`; keep `use()` temporarily as compatibility wrapper.         |
| `packages/opencode/src/memory/handoff.ts`        | Modify | Accept caller-owned tx/write path; remove nested `Database.transaction()` for single upserts.  |
| `packages/opencode/src/memory/provider.ts`       | Modify | Preserve public API, but route launch-owned calls through updated `Handoff`.                   |
| `packages/opencode/src/session/prompt.ts`        | Modify | Reuse existing durable hydration; optionally consult launch state for resume safety.           |
| `packages/opencode/test/tool/task.test.ts`       | Modify | Assert `task.ts` delegates to launch service and respects abort between `prepare` and `start`. |
| `packages/opencode/test/memory/*handoff*`        | Modify | Assert launch-owned persistence semantics.                                                     |
| `packages/opencode/test/subagent/launch.test.ts` | Create | Lifecycle, recovery, and failure-path coverage.                                                |

## Interfaces / Contracts

```ts
export namespace SubagentLaunch {
  export type State = "preparing" | "prepared" | "starting" | "started" | "failed" | "cancelled"

  export async function prepare(input: {
    parent_session_id: SessionID
    parent_message_id: MessageID
    agent: Agent.Info
    description: string
    prompt: string
    caller: string
    model: { modelID: string; providerID: string }
    abort: AbortSignal
  }): Promise<{ launchId: string; sessionId: SessionID; model: { modelID: string; providerID: string } }>

  export async function start(input: { launchId: string; abort: AbortSignal }): Promise<SessionPrompt.Result>
}
```

`subagent_launch.snapshot_json` stores normalized launch payload: mode, task description, OM summary, WM snapshot, metadata. `memory_agent_handoffs` and `memory_fork_contexts` remain child-hydration stores.

## Testing Strategy

| Layer       | What to Test             | Approach                                                                                        |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| Unit        | `SubagentLaunch.prepare` | Temp DB; assert state transitions, child session creation, and durable snapshot write ordering. |
| Unit        | `SubagentLaunch.start`   | Stub prompt call; assert no start before `prepared`, abort marks cancelled.                     |
| Unit        | `Database.write/tx`      | Concurrent callers; assert serialized writes and preserved reads.                               |
| Unit        | `Handoff`                | Upsert under caller-owned tx without nested transaction behavior.                               |
| Integration | `TaskTool.execute`       | End-to-end parent→child flow on temp DB; verify no inline memory writes outside launch service. |
| Integration | Recovery                 | Seed `subagent_launch` rows in `prepared` / `preparing`; assert resume or fail behavior.        |

Run from `packages/opencode` with `bun test --timeout 30000` and `bun typecheck`.

## Migration / Rollout

Add one migration creating `subagent_launch` with indexes on `child_session_id` and `status`. Rollout in three safe steps: (1) add DB coordinator APIs compatibly, (2) add launch table/service behind `task.ts`, (3) remove nested launch transactions from `Handoff`. No feature flag required because behavior stays internal.

## Open Questions

- [ ] Should `Session.create` itself gain an optional caller-owned tx overload, or should `SubagentLaunch` persist the session row through a narrower storage helper?
- [ ] Should pending prepared launches auto-resume on boot, or only when explicitly requested by parent/task replay?
