# Delta Spec: OM Configurable Thresholds (memory)

> **Type:** Delta — amends `openspec/specs/memory/spec.md`
> **Change:** `om-configurable-thresholds`

---

## MODIFIED: Observer force threshold is configurable

### Requirement: `observer_force_tokens` config key

The system MUST respect `experimental.observer_force_tokens` as the hard-force ceiling for
`OMBuf.check()`. When the key is absent the default MUST be `36_000` (identical to prior
hardcoded behavior).

#### Scenario: force threshold uses config value when set

- GIVEN `experimental.observer_force_tokens` is set to `50_000` in the project config
- AND the accumulated message tokens for a session reach `50_000`
- WHEN `OMBuf.check(sid, tok, obsTokens, msgThreshold)` is evaluated
- THEN the function MUST return `"force"`
- AND it MUST NOT return `"force"` at the previous default of `36_000`

#### Scenario: force threshold falls back to 36_000 when unset

- GIVEN `experimental.observer_force_tokens` is absent from the project config
- AND accumulated message tokens reach `36_000`
- WHEN `OMBuf.check(sid, tok, ...)` is evaluated
- THEN the function MUST return `"force"` at exactly `36_000` tokens

---

## MODIFIED: Reflector threshold is configurable

### Requirement: `observer_reflection_tokens` config key

The system MUST respect `experimental.observer_reflection_tokens` as the observation-token
threshold at which `Reflector.run()` is triggered. When the key is absent the default MUST
be `40_000`.

#### Scenario: Reflector fires at configured threshold

- GIVEN `experimental.observer_reflection_tokens` is set to `25_000`
- AND the current observation record has `observation_tokens >= 25_000`
- WHEN `Reflector.run(sid)` evaluates the threshold check
- THEN the Reflector MUST proceed with compression
- AND it MUST NOT skip because `observation_tokens < 40_000`

#### Scenario: Reflector falls back to 40_000 when unset

- GIVEN `experimental.observer_reflection_tokens` is absent
- AND `observation_tokens` is `39_999`
- WHEN `Reflector.run(sid)` is called
- THEN the Reflector MUST NOT activate (below default threshold)

---

## MODIFIED: Default `observer_message_tokens` is a range `{ min: 20_000, max: 50_000 }`

### Requirement: adaptive message-token budget on by default

The runtime default for the Observer trigger threshold MUST be
`{ min: 20_000, max: 50_000 }` when `experimental.observer_message_tokens` is absent.
This activates `calculateDynamicThreshold` out of the box.

The effective threshold at runtime is `max(min, max - obsTokens)`:

| `obsTokens` | Effective threshold       |
| ----------- | ------------------------- |
| 0           | max(20k, 50k − 0) = 50k   |
| 20_000      | max(20k, 50k − 20k) = 30k |
| 40_000      | max(20k, 50k − 40k) = 20k |
| 60_000      | max(20k, 50k − 60k) = 20k |

At 40k observation tokens the Reflector fires (default `observer_reflection_tokens = 40_000`),
so the message threshold reaches its minimum exactly when reflective compression is triggered.

#### Scenario: adaptive threshold shrinks as observations grow

- GIVEN `experimental.observer_message_tokens` is absent (uses default range)
- AND observation tokens are `0`
- WHEN `OMBuf.check(sid, tok, 0, undefined)` is called
- THEN the effective trigger threshold MUST be `50_000`

- GIVEN observation tokens are `40_000`
- WHEN `OMBuf.check(sid, tok, 40_000, undefined)` is called
- THEN the effective trigger threshold MUST be `20_000`

#### Scenario: explicit plain-number config overrides adaptive default

- GIVEN `experimental.observer_message_tokens` is set to `30_000` (a plain number)
- WHEN `OMBuf.check(sid, tok, obsTokens, 30_000)` is called
- THEN the function MUST use the fixed value `30_000` regardless of `obsTokens`

---

## REMOVED: Dead `&& false` guard in `SystemPrompt.environment()`

### Requirement: no permanently-dead code branches in system prompt assembly

The `system.ts` `environment()` function MUST NOT contain a branch that is statically
guaranteed to never execute. The `project.vcs === "git" && false` expression MUST be removed.

#### Scenario: environment block builds without dead branch

- GIVEN `SystemPrompt.environment()` is called for any session
- WHEN the `<directories>` section is assembled
- THEN the output MUST either contain a ripgrep tree (if activation is added in a future change)
  or an empty string — NOT the result of evaluating `project.vcs === "git" && false`
- AND the TypeScript compiler MUST NOT report an unreachable-code warning on this branch

> **Note:** Activation of the ripgrep directory tree is out of scope for this change. The dead
> block is simply deleted, leaving `""` as the static value of the `<directories>` content until
> a future change activates the feature.
