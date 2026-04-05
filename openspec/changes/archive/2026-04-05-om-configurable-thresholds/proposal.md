# Proposal: OM Configurable Thresholds

## Intent

Expose the three hardcoded OM thresholds as config keys so operators can tune memory behavior without patching source, activate adaptive message-token budgets by default, and remove a permanently-dead code branch in `SystemPrompt.environment()`.

## Scope

### In Scope

- **`observer_force_tokens` config key** — expose `OMBuf`'s `FORCE = 36_000` constant as `experimental.observer_force_tokens`; default 36_000 (no behavior change for existing users)
- **`observer_reflection_tokens` config key** — expose `Reflector`'s `THRESHOLD = 40_000` constant as `experimental.observer_reflection_tokens`; default 40_000 (no behavior change for existing users)
- **Adaptive default for `observer_message_tokens`** — change runtime default from fixed `30_000` to range `{ min: 20_000, max: 50_000 }`, activating `calculateDynamicThreshold` out of the box; users who already set a plain number are unaffected
- **Dead code removal** — remove `project.vcs === "git" && false` guard in `system.ts`; the `&& false` makes the entire ripgrep tree branch permanently unreachable; delete it rather than activate (activation is a separate feature)

### Out of Scope

- Activating the ripgrep directory tree feature (deferred — separate change)
- `observer_interval_tokens` (INTERVAL = 6_000 remains hardcoded; low value)
- Any Observer model-routing or cross-session changes
- UI to surface threshold values in TUI sidebar

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `memory`: Observer force threshold, Reflector threshold, and default message-token budget are now configurable

## Affected Areas

| Area                             | Impact   | Description                                                         |
| -------------------------------- | -------- | ------------------------------------------------------------------- |
| `src/config/config.ts`           | Modified | Two new optional keys in `experimental`; default description update |
| `src/session/om/buffer.ts`       | Modified | `OMBuf.check()` reads `observer_force_tokens` from config           |
| `src/session/om/reflector.ts`    | Modified | `Reflector.run()` reads `observer_reflection_tokens` from config    |
| `src/session/system.ts`          | Modified | Remove `&& false` dead guard (delete dead block)                    |
| `docs/om-gap-implementations.md` | Modified | Document new default adaptive range for `observer_message_tokens`   |

## Risks

| Risk                                                        | Likelihood | Mitigation                                                           |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Adaptive default triggers Observer earlier on lean sessions | Low        | min=20k provides floor; existing plain-number configs are unaffected |
| Reflector fires more/less often with custom value           | Low        | Defaults unchanged; users opt in explicitly                          |
| Dead-code removal breaks ripgrep tree users                 | Low        | Branch was guarded by `&& false` — no user could have relied on it   |

## Rollback Plan

Git revert. No schema changes, no migrations. Config keys are optional — reverting simply restores hardcoded constants.

## Success Criteria

- [ ] `bun typecheck` passes — 0 errors
- [ ] `bun test --timeout 30000` — 0 fail
- [ ] `OMBuf.check()` uses `observer_force_tokens` from config when set — verified by test
- [ ] `Reflector.run()` uses `observer_reflection_tokens` from config when set — verified by test
- [ ] Default `observer_message_tokens` behaves adaptively (50k at 0 obs, 20k at 40k obs) — verified by test
- [ ] `system.ts` dead block is absent — verified by typecheck + code review
