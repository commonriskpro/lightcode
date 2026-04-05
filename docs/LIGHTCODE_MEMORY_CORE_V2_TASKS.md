# LightCode Memory Core V2 — Implementation Tasks

## Execution Order / Dependency Graph

`T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8 -> T9`

## Phase 1: Runtime Safety

- **T1 — Fix OM atomicity** | Files: `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/om/record.ts` | Depends: none | AC: `OMBuf.seal()` + `OM.trackObserved()` only run after `Observer.run()` succeeds and `OM.addBuffer()` writes; `observeSafe()` comment states activate/upsert path. | Tests: OM seal regression in `test/memory/memory-core.test.ts`. | Complexity: M

## Phase 2: Native Memory Wiring

- **T2 — Capture dream output and persist it** | Files: `packages/opencode/src/dream/index.ts`, `packages/opencode/src/dream/daemon.ts` | Depends: T1 | AC: `/trigger`/status exposes dream session ID; `idle()` reads session messages, extracts last assistant text, and calls `persistConsolidation()`; no Engram gate in `idle()`. | Tests: dream persistence unit/integration path in `test/memory/memory-core-v2.test.ts`. | Complexity: L

- **T3 — Fix `recallNative()` query source** | Files: `packages/opencode/src/session/system.ts`, `packages/opencode/src/session/prompt.ts` | Depends: T1 | AC: `recall(pid, sessionId, lastUserMessage?)` uses user text/current task before falling back to `pid`; prompt passes last user text. | Tests: recall query is not UUID when user text exists. | Complexity: M

- **T4 — Inject working memory into the system prompt** | Files: `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/system.ts` | Depends: T3 | AC: `Memory.getWorkingMemory({ type: 'project', id: pid })` is formatted with `WorkingMemory.format()` and wrapped via `SystemPrompt.wrapWorkingMemory()` after semantic recall, before observations. | Tests: prompt includes WM block when records exist. | Complexity: M

- **T5 — Add `update_working_memory` tool** | Files: `packages/opencode/src/tool/memory.ts`, `packages/opencode/src/tool/tool.ts`, `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/session/prompt.ts` | Depends: T4 | AC: tool stores thread/project scope via `Memory.setWorkingMemory()`; tool context carries `projectId`; registry exposes the tool. | Tests: tool writes correct scope and key/value. | Complexity: M

- **T6 — Improve semantic recall quality** | Files: `packages/opencode/src/memory/semantic-recall.ts` | Depends: T3 | AC: preview expands to 800 chars, scope query is parameterized, title matches rank higher, FTS5 errors are logged. | Tests: semantic recall regression checks in `test/memory/memory-core-v2.test.ts`. | Complexity: M

- **T7 — Remove legacy Engram gate from AutoDream** | Files: `packages/opencode/src/dream/index.ts`, `packages/opencode/src/dream/engram.ts`, `packages/opencode/src/dream/ensure.ts` | Depends: T2 | AC: `run()` and `idle()` no longer block native autodream on `Engram.ensure()`; legacy Engram path remains isolated behind `OPENCODE_MEMORY_USE_ENGRAM=true`; `ensure.ts` marked deprecated. | Tests: autodream path works without Engram installed. | Complexity: S

- **T8 — Update compatibility docs** | Files: `docs/SUPERSEDED.md` | Depends: T7 | AC: V2 supersession notes mention native memory, autodream, and deprecated Engram bootstrap path. | Tests: none. | Complexity: S

## Phase 3: Verification

- **T9 — Add regression coverage for V2 wiring** | Files: `test/memory/memory-core-v2.test.ts`, `test/memory/memory-core.test.ts` | Depends: T1–T8 | AC: covers OM atomicity, dream persistence, recall query source, WM prompt injection, and `update_working_memory`; V1 suite still passes unchanged. | Tests: new V2 suite + existing V1 suite. | Complexity: L
