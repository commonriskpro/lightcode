# LightCode Memory — Production Validation Report

**Date**: 2026-04-05  
**Status**: PASS WITH WARNINGS  
**Scope**: Production hardening pass for LightCode memory

---

## Validation Scope

This report uses only the verified command results provided for this initiative, plus direct source/spec/design/task review of the affected files.

---

## Commands Run

1. `cd /Users/dev/lightcodev2/packages/opencode && bun typecheck`  
   **Result**: ✅ PASS

2. `cd /Users/dev/lightcodev2/packages/opencode && bun test test/memory/memory-core-production.test.ts`  
   **Result**: ✅ PASS — 33 pass / 0 fail / 68 expect calls

3. `cd /Users/dev/lightcodev2/packages/opencode && bun test test/memory/ test/session/recall.test.ts`  
   **Result**: ✅ PASS — 150 pass / 0 fail / 345 expect calls

**Validated total**: 183 passing tests, 0 failures, 413 expect calls.

---

## What Passed

### 1. Runtime Composition — ✅ PASS

- `Memory.buildContext()` is the canonical runtime composition path in `src/session/prompt.ts` step `=== 1` for both normal and fork paths.
- Agent scope is now in the hot-path ancestor chain: `thread > agent > project`.
- `Memory.buildContext()` now falls back to `SemanticRecall.recent(allScopes, 5)` when FTS returns no results.
- Observations still load separately through `SystemPrompt.observations(sessionID)` every turn by design.

### 2. OM Durability — ✅ PASS

- Canonical durability path remains `OM.addBufferSafe()` in the prompt observer closure, followed by in-memory `OMBuf.seal()`.
- Production regression coverage still checks this path remains present.

### 3. Working Memory — ✅ PASS

- `src/memory/working-memory.ts` now deduplicates by `r.key`, not `${scope_type}:${key}`.
- This restores the intended precedence rule: `thread > agent > project > user > global_pattern`.
- The production suite explicitly covers duplicate-key precedence and regression behavior.

### 4. Recall — ✅ PASS

- `src/memory/semantic-recall.ts` now uses cleaned tokens plus a two-pass search strategy:
  - high-precision quoted AND first
  - prefix OR fallback second
- Bad tokens like `AND`, `OR`, `NOT`, punctuation, `fix:`, and `(parens)` no longer create noisy fallback behavior.
- Natural-language recall quality improved materially, and the production tests validate both exact and fallback paths.

### 5. Agent Scope — ✅ PASS

- `update_working_memory` now exposes `agent` scope in `src/tool/memory.ts`.
- `prompt.ts` passes agent scope into hot-path `Memory.buildContext()` calls.
- `src/memory/contracts.ts` now correctly documents `agent` as operational.

### 6. Engram Boundary — ✅ PASS (runtime)

- `src/session/system.ts` no longer carries dead local recall helpers: `callEngramTool()`, `recallNative()`, `recallEngram()`.
- `src/flag/flag.ts` no longer exports `OPENCODE_MEMORY_USE_ENGRAM`.
- No core runtime path now requires Engram.

### 7. Validation Gate — ✅ PASS

- Typecheck passed.
- Production memory suite passed.
- Broader memory + recall suite passed.

---

## Gate Evaluation

| Gate                    | Status               | Notes                                                                                                     |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Runtime Composition  | ✅ PASS              | Canonical path is `Memory.buildContext()` in `prompt.ts` step `=== 1` for normal + fork                   |
| 2. OM Durability        | ✅ PASS              | `OM.addBufferSafe()` remains the canonical durable write path                                             |
| 3. Working Memory       | ✅ PASS              | Precedence bug fixed; duplicate logical keys no longer leak across scopes                                 |
| 4. Fork/Handoff         | ✅ PASS (regression) | Fork path still uses canonical memory build path; this initiative did not materially expand fork richness |
| 5. Project Memory       | ✅ PASS              | Project + agent + thread scope chain is operational in runtime                                            |
| 6. Recall               | ✅ PASS              | Two-pass FTS plus recent fallback materially improves recall behavior                                     |
| 7. Engram Boundary      | ✅ PASS with caveat  | Runtime no longer depends on Engram, but compatibility surfaces still exist                               |
| 8. Validation           | ✅ PASS              | All verified commands passed                                                                              |
| 9. Production Readiness | ⚠️ CONDITIONAL       | Core runtime is ready; initiative cleanup/design closure is not fully complete                            |

---

## What Remains

- The `runLoop` in `src/session/prompt.ts` is still large. This initiative added structure comments only; it did **not** complete the design goal of extracting OM coordination into a helper.
- `user` and `global_pattern` scopes remain documented but dormant.
- `SystemPrompt.observations()` still sits outside `Memory.buildContext()` by design.
- `packages/opencode/src/cli/cmd/tui/app.tsx` still calls `Engram.setRegistrar()`.
- `packages/opencode/src/dream/engram.ts` still exists as a deprecated compatibility module.
- Fork/handoff DB richness was improved in prior work, not materially changed in this production initiative.

---

## Blockers

### Runtime blockers

- None found from the verified validation commands.

### Initiative-closure blockers

- `docs/SUPERSEDED.md` is still stale relative to the current runtime truth. It still references `OPENCODE_MEMORY_USE_ENGRAM`, `recallEngram()`, and `callEngramTool()` as active rollback paths even though the local runtime path was removed.
- The original design/task goal to materially extract OM coordination from the large `runLoop` was not completed in this initiative.

These do **not** block the core memory runtime from shipping, but they do block calling the initiative fully complete with no caveats.

---

## Final Readiness Verdict

This initiative **materially improved production quality**.

The validated runtime memory path is stronger now: working-memory precedence is correct, recall quality is significantly better, zero-result recall no longer silently empties, agent scope is operational in the hot path, and dead local Engram recall code was removed.

**Verdict**: **PASS WITH WARNINGS**

- **Production rollout**: **YES** — the core LightCode memory runtime is ready for production use based on the validated gates.
- **Full initiative signoff / “nothing left to do” claim**: **NO** — not yet, because runLoop extraction was not completed and `SUPERSEDED.md` is still stale.
