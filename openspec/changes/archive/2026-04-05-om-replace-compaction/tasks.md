# Tasks: om-replace-compaction

## Phase 1 — Gap D+C: System slot reorder

- [ ] **T-1.1** `src/session/llm.ts` — replace lines 132–134 with new slot assignment:
  - Insert `obs = input.observations ?? "<!-- ctx -->"` into `system[1]` unconditionally
  - Insert `input.recall` into `system[2]` only if truthy
  - Push `volatile` last (unchanged)
  - Remove old conditional splice logic entirely

- [ ] **T-1.2** Verify `applyCaching` in `transform.ts` needs no change — BP3 already placed on `system[1]`, which now always has the observations block

- [ ] **T-1.3** Add tests to `test/session/observer.test.ts` (or new `test/session/llm-slots.test.ts`):
  - With observations + recall: `system[1]` = observations, `system[2]` = recall, `system[last]` = volatile
  - With observations only: `system[1]` = observations, `system[2]` = volatile
  - With nothing: `system[1]` = sentinel `"<!-- ctx -->"`, `system[2]` = volatile
  - BP3 placed on `system[1]` in all cases (verify via `applyCaching` output)

---

## Phase 2 — Gap E: Observer sees tool results

- [ ] **T-2.1** `src/session/om/observer.ts` — replace the text-only `parts.filter(p.type === "text")` mapping with `flatMap` that also handles `type === "tool" && state.status === "completed"`:
  - Format: `[Tool: {p.tool}]\n{truncated_output}`
  - Truncate at `(cfg.experimental?.observer_max_tool_result_tokens ?? 500) * 4` chars
  - Append `"\n... [truncated]"` suffix when truncated
  - Messages with only tool parts (no text) still produce output

- [ ] **T-2.2** `src/config/config.ts` — add `observer_max_tool_result_tokens?: number` to the `experimental` schema object with `.describe()`

- [ ] **T-2.3** Add tests to `test/session/observer.test.ts`:
  - Tool parts included in Observer context when present
  - Tool result truncated at cap (default 500 tokens = 2000 chars)
  - Text + tool in same message: both appear in context
  - Tool-only message (no text): tool part still appears
  - Tool result under cap: not truncated (no suffix)

---

## Phase 3 — Gap F: lastObservedAt tail filter

- [ ] **T-3.1** `src/session/prompt.ts` — after `filterCompactedEffect` call (line 1476), add tail computation:

  ```ts
  const obsRec = OM.get(sessionID)
  const boundary = obsRec?.last_observed_at ?? 0
  const tail = boundary > 0 ? msgs.filter((m) => (m.info.time?.created ?? 0) > boundary) : msgs
  ```

- [ ] **T-3.2** `src/session/prompt.ts` — in the `Effect.all([...])` at line 1807, replace `MessageV2.toModelMessages(msgs, model)` with `MessageV2.toModelMessages(tail, model)`

- [ ] **T-3.3** Ensure ALL other uses of `msgs` in the loop remain unchanged (resolveTools, insertReminders, task scanning, lastUser/lastAssistant scan, unobserved computation) — only `toModelMessages` gets `tail`

- [ ] **T-3.4** Add tests to `test/session/prompt.test.ts` (or observer.test.ts integration):
  - When boundary > 0: only messages after boundary are in `toModelMessages` input
  - When boundary = 0 (no OM record): full `msgs` used — identical to current behavior
  - `msgs` used for Observer `unobserved` computation is NOT affected by tail filter

---

## Phase 4 — Delete compaction files

- [ ] **T-4.1** Delete files:
  - `src/session/compaction.ts`
  - `src/session/cut-point.ts`
  - `src/session/overflow.ts`
  - `src/agent/prompt/compaction.txt`

- [ ] **T-4.2** Delete test files:
  - `test/session/compaction.test.ts`
  - `test/session/cut-point.test.ts`
  - `test/session/revert-compact.test.ts`

---

## Phase 5 — Remove compaction call sites from prompt.ts

- [ ] **T-5.1** Remove import: `import { SessionCompaction } from "./compaction"`

- [ ] **T-5.2** Remove service yield: `const compaction = yield* SessionCompaction.Service`

- [ ] **T-5.3** Remove from `tasks.filter(...)`: remove `"compaction"` from the part type filter, keep `"subtask"` only

- [ ] **T-5.4** Delete the `if (task?.type === "compaction") { ... }` block (~10 lines, lines 1639–1648)

- [ ] **T-5.5** Delete the `if (yield* compaction.isOverflow(...)) { compaction.create(...) }` block (~5 lines, lines 1651–1658)

- [ ] **T-5.6** Replace `if (result === "compact") { yield* compaction.create(...) }` at line 1716–1724 with `// OM manages context — no compaction needed`

- [ ] **T-5.7** Replace `if (result === "compact") { yield* compaction.create(...) }` at line 1862–1870 with same no-op comment

- [ ] **T-5.8** Delete `yield* compaction.prune({ sessionID })...` at line 1882

- [ ] **T-5.9** Remove `Layer.provide(SessionCompaction.defaultLayer)` from the layer stack at line 2225

---

## Phase 6 — Remove compaction from processor.ts

- [ ] **T-6.1** Remove `needsCompaction: boolean` from `ProcessorContext` type (line 54)

- [ ] **T-6.2** Remove `needsCompaction: false` from context initializer (line 102)

- [ ] **T-6.3** Remove `ctx.needsCompaction = true` at line 357 (isOverflow check inside processor)

- [ ] **T-6.4** Change `ContextOverflowError` catch at line 467: instead of `ctx.needsCompaction = true`, set the assistant message error directly:

  ```ts
  ctx.assistantMessage.error = error
  yield * bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
  ```

- [ ] **T-6.5** Remove `Stream.takeUntil(() => ctx.needsCompaction)` at line 506

- [ ] **T-6.6** Remove `if (ctx.needsCompaction) return "compact"` at line 534

- [ ] **T-6.7** Update `Result` type: remove `"compact"` → `type Result = "continue" | "stop"`

- [ ] **T-6.8** Remove `import { isOverflow } from "./overflow"` from processor.ts

---

## Phase 7 — Remove compaction from remaining files

- [ ] **T-7.1** `src/server/routes/session.ts` — delete `POST /session/:id/compact` route handler and `import { SessionCompaction }`

- [ ] **T-7.2** `src/agent/agent.ts` — delete `import PROMPT_COMPACTION from "./prompt/compaction.txt"` and the compaction agent definition block

- [ ] **T-7.3** `src/config/config.ts` — delete the `compaction` schema key and its sub-keys (`auto`, `prune`, `reserved`, `keep`). Delete CLI flag handling for `--no-auto-compact` and `--no-prune`

- [ ] **T-7.4** `src/plugin/github-copilot/copilot.ts` line 332 — remove or adapt the `parts?.data.parts?.some((part) => part.type === "compaction")` check (this guards against sending compaction parts to Copilot — with compaction removed, simplify to always false or remove guard)

---

## Phase 8 — Typecheck + full test run

- [ ] **T-8.1** `bun typecheck` from `packages/opencode` — must pass with 0 errors

- [ ] **T-8.2** `bun test --timeout 30000` from `packages/opencode` — must pass

- [ ] **T-8.3** Verify token usage in a real search session: `cache_write` on turn 1 for `system[1]` (observations), `cache_read` on turn 2+ — confirms BP3 cache stability

- [ ] **T-8.4** Verify `filterCompacted` still works for a legacy session with compacted history in DB (existing test in `message-v2.test.ts` covers this)
