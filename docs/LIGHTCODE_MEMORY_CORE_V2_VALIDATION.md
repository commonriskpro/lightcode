# LightCode Memory Core V2 Validation Report

**Date**: 2026-04-05  
**Project**: `lightcodev2`  
**Area**: `packages/opencode`  
**Verification mode**: Strict TDD (`openspec/config.yaml:12`)  
**Verdict**: **PASS WITH WARNINGS**

---

## 1. Scope of this validation

This report validates the **seven V2 runtime gap closures** described in:

- `docs/LIGHTCODE_MEMORY_CORE_V2_SPEC.md`
- `docs/LIGHTCODE_MEMORY_CORE_V2_DESIGN.md`
- `docs/LIGHTCODE_MEMORY_CORE_V2_TASKS.md`

I did **not** trust the summary alone. I verified:

1. The relevant source files directly
2. The V2 and V1 memory tests by execution
3. TypeScript type checking by execution
4. Coverage output by execution

I also call out where the implementation is **behaviorally correct but not literally identical** to the original spec/design text.

---

## 2. Execution evidence

### Tests

Command run from `packages/opencode`:

```bash
bun test test/memory/
```

Result:

```text
60 pass
0 fail
143 expect() calls
Ran 60 tests across 3 files.
```

Files exercised:

- `test/memory/memory-core.test.ts` — 33 tests
- `test/memory/memory-core-v2.test.ts` — 25 tests
- `test/memory/abort-leak.test.ts` — 2 tests

### Type checking

Command:

```bash
bun typecheck
```

Result:

```text
$ tsgo --noEmit
```

Exit status was successful.

### Coverage

Command:

```bash
bun test --coverage test/memory/
```

Result summary:

- Memory test suite still passed: **60 pass / 0 fail**
- Total line coverage reported by Bun for this run: **41.54%**
- Total function coverage reported by Bun for this run: **26.04%**
- `openspec/config.yaml` coverage threshold: **0%** → **pass**

Important: this is **package-wide coverage for the targeted memory test run**, not a dedicated changed-files coverage gate.

---

## 3. Completeness

### Runtime gap tasks requested for V2

| Task                                             | Status         | Notes                                                                                |
| ------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------ |
| T1 — OM atomicity fix                            | ✅ Implemented | Verified in `session/prompt.ts` and V2 tests                                         |
| T2 — Dream output capture                        | ✅ Implemented | Verified in `dream/daemon.ts`, `dream/index.ts`, and V2 tests                        |
| T3 — Fix `recallNative()` query source           | ✅ Implemented | Verified in `session/system.ts`, `session/prompt.ts`, and V2 tests                   |
| T4 — Wire working memory into prompt             | ✅ Implemented | Verified in `session/system.ts`, `session/prompt.ts`, `session/llm.ts`, and V2 tests |
| T5 — Add `update_working_memory` tool            | ✅ Implemented | Verified in `tool/memory.ts`, `tool/registry.ts`, and V2 tests                       |
| T6 — Improve semantic recall quality             | ✅ Implemented | Verified in `memory/semantic-recall.ts` and V2 tests                                 |
| T7 — Remove Engram gate from idle autodream path | ✅ Implemented | Verified in `dream/index.ts` and V2 tests                                            |

### Broader repo task doc note

`docs/LIGHTCODE_MEMORY_CORE_V2_TASKS.md` contains **9** tasks, not 7. The extra items are:

- `T8` — compatibility docs
- `T9` — regression coverage

This report focuses on the **7 runtime tasks** you asked to validate. Of the extra items:

- `T9` is effectively present: `test/memory/memory-core-v2.test.ts` exists and passes.
- `T8` was not the main subject of this validation, though `docs/SUPERSEDED.md` does contain native-memory/Engram deprecation language.

---

## 4. Build & test status

| Check             | Result    |
| ----------------- | --------- |
| Memory test suite | ✅ Passed |
| Type check        | ✅ Passed |
| Coverage gate     | ✅ Passed |

---

## 5. Behavioral compliance matrix

A scenario is only marked fully compliant when there is runtime evidence from a passing test. Where evidence is structural only, I mark it **partial**.

