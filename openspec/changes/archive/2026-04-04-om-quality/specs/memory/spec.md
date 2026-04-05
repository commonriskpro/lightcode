# Delta for Memory — OM Quality Gaps

## MODIFIED Requirements

### Requirement: Intra-Session Observer Output

The Observer MUST produce structured XML output containing `<observations>`, `<current-task>`, and `<suggested-response>` sections. The system MUST parse each section independently. When `<observations>` tags are absent, the system MUST fall back to treating the full output as plain observations (backwards-compatible).
(Previously: Observer returned free-form text; no structured sections; no currentTask or suggestedContinuation extracted)

#### Scenario: Observer returns structured XML output

- GIVEN the Observer LLM produces output containing `<observations>`, `<current-task>`, and `<suggested-response>` XML tags
- WHEN `Observer.run()` parses the result
- THEN it MUST return `{ observations, currentTask, suggestedContinuation }` as separate fields
- AND `observations` MUST contain only the content inside `<observations>` tags
- AND `currentTask` MUST contain the text inside `<current-task>` tags
- AND `suggestedContinuation` MUST contain the text inside `<suggested-response>` tags

#### Scenario: Observer returns plain text (fallback)

- GIVEN the Observer LLM produces output without `<observations>` XML tags
- WHEN `Observer.run()` parses the result
- THEN it MUST treat the entire output as observations
- AND `currentTask` and `suggestedContinuation` MUST be `undefined`

#### Scenario: Observer output is degenerate (repetition loop)

- GIVEN the Observer LLM produces output where sequential chunks are near-identical (repetition bug)
- WHEN `Observer.run()` receives this output
- THEN it MUST detect the degeneracy via `detectDegenerateRepetition(output)`
- AND MUST return `undefined` (discard the output)
- AND MUST log a warning at `log.warn` level
- AND MUST NOT call `OM.upsert` with the degenerate content

### Requirement: Observer `currentTask` Round-Trip

The system MUST persist `currentTask` from each Observer cycle and pass it back to the next Observer call as `priorCurrentTask` context, maintaining continuity between observation cycles.
(Previously: no currentTask tracking; each Observer cycle had no knowledge of prior task context)

#### Scenario: currentTask persisted after observation

- GIVEN `Observer.run()` returns a non-empty `currentTask`
- WHEN `OM.upsert` is called with the result
- THEN `current_task` MUST be written to the `ObservationTable` row for the session

#### Scenario: currentTask passed to next Observer cycle

- GIVEN an `ObservationTable` row exists for the session with a non-null `current_task`
- WHEN the next Observer cycle fires for that session
- THEN `OM.get(sid).current_task` MUST be included in the Observer prompt as `## Prior Context — Current Task`
- AND the Observer MUST update or replace it with the new task state

### Requirement: Observation Context Instructions

The system MUST inject interpretation instructions alongside the observations block in `system[2]`, telling the model how to resolve temporal conflicts, treat planned actions, and prioritize the most recent message.
(Previously: observations injected as raw `<local-observations>` block with no accompanying instructions)

#### Scenario: Observations injected with instructions

- GIVEN `SystemPrompt.observations(sid)` returns a non-undefined value
- WHEN the observations string is assembled
- THEN it MUST include `OBSERVATION_CONTEXT_INSTRUCTIONS` text AFTER the `</local-observations>` closing tag
- AND the instructions MUST instruct the model to prefer the most recent information when dates conflict
- AND the instructions MUST instruct the model to assume past planned actions completed if their date has passed

#### Scenario: suggestedContinuation injected as system-reminder

- GIVEN the current `ObservationTable` row has a non-null `suggested_continuation`
- WHEN `SystemPrompt.observations(sid)` is called
- THEN the returned string MUST include a `<system-reminder>` block containing `suggested_continuation` AFTER the observations block
- AND this reminder MUST instruct the model to continue naturally without mentioning memory or summarization

### Requirement: Reflector Compression Retry

