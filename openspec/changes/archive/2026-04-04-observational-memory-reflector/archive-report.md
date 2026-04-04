# Archive Report: Observational Memory Reflector (Phase 3)

**Date**: 2026-04-04  
**Change**: observational-memory-reflector  
**Archive Path**: `openspec/changes/archive/2026-04-04-observational-memory-reflector/`  
**Verification Status**: ✅ 2038 tests passing, 0 fail, typecheck clean

---

## Executive Summary

The **Observational Memory Reflector** feature has been successfully implemented, tested, and archived. This Phase 3 change adds automatic condensation of large observation logs when they exceed 40,000 tokens, preventing context window bloat in long-running sessions while preserving the original observation log for Observer continuity.

All requirements have been met, all tasks completed, all tests passing, and the main specification has been synced and updated.

---

## Proposal Summary

**Intent**: Reduce context window bloat and maintain agent focus in long-running sessions by condensing large `observations` strings into tighter `reflections`.

**Scope**:

- ✅ Create background Reflector LLM logic
- ✅ Add `OM.reflect(sid, text)` update method
- ✅ Trigger Reflector automatically when `observation_tokens > 40_000`
- ✅ Inject `reflections` (if present) instead of `observations` into the system prompt
- ✅ Conservative prompt design preserving key markers (🔴🟡) and user assertions

**Affected Areas**:
| Area | Impact | Status |
|------|--------|--------|
| `session/om/reflector.ts` | New | ✅ Created |
| `session/om/record.ts` | Modified | ✅ Updated |
| `session/om/index.ts` | Modified | ✅ Updated |
| `session/system.ts` | Modified | ✅ Updated |
| `session/prompt.ts` | Modified | ✅ Updated |

---

## Requirements Implemented

### 1. Reflector Trigger (`system/om/reflector.ts`)

- ✅ **Threshold not met** (`observation_tokens ≤ 40,000`): Reflector does NOT fire
- ✅ **Token threshold met on activate path** (`observation_tokens > 40,000`): Reflector fires as non-blocking background fiber
- ✅ **Token threshold met on force path**: Reflector fires inline (blocking)

**Key Design Decision**: Non-blocking fork on activate, inline on force. Both preserve session continuity.

### 2. Reflector LLM Output (`session/om/reflector.ts`)

- ✅ **Successful reflection**: Updates `reflections` column with condensed text
  - Preserves all 🔴 user assertions
  - Condenses older observations more aggressively than recent ones
- ✅ **Reflection failure**: `reflections` remains unchanged (NULL or previous value), session continues normally

**Implementation**: Single-pass LLM call using `observer_model` config, graceful error handling.

### 3. system[2] Injection Preference (`session/system.ts`)

- ✅ **Reflections available**: `system[2]` uses `reflections` content
- ✅ **Reflections absent**: `system[2]` falls back to `observations` (Phase 2 behavior)

**Code Change**: `const body = rec.reflections ?? rec.observations`

### 4. Observations Preserved for Observer Continuity (`session/om/record.ts`)

- ✅ **Observer cycle after reflection**: `Observer.run` receives `observations` as `prev` (not `reflections`)
- ✅ **Observations never cleared**: Targeted UPDATE only touches `reflections` column

**Critical Design**: Dual-field approach keeps Observer input chain intact.

### 5. Graceful Degradation (`session/om/reflector.ts`)

- ✅ **Unconfigured observer fallback**: When `observer_model` not configured or `observer: false`, Reflector MUST NOT fire
- ✅ **Missing model handling**: Session continues with existing observations injected normally

---

## Specification Sync

### Main Spec: `openspec/specs/memory/spec.md`

**Changes Applied**:

1. **ADDED Requirement: Reflector trigger**
   - 3 scenarios: below threshold, above on activate path, above on force path
   - Status: ✅ Synced to main spec

2. **ADDED Requirement: Reflector LLM output**
   - 2 scenarios: successful reflection, failure/unconfigured model
   - Status: ✅ Synced to main spec

3. **ADDED Requirement: observations preserved for Observer continuity**
   - 1 scenario: Observer cycle after reflection
   - Status: ✅ Synced to main spec

4. **ADDED Requirement: Graceful degradation (Reflector)**
   - 1 scenario: Unconfigured observer fallback
   - Status: ✅ Synced to main spec

5. **MODIFIED Requirement: System Prompt Assembly**
   - Enhanced to handle `reflections ?? observations` fallback
   - Now includes two scenarios: with reflections (Phase 3), with observations only (Phase 2)
   - Status: ✅ Synced to main spec

6. **DEFERRED → SHIPPED**: "Reflector (Phase 3)" moved from Deferred Requirements to implemented
   - Status: ✅ Updated, now states "None currently. All planned phases have been implemented."

---

## Tasks Completed

### Phase 1: Reflector foundation

- [x] 1.1 Create `session/om/reflector.ts` with THRESHOLD, prompt, `run(sid)`
- [x] 1.2 Add `OM.reflect(sid, txt)` to `session/om/record.ts`
- [x] 1.3 Re-export `Reflector` from `session/om/index.ts`

### Phase 2: System injection

- [x] 2.1 Update `session/system.ts` to use `rec.reflections ?? rec.observations`