| Requirement              | Scenario                                                                         | Evidence                                                                                                                                            | Result       |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| T1 OM atomicity          | Seal does not advance before successful buffer write                             | `memory-core-v2.test.ts` → `OMBuf.seal does NOT advance before Observer writes (code audit)` + `seal does NOT advance if addBuffer never called...` | ⚠️ PARTIAL   |
| T1 OM atomicity          | In-memory sealing still functions                                                | `memory-core-v2.test.ts` → `OMBuf.seal advances in-memory state independently of DB writes`                                                         | ✅ COMPLIANT |
| T2 Dream capture         | Native consolidation write lands in `memory_artifacts`                           | `memory-core-v2.test.ts` → `persistConsolidation() writes to memory_artifacts...`                                                                   | ✅ COMPLIANT |
| T2 Dream capture         | Topic-key dedupe works for dream consolidations                                  | `memory-core-v2.test.ts` → `persistConsolidation() topic_key enables dedupe...`                                                                     | ✅ COMPLIANT |
| T2 Dream capture         | Daemon captures completed dream output after polling                             | Source: `src/dream/daemon.ts:114-147`                                                                                                               | ⚠️ PARTIAL   |
| T3 Native recall         | Search uses user text, not UUID                                                  | `memory-core-v2.test.ts` → `searchArtifacts with user message text...` + `UUID-as-query returns empty...`                                           | ✅ COMPLIANT |
| T3 Native recall         | Prompt extracts last user text and passes it to recall                           | Source: `src/session/prompt.ts:1757-1770`                                                                                                           | ⚠️ PARTIAL   |
| T3 Native recall         | Recency fallback used when FTS returns nothing                                   | `memory-core-v2.test.ts` → `SemanticRecall.recent() returns artifacts when FTS finds nothing` + source `session/system.ts:202-207`                  | ✅ COMPLIANT |
| T4 Working memory wiring | Working memory block formatting works                                            | `memory-core-v2.test.ts` → `wrapWorkingMemory creates correct XML block`                                                                            | ✅ COMPLIANT |
| T4 Working memory wiring | Project working memory loads when records exist                                  | `memory-core-v2.test.ts` → `projectWorkingMemory returns wrapped content when records exist`                                                        | ✅ COMPLIANT |
| T4 Working memory wiring | LLM input accepts working memory field and inserts it in system prompt assembly  | `memory-core-v2.test.ts` → `LLM StreamInput accepts workingMemory field...` + source `src/session/llm.ts:132-142`                                   | ⚠️ PARTIAL   |
| T5 Working memory tool   | Underlying persistence works                                                     | `memory-core-v2.test.ts` → `tool stores working memory correctly via Memory.setWorkingMemory`                                                       | ✅ COMPLIANT |
| T5 Working memory tool   | Tool file exists and registry exposes it                                         | `memory-core-v2.test.ts` → tool export + registry tests                                                                                             | ✅ COMPLIANT |
| T5 Working memory tool   | Actual end-to-end tool execution path writes correct scope during a live session | No direct runtime test                                                                                                                              | ❌ UNTESTED  |
| T6 Recall quality        | Preview expanded from 300 to 800 chars                                           | `memory-core-v2.test.ts` → `format() uses 800-char preview instead of 300`                                                                          | ✅ COMPLIANT |
| T6 Recall quality        | Recent-artifact fallback orders by recency and respects scope                    | `memory-core-v2.test.ts` → `recent() returns artifacts ordered...` + `recent() respects scope boundaries`                                           | ✅ COMPLIANT |
| T6 Recall quality        | FTS errors are logged rather than silently swallowed                             | Source: `src/memory/semantic-recall.ts:244-250`                                                                                                     | ⚠️ PARTIAL   |
| T7 Engram gate removal   | `idle()` no longer blocks on `Engram.ensure()`                                   | `memory-core-v2.test.ts` → `idle() does NOT call Engram.ensure()...`                                                                                | ✅ COMPLIANT |
| T7 Engram gate removal   | `autodream === false` config gate preserved                                      | `memory-core-v2.test.ts` → `idle() has proper config gate...`                                                                                       | ✅ COMPLIANT |

### Compliance summary

- **Compliant**: 13
- **Partial**: 6
- **Untested**: 1
- **Failing**: 0

The core runtime goals pass, but several items are validated via **source audit** rather than full end-to-end execution.

---

## 6. Correctness review by task

### T1 — OM atomicity fix

**Validated**

- `packages/opencode/src/session/prompt.ts:1566-1599` moved `OMBuf.seal()` and `OM.trackObserved()` inside the async closure.
- They now execute only after:
  1. `Observer.run()` returns a result
  2. `OM.addBuffer()` completes
- `msgIds` is captured before the async closure and reused inside it.

**What is honest here**

- This fixes the ordering bug.
- However, the V2 spec text said `observeSafe()` would be called. That is **not** what happened.
- `observeSafe()` is still present and still unused (`session/om/record.ts:129`; only grep hit).

**Assessment**: **Behaviorally fixed**, but **not implemented exactly as the original success metric wording described**.

### T2 — Dream output capture

**Validated**

- `packages/opencode/src/dream/daemon.ts:114-147` fetches dream session messages after polling.
- It extracts the last assistant text and calls `AutoDream.persistConsolidation()`.
- `packages/opencode/src/dream/index.ts:166-188` writes to native `memory_artifacts` with:
  - `scope_type: "project"`
  - `topic_key` support for dedupe
