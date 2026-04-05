# Proposal: om-observation-groups

## Intent

Implement Gap 5: wrap every Observer output in `<observation-group>` XML markers for provenance tracking. Maintain group lineage through the Reflector compression cycle, and expose a `recall` tool that lets the agent retrieve source messages for any observation group by message ID range.

## Scope

### In Scope

- Port Mastra's 5 pure string utilities for observation groups to `session/om/groups.ts`.
- Update `Observer.run()` to wrap output in `<observation-group>` using message IDs from the processed chunk.
- Update `OM.activate()` / `Observer.condense()` to wrap merged output with full buffer span range.
- Update `Reflector.run()` to strip groups before LLM compression and reconcile group lineage after.
- Update `truncateObsToBudget` to strip groups before truncating context for the LLM.
- Create and register a new `recall` tool to query message ranges from the database.

### Out of Scope

- Migrating existing flat observation strings (they degrade gracefully).
- Schema changes to DB tables.

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `memory`: Observer and Reflector workflows are updated to preserve group metadata; addition of `recall` tool for source message retrieval.

## Approach

Use an inline XML approach (matching Mastra) to store group metadata directly inside the `observations` string. This avoids any schema changes or DB migrations and provides free backward compatibility. We will adapt the Mastra utility functions to use exact `MessageID` strings for the range instead of timestamps, allowing the new `recall` tool to accurately fetch source messages via lexicographic DB queries.

## Affected Areas

| Area                                            | Impact   | Description                                           |
| ----------------------------------------------- | -------- | ----------------------------------------------------- |
| `packages/opencode/src/session/om/groups.ts`    | New      | 5 utility functions for XML group string manipulation |
| `packages/opencode/src/tool/recall.ts`          | New      | Recall tool implementation fetching message ranges    |
| `packages/opencode/src/session/om/observer.ts`  | Modified | Wrap outputs, strip before `truncateObsToBudget`      |
| `packages/opencode/src/session/om/reflector.ts` | Modified | Strip/render before prompt, reconcile after output    |
| `packages/opencode/src/session/om/record.ts`    | Modified | Wrap in `OM.activate()`                               |
| `packages/opencode/src/tool/registry.ts`        | Modified | Register `RecallTool`                                 |
| `packages/opencode/src/session/system.ts`       | Modified | Inject OBSERVATION_RETRIEVAL_INSTRUCTIONS             |

## Risks

| Risk                             | Likelihood | Mitigation                                                                                          |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| Reflector LLM destroys structure | Low        | `reconcileObservationGroupsFromReflection` heuristic fallback preserves data as single group        |
| Truncation breaks XML            | Low        | We strip groups _before_ sending to `truncateObsToBudget` for LLM context                           |
| Existing flat string errors      | Low        | `parseObservationGroups` returns `[]`, causing `recall` tool to gracefully return "no groups found" |

## Rollback Plan

- Remove the `recall` tool from the registry.
- Run a one-time script to strip all `<observation-group>` tags from the `observations` column.
- Revert the 5 string utility integrations in Observer and Reflector.

## Dependencies

- Existing SQLite `MessageTable` structure with ULID-ascending `MessageID`s.

## Success Criteria

- [ ] Observer output wrapped in `<observation-group>` with correct message range.
- [ ] `parseObservationGroups` returns `[]` for legacy flat strings.
- [ ] Reflector receives stripped/rendered observations, output is reconciled with group lineage.
- [ ] `recall` tool registered and callable — returns messages for a given range.
- [ ] `truncateObsToBudget` works correctly on stripped text.
- [ ] All 2084 tests pass.