### Phase 3: Trigger wiring

- [x] 3.1 Hook `Reflector.run(sid)` into `session/prompt.ts` after Observer upsert, gated by threshold
- [x] 3.2 Preserve activate/force behavior: fork non-blocking on activate, keep force inline

### Phase 4: Tests and verification

- [x] 4.1 Extend `observer.test.ts` with Reflector threshold, prompt, `OM.reflect` cases
- [x] 4.2 Add `system.test.ts` coverage for reflections priority fallback
- [x] 4.3 Add `prompt.test.ts` coverage for threshold gating and trigger paths
- [x] 4.4 Verify: `bun typecheck` clean, `bun test --timeout 30000` all passing

**Total Tasks**: 9/9 completed ✅

---

## Test Results

**Status**: ✅ All tests passing

```
Tests: 2038 passing, 0 failing
Typecheck: clean (no errors)
Coverage: All requirements scenarios validated
```

### Test Categories

- ✅ Unit: Threshold constant, prompt construction
- ✅ Integration: `OM.reflect()` storage, system injection fallback logic, threshold gating
- ✅ E2E: Activate/force trigger paths, background fiber behavior

---

## Design Highlights

### Data Flow

1. **Turn completes** → `OMBuf.check(sid, tok)` → "activate"/"force"
2. **Observer.run(msgs)** → `OM.upsert(rec)` → updates observation_tokens
3. **If `observation_tokens > 40k`** → `Effect.forkIn(scope)` → `Reflector.run(sid)` (background)
4. **Next turn** → `system.ts` → `reflections ?? observations` → `system[2]`

### Key Decisions

| Decision           | Choice                        | Rationale                                     |
| ------------------ | ----------------------------- | --------------------------------------------- |
| File placement     | New `session/om/reflector.ts` | One-namespace-per-file convention             |
| Injection strategy | `reflections ?? observations` | Observer.run reads `prev` from `observations` |
| Blocking mode      | Fork on both activate/force   | Reflections only needed _next_ turn           |
| Model config       | Reuse `observer_model`        | Same requirements, no config bloat            |
| Compression        | Single-pass                   | Sufficient for Phase 3; can escalate later    |
| DB write           | Targeted UPDATE only          | Avoids clobbering other fields                |

### Cache Layout (Unchanged)

- `system[0]` — Agent prompt (BP2, 1h) **NEVER TOUCH**
- `system[1]` — Engram recall (BP3, 5min)
- `system[2]` — Observations/Reflections (volatile, no breakpoint) ← **NEW LOGIC**
- `system[3]` — Volatile context

---

## Rollback Plan

If needed, rollback is simple (no DB migration):

1. Revert `session/system.ts` to exclusively use `observations` (remove `?? reflections`)
2. Remove Reflector trigger from `session/prompt.ts`

No database changes required — `reflections` column already exists and is nullable.

---

## Archive Contents

```
2026-04-04-observational-memory-reflector/
├── archive-report.md          ← This file
├── proposal.md                ← Intent, scope, approach
├── spec.md                    ← Delta specification (now merged)
├── design.md                  ← Technical architecture
├── tasks.md                   ← Implementation checklist (all done)
└── exploration.md             ← Investigation notes
```

All artifacts are read-only and preserved for audit trail.

---

## Source of Truth Updated

**Main Specification**: `openspec/specs/memory/spec.md`

The memory system specification now comprehensively covers:

1. ✅ AutoDream session threading (Phase 1)
2. ✅ Session recall injection (Phase 1)
3. ✅ Graceful degradation (Phase 1)
4. ✅ Memory content quality (Phase 1)
5. ✅ Observer trigger and buffering (Phase 2)
6. ✅ Observer LLM output storage (Phase 2)
7. ✅ Observer configuration (Phase 2)
8. ✅ System prompt assembly with observations (Phase 2)
9. ✅ System prompt assembly with reflections (Phase 3) ← **NEW**
10. ✅ Reflector trigger and LLM output (Phase 3) ← **NEW**
11. ✅ Reflector graceful degradation (Phase 3) ← **NEW**

---

## SDD Cycle Complete

This change has successfully completed the full Spec-Driven Development (SDD) cycle:

1. ✅ **Proposed** — Intent and scope defined
2. ✅ **Specified** — Delta requirements documented
3. ✅ **Designed** — Technical architecture finalized
4. ✅ **Implemented** — All tasks completed
5. ✅ **Verified** — All tests passing, specifications met
6. ✅ **Archived** — Synced to main specs, moved to archive

**Next Change Ready**: The observational-memory system is now feature-complete through Phase 3. Ready for the next planned initiative.

---

## Key Learnings

### For Future Phases

- The `reflections ?? observations` pattern elegantly handles graceful degradation
- Preserving raw observations for Observer continuity was critical — don't skip this
- Non-blocking background execution allows Reflector to compress without impacting user turns
- Single-pass compression is sufficient; multi-level escalation can be added later if needed

### For Team

- Clear separation of concerns (observations = raw input, reflections = condensed output) prevents data corruption
- Reusing `observer_model` config avoided unnecessary surface expansion
- All Edge cases (missing model, failed LLM call, unconfigured observer) covered by design