- V2 tests prove native writes and dedupe behavior.

**What remains honest**

- The design doc originally described a parent-side capture flow using `lastSession` returned from daemon status. That exact design was **not** implemented.
- Instead, the daemon captures the output directly. That's a design deviation, not a functional failure.
- There is no true daemon/session API integration test here; the daemon path is validated mostly by source inspection plus `persistConsolidation()` runtime tests.

**Assessment**: **Implemented and functionally sound**, but **not end-to-end proven through a live daemon integration test**.

### T3 — Fix `recallNative()` query source

**Validated**

- `packages/opencode/src/session/system.ts:181-214`
  - `recall()` now accepts `lastUserMessage?: string`
  - `recallNative()` uses `lastUserMessage?.slice(0, 500) || omRec?.current_task || "project memory"`
- `packages/opencode/src/session/prompt.ts:1757-1770` extracts the last user text and passes it to `SystemPrompt.recall(...)`.
- `packages/opencode/src/session/system.ts:202-207` falls back to `SemanticRecall.recent(...)` when FTS returns nothing.
- V2 tests prove the UUID query fails and semantic query succeeds.

**Assessment**: **Implemented correctly**.

### T4 — Wire working memory into the system prompt

**Validated**

- `packages/opencode/src/session/system.ts`
  - `wrapWorkingMemory()` exists
  - `projectWorkingMemory(pid)` exists
- `packages/opencode/src/session/prompt.ts:1766-1769` loads recall and working memory together on step 1.
- `packages/opencode/src/session/llm.ts:39-42,132-142` adds `workingMemory?: string` and injects it after recall.
- V2 tests validate formatting and project memory loading.

**Important design deviation**

- The spec/design mentions `Memory.buildContext()` as the intended runtime composition point.
- `Memory.buildContext()` still exists in `memory/provider.ts`, but it is **still not wired into the live run loop**.
- The actual implementation uses separate calls: `SystemPrompt.recall(...)` + `SystemPrompt.projectWorkingMemory(...)` + `SystemPrompt.observations(...)`.

**Assessment**: **Goal achieved**, but **literal Design 4 / spec wording is not fully matched**.

### T5 — `update_working_memory` tool

**Validated**

- New file exists: `packages/opencode/src/tool/memory.ts`
- Tool id is `update_working_memory`
- Parameters are `{ scope, key, value }` with `scope: "thread" | "project"`
- Tool calls `Memory.setWorkingMemory(...)`
- Registered in `packages/opencode/src/tool/registry.ts:41,148,181`
- V2 tests prove file presence, registry exposure, and underlying persistence behavior.

**Important design deviation**

- The design expected a `projectId` addition to `Tool.Context`.
- That did **not** happen.
- The tool resolves project scope via `Instance.project.id`, which is simpler and works.

**Assessment**: **Implemented correctly**, with a simpler-than-designed scope resolution approach.

### T6 — recall quality improvements

**Validated**

- `packages/opencode/src/memory/semantic-recall.ts:327` now uses an 800-char preview.
- `packages/opencode/src/memory/semantic-recall.ts:244-250` logs FTS errors.
- `packages/opencode/src/memory/semantic-recall.ts:262-285` adds `recent()`.
- `packages/opencode/src/session/system.ts:202-207` uses `recent()` as fallback.
- V2 tests prove preview expansion and recent ordering/scope behavior.

**Assessment**: **Implemented correctly**, though FTS error logging is only source-verified, not runtime-verified.

### T7 — Engram gate removed from idle autodream path

**Validated**

- `packages/opencode/src/dream/index.ts:119-147` no longer blocks `idle()` on `Engram.ensure()`.
- `autodream === false` config gate remains.
- V2 tests explicitly check both conditions.

**Important nuance**

- `packages/opencode/src/dream/index.ts:95-96` still calls `Engram.ensure()` in manual `run()`.
- That means the hot path is native-first, but the codebase has **not completely removed Engram.ensure from all dream entry points**.

**Assessment**: **Idle-path objective achieved**. **Full Design 7 wording is only partially achieved**.

---

## 7. Coherence against the V2 design

| Design decision                              | Status                     | Notes                                                                           |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| D1 Move seal/track after successful write    | ✅ Followed                | Matches actual `prompt.ts` implementation                                       |
| D2 Capture dream output after completion     | ✅ Followed with deviation | Capture happens in daemon, not parent idle flow                                 |
| D3 Use semantic query from last user message | ✅ Followed                | Matches implementation                                                          |
| D4 Wire memory context into prompt           | ⚠️ Deviated                | Working memory is wired, but `Memory.buildContext()` is still unused in runtime |
| D5 Add working memory tool                   | ✅ Followed with deviation | Tool added; `Tool.Context.projectId` expansion was not needed                   |
| D6 Improve recall quality                    | ✅ Followed                | Preview + recency fallback present                                              |
| D7 Isolate Engram dependency                 | ⚠️ Partially followed      | `idle()` fixed, but manual `run()` still gates on `Engram.ensure()`             |

