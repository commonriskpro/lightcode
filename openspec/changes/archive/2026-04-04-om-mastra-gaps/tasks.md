# Tasks: om-mastra-gaps

### Phase 1 — Async Buffering + Compression Start Level

### T-1.1 — Add inFlight map + helpers to buffer.ts

- **Files**: `packages/opencode/src/session/om/buffer.ts`
- **What**: Add module-level `inFlight` and export `setInFlight`, `getInFlight`, `clearInFlight`, `awaitInFlight` on `OMBuf`.
- **Acceptance**: Stores/retrieves/deletes promises; `awaitInFlight` awaits then clears.
- **Tests required**: yes
- [x] done

### T-1.2 — Wire background Observer spawn in prompt.ts buffer branch

- **Files**: `packages/opencode/src/session/prompt.ts`
- **What**: On `sig === "buffer"`, start `Observer.run()` + `OM.addBuffer()` in a fire-and-forget promise and store it with `OMBuf.setInFlight`.
- **Acceptance**: No await in the loop; `inFlight` is set; duplicate buffer signals skip.
- **Tests required**: no
- [x] done

### T-1.3 — Wire activate branch in prompt.ts

- **Files**: `packages/opencode/src/session/prompt.ts`
- **What**: On `sig === "activate"`, await `OMBuf.awaitInFlight(sid)` before `OM.activate(sid)`.
- **Acceptance**: Existing in-flight work finishes first; activation runs after.
- **Tests required**: no
- [x] done

### T-1.4 — Add session cleanup await in prompt.ts

- **Files**: `packages/opencode/src/session/prompt.ts`
- **What**: Before session teardown, await `OMBuf.awaitInFlight(sid)`.
- **Acceptance**: Cleanup waits for any active buffer promise.
- **Tests required**: no
- [x] done

### T-1.5 — Add startLevel helper to reflector.ts

- **Files**: `packages/opencode/src/session/om/reflector.ts`
- **What**: Export `startLevel(modelId: string): CompressionLevel` and use it as the initial loop level.
- **Acceptance**: `gemini-2.5-flash` => `2`; others => `1`; loop no longer starts at `0`.
- **Tests required**: yes
- [x] done

### T-1.6 — Unit tests for Phase 1

- **Files**: `packages/opencode/test/session/observer.test.ts`
- **What**: Test `OMBuf` in-flight lifecycle and `startLevel`.
- **Acceptance**: `set/get/clear/await` work; `startLevel("google/gemini-2.5-flash") === 2`; `startLevel("gpt-4o") === 1`.
- **Tests required**: yes
- [x] done

### Phase 2 — Observer Prompt Richness

### T-2.1 — Enrich PROMPT constant in observer.ts

- **Files**: `packages/opencode/src/session/om/observer.ts`
- **What**: Replace `PROMPT` with the richer Mastra-style instructions.
- **Acceptance**: Adds temporal anchoring, state-change framing, precise verbs, and detail preservation; XML output stays unchanged.
- **Tests required**: yes
- [x] done

### Phase 3 — Observer Context Truncation

### T-3.1 — Implement truncateObsToBudget helper in observer.ts

- **Files**: `packages/opencode/src/session/om/observer.ts`
- **What**: Export pure `truncateObsToBudget(obs, budget)` using char>>2 estimates, suffix sums, head preservation, and truncation markers.
- **Acceptance**: `0` => `""`; fit => unchanged; overflow => marker inserted; `🔴` head lines preserved.
- **Tests required**: yes
- [x] done

### T-3.2 — Add observer_prev_tokens config key

- **Files**: `packages/opencode/src/config/config.ts`
- **What**: Add `experimental.observer_prev_tokens` as `number | false`.
- **Acceptance**: Schema accepts positive ints, `false`, and omission.
- **Tests required**: no
- [x] done

### T-3.3 — Apply truncation in Observer.run()

- **Files**: `packages/opencode/src/session/om/observer.ts`
- **What**: Read `cfg.experimental?.observer_prev_tokens`, default `2000`, and truncate `input.prev` before appending it.
- **Acceptance**: Small budgets trim `prev`; `false` keeps legacy behavior.
- **Tests required**: yes
- [x] done

### T-3.4 — Unit tests for truncateObsToBudget

- **Files**: `packages/opencode/test/session/observer.test.ts`
- **What**: Cover truncation edge cases and marker preservation.
- **Acceptance**: Tests budget `0`, fit, overflow, `🔴` preservation, and `✅` preservation.
- **Tests required**: yes
- [x] done

### Phase 4 — Verification

### T-4.1 — Run full test suite

- **Files**: run from `packages/opencode`
- **What**: Run `bun test --timeout 30000`.
- **Acceptance**: All tests pass.
- **Tests required**: no
- [x] done

### T-4.2 — Run typecheck

- **Files**: run from `packages/opencode`
- **What**: Run `bun typecheck`.
- **Acceptance**: Zero type errors.
- **Tests required**: no
- [x] done

## Implementation Order

Phase 1 (T-1.1 → T-1.6) → Phase 2 (T-2.1) → Phase 3 (T-3.1 → T-3.4) → Phase 4 (T-4.1 → T-4.2)