The Reflector MUST validate that its output is smaller than the input. If not, it MUST retry with progressively more aggressive compression guidance up to 4 levels. If all retries fail, it MUST use the best result produced (smallest) rather than the uncompressed original.
(Previously: Reflector called LLM once; if output was larger than input, it was stored unchanged)

#### Scenario: Reflector first attempt succeeds (compresses)

- GIVEN `Reflector.run(sid)` fires with `observation_tokens > THRESHOLD`
- AND the first LLM call produces output with fewer tokens than the input
- WHEN `validateCompression(outputTokens, THRESHOLD)` is called
- THEN it MUST return `true`
- AND `OM.reflect(sid, result)` MUST be called with the first attempt output

#### Scenario: Reflector first attempt fails — retries with compression guidance

- GIVEN the Reflector's first LLM output has more tokens than the input
- WHEN `validateCompression` returns `false`
- THEN the Reflector MUST retry the LLM call with level-1 compression guidance appended to the prompt
- AND MUST retry up to level 4 if each attempt continues to fail compression validation
- AND MUST track the smallest output seen across all attempts
- AND MUST call `OM.reflect(sid, best)` with the smallest output after exhausting retries

#### Scenario: Reflector output is degenerate

- GIVEN the Reflector LLM produces degenerate repetition output
- WHEN `detectDegenerateRepetition(output)` returns `true`
- THEN the Reflector MUST discard that attempt
- AND MUST count it as a failed compression attempt (advance compression level)
- AND MUST NOT call `OM.reflect` with degenerate content

### Requirement: Adaptive Message Threshold

The message token threshold for triggering the Observer MAY be configured as a `ThresholdRange { min, max }` instead of a fixed number. When a range is provided, the effective threshold MUST shrink proportionally as observation tokens grow, keeping total context usage (messages + observations) within `max`.
(Previously: TRIGGER, INTERVAL, FORCE were fixed constants with no adaptive behavior)

#### Scenario: Adaptive threshold with no observations

- GIVEN `observer_message_tokens` is configured as `{ min: 30_000, max: 70_000 }`
- AND the session has 0 observation tokens
- WHEN `calculateDynamicThreshold(threshold, 0)` is called
- THEN it MUST return `70_000` (full budget available for messages)

#### Scenario: Adaptive threshold with existing observations

- GIVEN `observer_message_tokens` is `{ min: 30_000, max: 70_000 }`
- AND `observation_tokens = 20_000`
- WHEN `calculateDynamicThreshold(threshold, 20_000)` is called
- THEN it MUST return `50_000` (70k − 20k)

#### Scenario: Adaptive threshold floored at min

- GIVEN `observer_message_tokens` is `{ min: 30_000, max: 70_000 }`
- AND `observation_tokens = 50_000`
- WHEN `calculateDynamicThreshold(threshold, 50_000)` is called
- THEN it MUST return `30_000` (never below min)

#### Scenario: Fixed threshold — no change in behavior

- GIVEN `observer_message_tokens` is a plain `number` (e.g., `30_000`)
- WHEN `calculateDynamicThreshold(30_000, anyValue)` is called
- THEN it MUST return `30_000` regardless of current observation tokens

## ADDED Requirements

### Requirement: Degenerate Output Detection

The system MUST implement `detectDegenerateRepetition(text)` that returns `true` when an LLM output contains pathological repetition (identical or near-identical sequential chunks), indicating a model repeat-penalty failure. Detection MUST only run on text longer than 2000 characters.

#### Scenario: Short output skips detection

- GIVEN an output string of fewer than 2000 characters
- WHEN `detectDegenerateRepetition(text)` is called
- THEN it MUST return `false` without analysis

#### Scenario: Repetitive output detected

- GIVEN an output string of 5000+ characters where 80%+ of sequential 200-char chunks are near-identical
- WHEN `detectDegenerateRepetition(text)` is called
- THEN it MUST return `true`

#### Scenario: Normal varied output not flagged

- GIVEN a normal observation output with varied content across chunks
- WHEN `detectDegenerateRepetition(text)` is called
- THEN it MUST return `false`
