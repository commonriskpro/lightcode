# Proposal: obs-chunk-splitting-openai

## Intent

Improve automatic prefix-cache hit rate for OpenAI and OpenAI-compatible providers by splitting the `observationsStable` system message into N discrete system messages — one per `<observation-group>` chunk — instead of emitting a single monolithic block. Because OpenAI prefix caching is automatic and identity-based, chunks whose text is identical between turns receive cache hits with no API changes. Only the newest chunk changes each turn; older chunks remain byte-for-byte stable and are served from cache.

## Scope

### In Scope

- Split `observationsStable` at `<observation-group>` boundaries in the non-Anthropic branch of `LLM.stream()`.
- Emit each chunk as its own `{ role: "system", content: chunk }` message in the `blocks` array.
- Track per-chunk layers in `PromptProfile` using indexed keys (`observations_stable_0`, `observations_stable_1`, …) so the debug panel and cache diagnostics remain accurate.
- Preserve the existing bp2 (`working_memory` + `observations_stable`) stability signal in `bpStat` — hash over the concatenation of all chunk hashes.
- Handle the zero-boundary case: if `observationsStable` contains no `<observation-group>` tags, behaviour is identical to today (single system message block).

### Out of Scope

- The Anthropic path (`anthropic === true` branch) — it uses explicit 4-slot breakpoints and **must not change**.
- Any changes to the observation format, delimiter syntax, or how `<observation-group>` tags are produced by the observer / reflector pipeline.
- Changes to how `observationsLive` (suggested continuation) is handled.
- Provider-specific prompt cache metadata or API options — OpenAI prefix caching is automatic; no request-level hints are needed.
- Reducing memory budgets or observation quality.

## Capabilities

### New Capabilities

- **Observation chunk cache reuse (OpenAI path)**: stable historical observation chunks from prior turns are served from prefix cache automatically, reducing reprocessed prompt tokens on every turn after the first.

### Modified Capabilities

- **`observations_stable` prompt layer**: changes from a single system message to N system messages in the non-Anthropic path. The `PromptProfile` layer list expands from one `observations_stable` entry to N indexed entries.

## Approach

1. Extract a pure `splitObsChunks(text: string): string[]` helper in `system.ts` that splits on `<observation-group>` tag boundaries, returning the full wrapped tag strings as individual chunks. Falls back to `[text]` when no groups are present.
2. In `LLM.stream()`, replace the single `stableObs` entry in the non-Anthropic `blocks` array with a spread of the chunk array produced by `splitObsChunks`.
3. In the `PromptProfile.set()` call, replace the single `promptProfile.observations_stable` layer with N indexed layers (`observations_stable_0` … `observations_stable_N-1`), each with its own token count and hash.
4. Update `bpStat` in `prompt-profile.ts` to treat the bp2 stability check as a match against any key matching the `observations_stable_*` prefix, so the breakpoint signal still fires when any chunk changes.

## Affected Areas

| Area                                              | Impact   | Description                                                                                                  |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/opencode/src/session/llm.ts`            | Modified | Non-Anthropic `blocks` array — spread N chunks instead of 1 string; update `PromptProfile.set()` layers      |
| `packages/opencode/src/session/system.ts`         | Modified | Add `splitObsChunks()` helper that splits at `<observation-group>` boundaries                                |
| `packages/opencode/src/session/prompt-profile.ts` | Modified | `bpStat` key matching generalised to `observations_stable_*` prefix                                          |
| Debug / TUI cache panel                           | Low      | Layer list now contains N `observations_stable_*` entries instead of 1; display logic may need to group them |

## Risks

| Risk                                                    | Likelihood | Mitigation                                                                             |
| ------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Anthropic path accidentally modified                    | Low        | Change is guarded by existing `anthropic` boolean branch; add a targeted test          |
| Zero-boundary observation renders differently           | Low        | Explicit fallback to `[stableObs]` when no groups present                              |
| PromptProfile key collision between sessions            | None       | Keys are session-scoped; N is bounded by observation chunk count                       |
| bp2 stability signal broken by key rename               | Medium     | Update `bpStat` to match `observations_stable` prefix; add a regression test           |
| Very long chunk arrays inflate the system message array | Low        | Chunk count is bounded by observation group count (O(turns/threshold)), typically < 20 |

## Rollback Plan

The change is self-contained to `llm.ts` and `system.ts`. A single-line revert that restores `stableObs` as a scalar in the non-Anthropic `blocks` array and reverts the `PromptProfile.set()` layers call is sufficient. No schema migration, no database change, no provider API change.

## Dependencies

- Requires the existing `<observation-group>` tagging produced by `wrapInObservationGroup()` in `session/om/groups.ts`. No changes to that module.
- The `parseObservationGroups()` function in `groups.ts` is reused (or its regex pattern is reused) for splitting.

## Success Criteria

- [ ] Non-Anthropic requests emit N `role: "system"` messages when `observationsStable` contains N `<observation-group>` blocks.
- [ ] When `observationsStable` has no groups, exactly one `role: "system"` message is emitted — identical to today.
- [ ] Anthropic branch emits identical blocks as before — no regression.
- [ ] `PromptProfile` stores `observations_stable_0` … `observations_stable_N-1` layers with correct token counts and hashes.
- [ ] bp2 stability status correctly reflects whether any stable observation chunk changed between turns.
- [ ] Typecheck passes with no new errors.
- [ ] Existing tests pass without modification.
