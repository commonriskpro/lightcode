# Tasks: om-configurable-thresholds

## T-1 — Configurable FORCE threshold (`observer_force_tokens`)

- [x] **T-1.1** `src/config/config.ts` — add `observer_force_tokens: z.number().int().positive().optional()` to the `experimental` schema block (after the `observer_message_tokens` key, before `observer_prev_tokens`). Update `.describe()`: "Hard-force ceiling for Observer buffer (tokens). Default 36_000."
- [x] **T-1.2** `src/session/om/buffer.ts` — add `forceThreshold?: number` as a fifth parameter to `OMBuf.check()`. Replace `if (s.tok >= FORCE)` with `if (s.tok >= (forceThreshold ?? FORCE))`.
- [x] **T-1.3** `src/session/prompt.ts` (~line 1524) — pass `omCfg.experimental?.observer_force_tokens` as fifth arg to `OMBuf.check(...)`.

---

## T-2 — Configurable Reflector threshold (`observer_reflection_tokens`)

- [x] **T-2.1** `src/config/config.ts` — add `observer_reflection_tokens: z.number().int().positive().optional()` to the `experimental` schema block (after `observer_force_tokens`). Update `.describe()`: "Observation-token threshold at which the Reflector runs compression. Default 40_000."
- [x] **T-2.2** `src/session/om/reflector.ts` — remove module-level `const THRESHOLD = 40_000`. Inside `Reflector.run()`, read config: `const cfg = await Config.get()` and `const threshold = cfg.experimental?.observer_reflection_tokens ?? 40_000`. Replace all `THRESHOLD` references with `threshold`.

---

## T-3 — Adaptive default for `observer_message_tokens`

- [x] **T-3.1** `src/session/om/buffer.ts` — delete `const TRIGGER = 30_000`. Add `const DEFAULT_RANGE: ThresholdRange = { min: 20_000, max: 50_000 }`. In `OMBuf.check()`, change `const base = configThreshold ?? TRIGGER` to `const base = configThreshold ?? DEFAULT_RANGE`.
- [x] **T-3.2** `docs/om-gap-implementations.md` — add a short entry documenting the new adaptive default: state that `observer_message_tokens` now defaults to `{ min: 20_000, max: 50_000 }`, explain the shrink math (`max(min, max - obsTokens)`), and note that existing plain-number configs are unaffected.

---

## T-4 — Remove `&& false` dead guard in `system.ts`

- [x] **T-4.1** `src/session/system.ts` (~lines 34–42) — delete the `project.vcs === "git" && false ? await Ripgrep.tree(...) : ""` ternary. Replace with a plain empty string `""`. If the `Ripgrep` import is now unused, remove it. The `<directories>` tags remain as a placeholder for a future change.

---

## T-5 — Tests

- [x] **T-5.1** `test/session/buffer.test.ts` — `OMBuf.check` returns `"force"` at custom `forceThreshold` when supplied
- [x] **T-5.2** `test/session/buffer.test.ts` — `OMBuf.check` returns `"force"` at exactly `36_000` when `forceThreshold` is omitted (backward-compat check)
- [x] **T-5.3** `test/session/buffer.test.ts` — adaptive default: effective trigger is `50_000` when `obsTokens = 0` and `configThreshold` is omitted
- [x] **T-5.4** `test/session/buffer.test.ts` — adaptive default: effective trigger is `20_000` when `obsTokens = 40_000` and `configThreshold` is omitted
- [x] **T-5.5** `test/session/buffer.test.ts` — plain-number `configThreshold` (e.g. `30_000`) is used as-is regardless of `obsTokens`
- [x] **T-5.6** `test/session/reflector.test.ts` — `Reflector` does not fire when `observation_tokens < 40_000` and key is unset
- [x] **T-5.7** `test/session/reflector.test.ts` — `Reflector` fires when `observation_tokens >= custom_threshold` set via config key

---

## T-6 — Typecheck + test run

- [x] **T-6.1** `bun typecheck` from `packages/opencode` — 0 errors
- [x] **T-6.2** `bun test --timeout 30000` from `packages/opencode` — 0 fail
