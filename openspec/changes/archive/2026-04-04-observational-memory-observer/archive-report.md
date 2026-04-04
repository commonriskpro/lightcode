# Archive Report: observational-memory-observer (Phase 2)

**Date**: 2026-04-04  
**Mode**: openspec (hybrid)  
**Status**: ✅ ARCHIVED

## Change Overview

**Name**: observational-memory-observer  
**Scope**: Proactive background Observer agent that fires during active sessions to compress unobserved message history into a local `ObservationTable`.

## Verification Status

- **Tests**: 2020 passing, 0 failed
- **Typecheck**: Clean
- **Review**: Design verified manually against codebase
- **Blockers**: None

## Specs Synced

### Main Spec Updated: `openspec/specs/memory/spec.md`

| Requirement                     | Action                      | Details                                                                                             |
| ------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| Observer Trigger and Buffering  | **ADDED**                   | Token thresholds: 6k (buffer), 30k (activate), 36k (force-sync)                                     |
| Observer LLM Output Storage     | **ADDED**                   | Stores observations in `ObservationTable`, updates `last_observed_at`                               |
| Observer Configuration          | **ADDED**                   | Respects `experimental.observer_model` setting                                                      |
| System Prompt Assembly          | **MODIFIED**                | Observations injected at `system[2]`, preserves `system[0]` (1h cache) and `system[1]` (5min cache) |
| AutoDream Context Consolidation | **MODIFIED**                | AutoDream now reads `ObservationTable` observations + existing summaries                            |
| Graceful Degradation            | **ADDED** (Phase 2 variant) | Observer failures don't crash session loop                                                          |

**Total**: 4 ADDED + 2 MODIFIED + 1 reapplied Graceful Degradation requirements

### Deferred Requirements Updated

Old deferred entry:

```
- Proactive Observer (Phase 2): Background LLM observation every N tokens or turns, and the implementation of `ObservationTable`.
```

New deferred entry:

```
- Reflector (Phase 3): Cross-session compression and pattern detection via a periodic Reflector agent that reads multiple observation records from Engram to infer systemic patterns in behavior and decision-making.
```

## Archive Contents

| Artifact           | Status | Summary                                                                  |
| ------------------ | ------ | ------------------------------------------------------------------------ |
| **proposal.md**    | ✅     | Intent, scope, and rationale for background Observer                     |
| **spec.md**        | ✅     | 4 ADDED + 2 MODIFIED requirements with full scenarios                    |
| **design.md**      | ✅     | Technical approach, architecture decisions, data flow, component details |
| **tasks.md**       | ✅     | 10 phases × 20 tasks — **all 20/20 completed**                           |
| **exploration.md** | ✅     | Investigation and tradeoff analysis (design phase input)                 |

## Implementation Artifacts

### New Components

- **C1: DB Schema** (`packages/opencode/src/session/session.sql.ts`)
  - `session_observation` table: id, session_id, observations, reflections, last_observed_at, generation_count, observation_tokens, timestamps
  - `session_observation_buffer` table: id, session_id, observations, message_tokens, observation_tokens, starts_at, ends_at, timestamps
  - Indexes: `observation_session_idx`, `obs_buffer_session_idx`

- **C2: CRUD Layer** (`packages/opencode/src/session/om/record.ts`)
  - `get(sid)` → fetch active observation row
  - `upsert(rec)` → insert or update observation record
  - `getBuffer(sid)` → fetch all buffered rows
  - `addBuffer(buf)` → insert observation buffer row
  - `activateBuffer(sid)` → compress buffer rows via LLM

- **C3: Observer Agent** (`packages/opencode/src/session/om/observer.ts`)
  - Prompt template for compressing message history into fact-level observations
  - LLM call with model resolution from `experimental.observer_model`
  - Markdown output parsing and storage

- **C4: Buffer State Machine** (`packages/opencode/src/session/om/buffer.ts`)
  - Module-level `Map<SessionID, { tokens, pending }>`
  - Trigger logic: 6k (buffer), 30k (activate), 36k (force-sync)
  - Cleanup on session end via scope lifetime

- **C5: Integration Points**
  - `packages/opencode/src/session/prompt.ts:1457-1762`: OM threshold checks and Effect.forkIn wiring
  - `packages/opencode/src/session/llm.ts:39,125-134`: `LLM.StreamInput.observations` threading
  - `packages/opencode/src/session/system.ts:73-96`: `observations(sid)` loader
  - `packages/opencode/src/dream/index.ts:67-100,172-198`: `summaries()` reads `ObservationTable`
  - `packages/opencode/src/config/config.ts`: `experimental.observer_model` config

