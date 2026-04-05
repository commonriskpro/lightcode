# Proposal: Remove OM Force Path

## Intent

Delete the synchronous `force` observer path and align LightCode's OM runtime with Mastra's async-first buffering philosophy. Today `observer_force_tokens` defaults to `36_000` while the adaptive activation threshold can be `50_000`, so the blocking path fires before the non-blocking activation path. That turns the emergency path into the common path and pauses the main session loop during observation/reflection.

## Scope

### In Scope

- Remove `force` from `OMBuf.check()` and from the main prompt loop
- Remove `observer_force_tokens` from config, docs, tests, and `/features`
- Introduce `blockAfter` style backpressure for Observer buffering (Mastra-aligned)
- Reuse the existing `buffer -> activate` pipeline only; no duplicate observer logic
- Update `memory` spec and all affected docs/tests

### Out of Scope

- `scope: 'resource'` cross-session OM
- Reworking Reflector architecture beyond trigger/backpressure integration
- AutoDream changes

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `memory`: observer triggering, buffering backpressure, and non-blocking activation behavior

## Approach

1. Replace `force` with a `blockAfter` threshold computed from the activation threshold (default `1.2x` like Mastra).
2. Keep `buffer` async and `activate` async; remove the duplicate synchronous observer/reflection path.
3. Apply backpressure when accumulated tokens exceed `blockAfter`: wait for in-flight buffering and activation to catch up instead of running a second observer path.
4. Delete dead config/UI/docs/tests tied to `observer_force_tokens`.

## Affected Areas

| Area                                                       | Impact   | Description                                                |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `src/session/om/buffer.ts`                                 | Modified | Remove `force`, add `blockAfter`                           |
| `src/session/prompt.ts`                                    | Modified | Delete `sig === "force"` branch, add backpressure wait     |
| `src/config/config.ts`                                     | Modified | Remove `observer_force_tokens`, add `observer_block_after` |
| `src/cli/cmd/tui/component/dialog-observer-thresholds.tsx` | Modified | Remove force control, add blockAfter control               |
| `test/session/*.test.ts`                                   | Modified | Remove force assertions, add blockAfter behavior tests     |

## Risks

| Risk                                   | Likelihood | Mitigation                                      |
| -------------------------------------- | ---------- | ----------------------------------------------- |
| Backpressure too aggressive            | Medium     | Default `1.2x` threshold mirrors Mastra         |
| Observer falls behind in long sessions | Medium     | Explicit wait on in-flight buffering/activation |
| Config migration confusion             | Low        | Remove old key from docs/UI in same change      |

## Rollback Plan

Git revert. No DB migration required.

## Dependencies

- Existing OM buffering/activation pipeline must remain stable (it already is)

## Success Criteria

- [ ] No `force` branch remains in runtime code
- [ ] Main session loop no longer blocks by running `Observer.run()` synchronously
- [ ] Backpressure is applied via `blockAfter`, not a duplicate observer path
- [ ] `bun typecheck` passes
- [ ] Full test suite passes
