# Tasks: om-remove-force

## T-1 — Buffer state machine

- [ ] **T-1.1** `src/session/om/buffer.ts` — replace `FORCE` with `BLOCK_AFTER`
- [ ] **T-1.2** change `OMBuf.check()` return type from `"buffer" | "activate" | "force" | "idle"` to `"buffer" | "activate" | "block" | "idle"`
- [ ] **T-1.3** remove `forceThreshold?` param and add `blockAfter?: number`
- [ ] **T-1.4** compute `blockAfter = configBlockAfter ?? Math.round(trigger * 1.2)`
- [ ] **T-1.5** return `"block"` when `s.tok >= blockAfter`

## T-2 — Prompt loop cleanup

- [ ] **T-2.1** `src/session/prompt.ts` — change `OMBuf.check(...)` call to pass `observer_block_after`
- [ ] **T-2.2** delete the entire `if (sig === "force") { ... }` branch
- [ ] **T-2.3** add `if (sig === "block") { ... }` branch that waits for in-flight buffering, activates OM, optionally runs reflector, and refreshes `freshObsRec`
- [ ] **T-2.4** ensure no duplicate `Observer.run()` logic remains outside `buffer`

## T-3 — Config and features

- [ ] **T-3.1** `src/config/config.ts` — remove `observer_force_tokens`
- [ ] **T-3.2** `src/config/config.ts` — add `observer_block_after`
- [ ] **T-3.3** `src/cli/cmd/tui/component/dialog-observer-thresholds.tsx` — remove force control
- [ ] **T-3.4** `src/cli/cmd/tui/component/dialog-observer-thresholds.tsx` — add blockAfter control

## T-4 — Tests

- [ ] **T-4.1** `test/session/buffer.test.ts` — replace force tests with block tests
- [ ] **T-4.2** `test/session/observer.test.ts` — update threshold assumptions (no 36k force ceiling)
- [ ] **T-4.3** add regression test: activation can happen before blockAfter
- [ ] **T-4.4** add regression test: no `"force"` signal is returned anywhere

## T-5 — Docs and specs

- [ ] **T-5.1** update `docs/feature-catalog.md`
- [ ] **T-5.2** update `docs/memory-architecture.md`
- [ ] **T-5.3** update `docs/mastra-om-arch.md`
- [ ] **T-5.4** update `openspec/specs/memory/spec.md`

## T-6 — Verify

- [ ] **T-6.1** `bun typecheck`
- [ ] **T-6.2** full test suite passes
- [ ] **T-6.3** manual validation: Observer buffering no longer pauses the main loop at 36k-style thresholds
