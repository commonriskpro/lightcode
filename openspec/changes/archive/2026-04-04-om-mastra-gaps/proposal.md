# Proposal: om-mastra-gaps

## Intent

Close the 4 actionable quality/performance gaps between LightCode's Observational Memory (OM) system and Mastra's `@mastra/memory` reference implementation. Gap 5 (Observation Groups + Recall tool) is explicitly deferred to a future change.

## Scope

### In Scope

- **Phase 1**: Replace synchronous Observer LLM call with true async pre-compute at threshold, and add a model-specific compression start level helper (`startLevel`).
- **Phase 2**: Enrich the observer prompt with temporal anchoring, state-change framing, precise action verbs, and detail preservation from Mastra's `OBSERVER_EXTRACTION_INSTRUCTIONS`.
- **Phase 3**: Add observer context truncation via `truncateObsToBudget` to fit previous observations within an explicit budget limit.

### Out of Scope

- Gap 5: Observation groups and a dedicated recall tool (requires schema migration and new tool registration).

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `memory`: Enhancing the observational memory (OM) system behavior with background buffering (performance), richer extraction prompts (quality), and observation truncation within context limits.

## Approach

- **Phase 1 (Async Buffering + Compression Start Level)**: Wire up the existing `OM.addBuffer()` and `OM.activate()` in `record.ts`. When `OMBuf.check()` returns `"buffer"`, spawn the Observer LLM in the background and store the Promise in a module-level map. Await this promise on `"activate"`. Add `startLevel(modelId: string)` in `reflector.ts` returning level 2 for `gemini-2.5-flash` and 1 otherwise.
- **Phase 2 (Observer Prompt Richness)**: Port key sections from Mastra's `OBSERVER_EXTRACTION_INSTRUCTIONS` into the `PROMPT` constant in `observer.ts`.
- **Phase 3 (Observer Context Truncation)**: Implement a pure `truncateObsToBudget(obs: string, budget: number)` helper in `observer.ts` using char>>2 token estimation and suffix-sum O(n) tail selection. Add `experimental.observer_prev_tokens` with default 2000 in `config.ts`. Call the helper before appending previous observations to the system prompt in `Observer.run()`.

## Affected Areas

| Area                                            | Impact   | Description                                   |
| ----------------------------------------------- | -------- | --------------------------------------------- |
| `packages/opencode/src/session/om/buffer.ts`    | Modified | Add in-flight map tracking                    |
| `packages/opencode/src/session/om/record.ts`    | Modified | Wire addBuffer/activate                       |
| `packages/opencode/src/session/om/observer.ts`  | Modified | Enrich PROMPT, add truncation helper          |
| `packages/opencode/src/session/om/reflector.ts` | Modified | Add `startLevel` helper                       |
| `packages/opencode/src/session/prompt.ts`       | Modified | Orchestration: fork at buffer, await+activate |
| `packages/opencode/src/config/config.ts`        | Modified | Add `observer_prev_tokens` config key         |

## Risks

| Risk                                    | Likelihood | Mitigation                                                                                              |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| Memory leak from unhandled Promise      | Low        | Ensure session end cleanup explicitly awaits or clears the in-flight promise map                        |
| Truncation breaking markdown formatting | Low        | Split by line and ensure chunks do not slice middle of a line; preserve important `🔴` and `✅` markers |

## Rollback Plan

- Revert prompt changes in `observer.ts` to the previous `PROMPT` constant.
- Disable async buffering by reverting orchestration changes in `prompt.ts` to use the synchronous path.
- All changes are additive with no schema migration or breaking API changes required.

## Success Criteria

- [ ] Observer executes asynchronously in the background when the buffer threshold is met.
- [ ] Compression start levels properly default to 2 for `gemini-2.5-flash` and 1 for others.
- [ ] Generated observations include detailed temporal anchors and action verbs matching the enriched prompt.
- [ ] The context truncation helper limits the previous observations to `experimental.observer_prev_tokens`.