### Architecture Decisions

| Decision                   | Choice                                    | Rationale                                                                                                                                             |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect vs plain async      | Plain async (like AutoDream)              | Observer fires from Effect context via `Effect.forkIn(scope)`. Fire-and-forget pattern with `Effect.ignore` — no need for layers or typed errors.     |
| Observation injection slot | `system[2]` via `input.observations`      | Decouples Phase 2 observations from Phase 1 recall. Sits between cached `system[1]` (5min) and volatile `system[3]`. Safe — verified in transform.ts. |
| Token trigger source       | `lastFinished.tokens.input + .output`     | Actual processor counts already available in runLoop. More accurate than char/4 estimation.                                                           |
| Config location            | `experimental.observer_model`             | Matches existing `experimental.autodream_model` pattern. Observer is experimental; full Agent config is overkill.                                     |
| Default observer model     | `google/gemini-2.5-flash`                 | Low cost, 1M context, fast. Fires every 6k tokens — session model would be expensive.                                                                 |
| Per-session state tracking | `Map<SessionID, State>` in `om/buffer.ts` | Observer state is per-session, not per-directory. Correct for lifetime management.                                                                    |

## Test Coverage

**File**: `packages/opencode/test/session/observer.test.ts`

| Test Case             | Coverage                                                              |
| --------------------- | --------------------------------------------------------------------- |
| CRUD operations       | get, upsert, getBuffer, addBuffer, activateBuffer                     |
| Buffer thresholds     | 6k, 30k, 36k token accumulation and trigger behavior                  |
| Activation path       | LLM call, markdown parsing, record persistence                        |
| Cache safety          | `system[2]` injection does not break prompt caching or BP2/BP3 layout |
| Graceful degradation  | LLM failure, model not configured, DB unavailable                     |
| AutoDream integration | Reads observations before summary messages                            |

**Result**: All tests passing (2020 tests total in codebase).

## Key Learnings

1. **Prompt caching safety**: The existing `applyCaching()` in transform.ts only places breakpoints at `system[0]` (1h cache) and `system[1]` (5min cache). Injecting observations at `system[2]` is safe — they sit between cached and volatile content without destabilizing the cache layout.

2. **Effect.forkIn for background work**: Using `Effect.forkIn(scope)` with fire-and-forget `Effect.ignore` is simpler than typed error layers for background processes. Matches AutoDream's pattern.

3. **Token counting from processor**: The API provides exact token counts in `lastFinished.tokens.input` and `.output`. No need for character-based estimation — accuracy improves Observer trigger reliability.

4. **ObservationTable as local state**: Unlike Engram (cross-session), the `ObservationTable` is session-local. It bridges the gap: local enough to inject at `system[2]` (5min cache refresh), dense enough to provide AutoDream with high-quality recall context.

5. **Graceful degradation patterns**: When the Observer LLM fails, times out, or the model is unconfigured, the session continues normally. No crashes, no async hangs. Critical for background processes in production.

## Downstream Impact

### For Phase 3 (Reflector)

The `ObservationTable.reflections` column is reserved. Reflector will:

- Read multiple observation records from Engram AND local `ObservationTable`
- Infer systemic patterns (decision-making, behavior trends, pain points)
- Store pattern summaries in `reflections` column
- Feed patterns back into system prompt as higher-level context

### For Future Sessions

- Sessions automatically start with both recall (Engram, Phase 1) and local observations (Phase 2)
- AutoDream now has dense signal from both sources for Engram consolidation
- Observer compression reduces token bloat from historical messages

## Source of Truth Updated

✅ `/Users/dev/lightcodev2/openspec/specs/memory/spec.md`

The main memory specification now includes:

- All Phase 1 requirements (session threading, recall injection, graceful degradation, content quality)
- All Phase 2 requirements (observer trigger, LLM output storage, observer configuration, modified system prompt assembly and autodream consolidation)
- Updated deferred requirement pointing to Phase 3 (Reflector)

## SDD Cycle Complete

**Timeline**:

- Proposal → Specification → Design → Tasks → Implementation → Verification → **Archive** ✅

The change has been fully planned, implemented, verified (2020 tests passing, typecheck clean), and archived. The memory system now spans:

1. **Phase 1**: Cross-session recall via Engram
2. **Phase 2**: Local observation compression via Observer
3. **Phase 3** (deferred): Cross-session pattern detection via Reflector

**Status**: Ready for Phase 3 work to begin.