---

## 8. Quality gate assessment

| Gate                               | Result               | Notes                                                                        |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| Gate 1 — OM hot path safety        | ✅ Pass              | Ordering bug fixed in hot path                                               |
| Gate 2 — Dream persistence         | ✅ Pass              | Native persist path works; daemon capture is source-verified                 |
| Gate 3 — Native recall usability   | ✅ Pass              | User text query + recency fallback verified                                  |
| Gate 4 — Working memory maturity   | ✅ Pass              | Prompt wiring exists and tool exposed                                        |
| Gate 5 — Native-first architecture | ✅ Pass with warning | Idle path no longer blocked by Engram; manual run still depends on it        |
| Gate 6 — Validation depth          | ✅ Pass with warning | Tests pass, but some scenarios are structural audits rather than e2e/runtime |

---

## 9. Known limitations confirmed during validation

These are real and consistent with the implementation I inspected:

1. **FTS5 AND matching**: multi-word queries still require all terms to match. No OR-mode/BM25 ranking yet.
2. **Dream output parsing is brittle**: daemon assumes a messages API response with assistant `parts` containing text.
3. **Working memory is not auto-populated**: agents must call `update_working_memory` explicitly.
4. **Recall is still FTS5-based**: no embedding/vector retrieval in V2.
5. **User-scope working memory remains intentionally unwritable by agents**.

Additional limitations from verification:

6. **No end-to-end daemon integration test** proved the full dream lifecycle over the session HTTP API.
7. **No end-to-end live tool execution test** proved `update_working_memory` inside a real session/tool call.
8. **Some V2 acceptance checks rely on source audits**, not only behavioral execution.

---

## 10. Remaining Engram dependency paths

Verified after V2:

| Path                                                     | Status              | Validation                                         |
| -------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| `packages/opencode/src/dream/engram.ts`                  | Deprecated/retained | Still present for compatibility                    |
| `packages/opencode/src/dream/ensure.ts`                  | Retained            | Still used by daemon bootstrap path                |
| `packages/opencode/src/session/system.ts:recallEngram()` | Flagged fallback    | Only used behind `OPENCODE_MEMORY_USE_ENGRAM=true` |
| `packages/opencode/src/dream/index.ts:run()`             | Still gated         | Still calls `Engram.ensure()`                      |
| `packages/opencode/src/dream/index.ts:idle()`            | Native-first        | No `Engram.ensure()` gate remains                  |

Bottom line: **the core idle/hot path no longer requires Engram**, but **manual dream execution still does**.

---

## 11. Issues found

### CRITICAL

None.

### WARNING

1. **Spec/design mismatch on `observeSafe()`**: the bug is fixed, but `observeSafe()` is still unused, contrary to the spec success-criteria wording.
2. **Spec/design mismatch on `Memory.buildContext()`**: working memory is wired into runtime, but `buildContext()` still is not.
3. **Spec/design mismatch on full Engram removal**: `idle()` is fixed, but manual `run()` still uses `Engram.ensure()`.
4. **Dream capture lacks full integration proof**: current evidence is strong, but not a live daemon/session e2e test.
5. **Tool execution lacks full integration proof**: tool registration and persistence are tested, but not a real tool-call round-trip.

### SUGGESTIONS

1. Add one integration test that runs the daemon capture path end-to-end.
2. Add one tool integration test that executes `update_working_memory` through the normal tool runtime.
3. Either update the V2 spec/design wording to match the shipped implementation, or finish the literal `buildContext()` / `run()` cleanup so docs and code converge.

---

## 12. Final verdict

**PASS WITH WARNINGS**

The **seven requested V2 runtime tasks are implemented well enough to pass validation**, and the memory suite plus typecheck both pass cleanly.

That said, here's the important part: the implementation is **not a perfect line-by-line realization of the original V2 spec/design**. The code achieves the runtime goals through slightly different wiring choices:

- `observeSafe()` was **not** wired in
- `Memory.buildContext()` is **still not** the live runtime entry point
- `Engram.ensure()` was removed from `idle()`, **not** from manual `run()`

So the honest summary is:

- **Runtime outcome**: ✅ good
- **Validation gates**: ✅ pass
- **Spec/design literal fidelity**: ⚠️ partial

If the standard is **“does V2 work and is native memory now operational in the hot path?”**, the answer is **yes**.

If the standard is **“did the code implement every design sentence exactly as written?”**, the answer is **not fully**.
