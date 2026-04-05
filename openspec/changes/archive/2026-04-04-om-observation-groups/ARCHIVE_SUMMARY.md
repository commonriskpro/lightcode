# Archive Summary: om-observation-groups

**Date Archived**: 2026-04-04  
**Change Folder**: `openspec/changes/archive/2026-04-04-om-observation-groups/`  
**Verification Status**: ✅ PASS (2116 tests, 0 failures, typecheck clean, all REQs met)

## Change Overview

Implemented observation groups with XML wrappers to preserve provenance and enable source message retrieval via a new `recall` tool. This change bridges the observation system with explicit message sourcing, allowing agents to recall the exact messages that generated observations.

## Artifacts Included

- ✅ **proposal.md** — Initial proposal and scope
- ✅ **spec.md** — Full delta specification (REQ-1.1 through REQ-6.2)
- ✅ **design.md** — Technical design and architecture decisions
- ✅ **tasks.md** — Implementation task breakdown (N=12 total, 12/12 complete)
- ✅ **exploration.md** — Pre-design exploration and context

## Files Modified in Implementation

| File                                                                | Change                                                                | Status |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `packages/opencode/src/session/om/groups.ts`                        | NEW — 5 pure group utilities + ObservationGroup type                  | ✅     |
| `packages/opencode/src/session/om/index.ts`                         | Re-exports all groups.ts APIs                                         | ✅     |
| `packages/opencode/src/session/om/observer.ts`                      | Strip groups before truncation; wrap output in observation group      | ✅     |
| `packages/opencode/src/session/om/reflector.ts`                     | Render groups before LLM prompt; reconcile groups after output        | ✅     |
| `packages/opencode/src/session/om/record.ts`                        | Wrap OM.activate() output in spanning group                           | ✅     |
| `packages/opencode/src/session/session.sql.ts`                      | first_msg_id + last_msg_id nullable columns on ObservationBufferTable | ✅     |
| `packages/opencode/src/session/system.ts`                           | OBSERVATION_RETRIEVAL_INSTRUCTIONS + inject when groups present       | ✅     |
| `packages/opencode/src/tool/recall.ts`                              | NEW — recall tool (query messages by ULID range)                      | ✅     |
| `packages/opencode/src/tool/registry.ts`                            | Register RecallTool                                                   | ✅     |
| `packages/opencode/migration/20260405024343_add-om-buffer-msg-ids/` | DB migration for new buffer columns                                   | ✅     |
| `packages/opencode/test/session/observer.test.ts`                   | 107 tests (23 new for groups, reflector, recall, system)              | ✅     |

## Specs Synced

**Domain**: `memory`  
**Action**: Updated  
**Details**: Added Phase 4 section to `openspec/specs/memory/spec.md`

### Requirements Synced

- **REQ-1.1 through REQ-1.6**: Group utilities (om/groups.ts)
- **REQ-2.1 through REQ-2.4**: Observer integration
- **REQ-3.1 through REQ-3.3**: Reflector integration
- **REQ-4.1 through REQ-4.6**: Recall tool
- **REQ-5.1 through REQ-5.2**: System prompt integration
- **REQ-6.1 through REQ-6.2**: Backward compatibility

**Total Requirements Added**: 22 requirements across 6 requirement groups

## Verification Summary

- **Tests**: 2116 passing, 0 failing
- **Typecheck**: Clean (no errors)
- **All REQs**: Met (verified in prior verify step)
- **Implementation**: Complete and verified

## Source of Truth Updated

The following specs now reflect the new behavior:

- `openspec/specs/memory/spec.md` (Phase 4 section added, lines 525–645)

## Architecture Decisions

1. **Observation groups preserve provenance**: Each observation output is wrapped with the message ID range that generated it, enabling agents to recall exact source context.

2. **Reflector group reconciliation**: Uses a line-overlap heuristic to re-apply group wrappers after compression, preserving lineage across reflection cycles.

3. **Backward compatibility**: Flat observations (no groups) continue to work; `parseObservationGroups()` returns `[]` for legacy sessions.

4. **Recall tool gating**: Only available when observations with groups exist, preventing unnecessary tool availability in legacy sessions.

5. **Clean text truncation**: Groups are stripped before truncation so the Observer sees clean previous observations, avoiding group nesting.

## Next Steps

All work is complete. The change has been fully planned, implemented, verified, and archived. Ready for the next change in the SDD cycle.

## SDD Cycle Status

✅ **Complete** — Proposal → Spec → Design → Tasks → Implementation → Verification → Archive

The observation groups feature is now part of the production memory system and specifications.
