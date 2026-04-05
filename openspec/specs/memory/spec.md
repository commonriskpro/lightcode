# Observational Memory + Engram Integration Specification

> **Historical spec (2026-04-05):** this spec describes the older Engram-backed memory architecture. The current implementation uses `Memory.buildContext()` plus native SQLite-backed recall, working memory, and artifacts. This document is preserved as design history.

## Purpose

Implement continuous memory for sessions by integrating cross-session recall from Engram at session start, and proactive memory writing during session idle states (AutoDream).

## Requirements

### Requirement: AutoDream Session Threading

The system MUST thread session context into the AutoDream process when a session goes idle, allowing the dream agent to save meaningful observations to Engram.

#### Scenario: Session goes idle with compaction summary

- GIVEN a session transitions to the Idle state
- AND the session contains `summary: true` assistant messages (compaction summaries)
- WHEN `Bus.subscribe(Event.Idle, (event) => ...)` receives the event and calls `idle(event.properties.sessionID)`
- THEN AutoDream MUST read the session's summary messages
- AND pass these summaries as context to the dream agent prompt
- AND the dream agent MUST use `mem_save` to persist observations to Engram under the project's topic namespace.

#### Scenario: Session goes idle without summary and without overflow

- GIVEN a session transitions to the Idle state
- AND the session does not contain any `summary: true` messages
- WHEN `idle(sid)` executes for that idle session
- THEN AutoDream MUST extract a minimal signal from the last 10 user+assistant text msgs
- AND MUST cap that fallback context at ~2000 tokens
- AND pass that fallback context to the dream agent prompt.

#### Scenario: Session goes idle with Engram unavailable

- GIVEN a session transitions to the Idle state
- AND the Engram MCP is not connected or unavailable
- WHEN `idle(sid)` fires and the dream agent attempts to save observations
- THEN the system MUST handle the `mem_save` tool failure gracefully
- AND the AutoDream process MUST complete without crashing.

### Requirement: Session Recall Injection

The system MUST inject recall context from Engram into the system prompt when a new session starts, ensuring the agent has memory of past sessions without breaking prompt caching.

#### Scenario: Session starts with Engram data available

- GIVEN a new session starts (step === 1)
- AND Engram has relevant data for the current project
- WHEN the system prompt is assembled
- THEN `SystemPrompt.recall()` MUST fetch context from Engram
- AND set the retrieved context on a dedicated LLM input field (`recall?: string`), not `input.system`
- AND `session/llm.ts` MUST extend `LLM.StreamInput` with `recall?: string` and insert recall explicitly into `system[1]` between `system[0]` and volatile content
- AND cache the recall result in the run closure for the duration of the session
- AND `system[0]` MUST NOT be modified.

#### Scenario: Session starts with no Engram data

- GIVEN a new session starts (step === 1)
- AND Engram has no relevant data for the current project
- WHEN the system prompt is assembled
- THEN `SystemPrompt.recall()` MUST return `undefined`
- AND `system[1]` MUST NOT contain any Engram recall context
- AND the recall result MUST be cached in the run closure as `undefined`.

#### Scenario: Turn execution after session start (step > 1)

- GIVEN an ongoing session processes a turn where step > 1
- WHEN the system prompt is assembled
- THEN the system MUST use the cached recall result from the run closure
- AND MUST NOT call Engram `mem_context` or `mem_search` again.

### Requirement: Graceful Degradation

The system MUST gracefully handle cases where Engram is missing, failing, or disconnected, ensuring core session operations are unaffected.

#### Scenario: Engram is not installed or disconnected

- GIVEN a new session starts
- AND the Engram binary or MCP connection is unavailable
- WHEN `SystemPrompt.recall()` is called
- THEN it MUST return `undefined` without throwing an error
- AND the session MUST proceed normally.

#### Scenario: Engram request times out

- GIVEN a new session starts
- AND the Engram MCP request times out
- WHEN `SystemPrompt.recall()` is called
- THEN the error MUST be handled via `Effect.catchAll((_) => Effect.succeed(undefined))`
- AND return `undefined`
- AND the session MUST proceed normally.

#### Scenario: Public AutoDream API remains backward compatible

- GIVEN existing callers invoke `AutoDream.run("auth system")`
- WHEN this change is applied
- THEN `run(focus?: string)` MUST remain the public signature
- AND idle-triggered session threading MUST execute through internal `idle(sid)` only.

### Requirement: Memory Content Quality

The system MUST scope recall context appropriately to provide the agent with relevant cross-session memory.

#### Scenario: Recall fetch for existing project

- GIVEN a project with multiple past observations saved in Engram
- WHEN `SystemPrompt.recall()` fetches context
- THEN the fetched content MUST include recent project-scoped observations
- AND MAY include relevant observations retrieved via search
- AND the combined context MUST fit within a reasonable token budget.

### Requirement: Observer Trigger and Buffering

The system MUST track unobserved tokens and trigger the Observer or buffering process based on thresholds.

#### Scenario: Tokens below buffer threshold

- GIVEN a session has < 6k unobserved tokens
- WHEN a turn completes
- THEN the system MUST NOT trigger any Observer or buffering action

#### Scenario: Tokens reach buffer interval

- GIVEN a session reaches a 6k unobserved token interval but is < 30k total unobserved
- WHEN a turn completes
- THEN the system SHOULD trigger a background buffer pre-compute via a non-blocking fiber

#### Scenario: Tokens reach activation threshold

- GIVEN a session reaches the effective activation threshold
- WHEN a turn completes
- THEN the system MUST activate the Observer to process the buffered tokens and unobserved messages via a non-blocking fiber

#### Scenario: Tokens exceed blockAfter threshold

- GIVEN a session exceeds `blockAfter`
- WHEN a turn completes
- THEN the system MUST apply backpressure and wait for OM to catch up
- AND MUST NOT run a duplicate synchronous Observer path

### Requirement: Observer LLM Output Storage

The system MUST store the generated observations securely and reliably, including structured metadata extracted by the Observer.

#### Scenario: Observer LLM runs successfully

- GIVEN unobserved messages are sent to the Observer LLM
- WHEN the Observer LLM generates a successful response
- THEN the system MUST store the resulting observation log in the `ObservationTable`
- AND the system MUST update the `last_observed_at` boundary timestamp
- AND the system MUST store `currentTask` and `suggestedContinuation` when present in the Observer output

#### Scenario: Observer LLM fails or times out

- GIVEN unobserved messages are sent to the Observer LLM
- WHEN the Observer LLM fails or times out
- THEN the system MUST NOT update the `last_observed_at` boundary and MUST discard the failed output

#### Scenario: Observer output is degenerate

- GIVEN the Observer LLM produces degenerate repetition output
- WHEN `detectDegenerateRepetition(output)` returns `true`
- THEN the system MUST discard the output, log a warning, and NOT call `OM.upsert`

### Requirement: Observer Configuration

The system MUST respect configuration settings for the Observer model.

#### Scenario: Observer model is configured

- GIVEN `experimental.observer_model` is set
- WHEN the Observer would fire
- THEN the system MUST use the specified model for the Observer LLM call

#### Scenario: Observer model is not configured

- GIVEN `experimental.observer_model` is NOT set
- WHEN the Observer would fire
- THEN the system MUST disable the Observer gracefully

### Requirement: Reflector trigger

The system MUST trigger the Reflector based on the observation tokens threshold and execution path.

#### Scenario: Token threshold not met

- GIVEN `observation_tokens <= 40_000` after activate
- WHEN turn completes
- THEN Reflector MUST NOT fire

#### Scenario: Token threshold met on activate path

- GIVEN `observation_tokens > 40_000` after activate path
- WHEN turn completes
- THEN Reflector SHOULD fire as non-blocking background fiber

#### Scenario: Token threshold met on force path

- GIVEN `observation_tokens > 40_000` after force path
- WHEN turn completes
- THEN Reflector MUST fire inline (blocking)

### Requirement: Reflector LLM output

The Reflector MUST process and persist condensed observations when successful. It MUST validate that output is smaller than input, retrying with up to 4 progressively aggressive compression levels. It MUST use the best result produced if all retries fail. It MUST handle failures gracefully.

#### Scenario: Successful reflection — first attempt compresses

- GIVEN observations text passed to Reflector
- WHEN Reflector LLM responds with output smaller than input (validated via `text.length >> 2 < THRESHOLD`)
- THEN `reflections` column MUST be updated with condensed text
- AND condensed text MUST preserve all 🔴 user assertions
- AND condensed text MUST condense older observations more aggressively than recent ones

#### Scenario: First attempt fails compression — retry with escalating guidance

- GIVEN the Reflector's first LLM output has more tokens than the input
- WHEN `validateCompression` returns `false`
- THEN the Reflector MUST retry up to level 4 with progressively more aggressive `COMPRESSION_GUIDANCE`
- AND MUST track the smallest output across all attempts
- AND MUST call `OM.reflect` with the smallest output after exhausting retries

#### Scenario: Reflector output is degenerate

- GIVEN the Reflector LLM produces degenerate repetition output
- WHEN `detectDegenerateRepetition(output)` returns `true`
- THEN the Reflector MUST discard that attempt, advance compression level, and NOT call `OM.reflect` with it

#### Scenario: Reflection failure or unconfigured model

- GIVEN Reflector LLM fails or observer_model not configured
- WHEN Reflector fires
- THEN `reflections` MUST remain unchanged (NULL or previous value)
- AND session MUST continue normally

### Requirement: observations preserved for Observer continuity

The original observations MUST be preserved for the next Observer cycle.

#### Scenario: Observer cycle after reflection

- GIVEN Reflector runs successfully
- WHEN next Observer cycle fires
- THEN Observer.run MUST receive `observations` as `prev` (not `reflections`)
- AND `observations` MUST NOT be cleared or replaced by the Reflector

### Requirement: Graceful degradation (Reflector)

The system MUST NOT trigger reflection if the observer is disabled and no model is configured.

#### Scenario: Unconfigured observer fallback

- GIVEN `observer_model` is not configured AND `observer: false`
- WHEN observation_tokens crosses 40k threshold
- THEN Reflector MUST NOT fire
- AND session MUST continue with existing observations injected normally

## MODIFIED Requirements (Phase 2-3)

### Requirement: System Prompt Assembly

The system MUST assemble the prompt such that local observations or reflections are included without destabilizing existing cached segments.

#### Scenario: Session has active reflections

- GIVEN a session with non-null `reflections`
- WHEN the system prompt is assembled
- THEN the system MUST inject the reflections at `system[2]`
- AND the system MUST leave `system[0]` untouched (1h cache)
- AND the system MUST leave `system[1]` untouched (5min cache)

#### Scenario: Session has active observations (no reflections)

- GIVEN a session with NULL `reflections` but non-null observations in the `ObservationTable`
- WHEN the system prompt is assembled
- THEN the system MUST inject the observations at `system[2]` (Phase 2 behavior)
- AND the system MUST leave `system[0]` untouched (1h cache)
- AND the system MUST leave `system[1]` untouched (5min cache)

### Requirement: AutoDream Context Consolidation

The system MUST provide AutoDream with a complete picture of the session, including local observations.

#### Scenario: AutoDream fires with local observations

- GIVEN a session with local observations in `ObservationTable` (no compaction summaries)
- WHEN the session goes idle and AutoDream fires
- THEN the system MUST read the local observations AND existing summaries
- AND the system MUST pass the combined signal to the dream agent

### Requirement: Intra-Session Observer Output

The Observer MUST produce structured XML output containing `<observations>`, `<current-task>`, and `<suggested-response>` sections. The system MUST parse each section independently. When `<observations>` tags are absent, the system MUST fall back to treating the full output as plain observations (backwards-compatible).

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

### Requirement: Observer currentTask Round-Trip

The system MUST persist `currentTask` from each Observer cycle and pass it back to the next Observer call as `priorCurrentTask` context, maintaining continuity between observation cycles.

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

### Requirement: Adaptive Message Threshold

The message token threshold for triggering the Observer MAY be configured as a `ThresholdRange { min, max }` instead of a fixed number. When a range is provided, the effective threshold MUST shrink proportionally as observation tokens grow.

#### Scenario: Adaptive threshold with no observations

- GIVEN `observer_message_tokens` is configured as `{ min: 30_000, max: 70_000 }`
- AND the session has 0 observation tokens
- WHEN `calculateDynamicThreshold(threshold, 0)` is called
- THEN it MUST return `70_000` (full budget available for messages)

#### Scenario: Adaptive threshold with existing observations

- GIVEN `observer_message_tokens` is `{ min: 30_000, max: 70_000 }` and `observation_tokens = 20_000`
- WHEN `calculateDynamicThreshold(threshold, 20_000)` is called
- THEN it MUST return `50_000` (70k − 20k)

#### Scenario: Adaptive threshold floored at min

- GIVEN `observer_message_tokens` is `{ min: 30_000, max: 70_000 }` and `observation_tokens = 50_000`
- WHEN `calculateDynamicThreshold(threshold, 50_000)` is called
- THEN it MUST return `30_000` (never below min)

#### Scenario: Fixed threshold — no change in behavior

- GIVEN `observer_message_tokens` is a plain `number`
- WHEN `calculateDynamicThreshold(number, anyValue)` is called
- THEN it MUST return the number unchanged

### Requirement: Degenerate Output Detection

The system MUST implement `detectDegenerateRepetition(text)` that returns `true` when an LLM output contains pathological repetition, indicating a model repeat-penalty failure. Detection MUST only run on text longer than 2000 characters.

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

## Phase 1A — Async Buffering (Gap 1)

### Requirement: Async Buffer Pre-Computation

The OM system MUST pre-compute observations in the background when `OMBuf.check()` returns `"buffer"`, without blocking the agent loop turn.

#### Scenario: Normal async buffer flow

- GIVEN the OM buffer threshold is reached and `OMBuf.check()` returns `"buffer"`
- WHEN the orchestrator loops
- THEN a background Observer LLM call MUST be started
- AND the promise MUST be stored in the `inFlight` map
- AND the loop MUST NOT block waiting for the LLM call to finish
- AND when the LLM call finishes, the result MUST be written via `OM.addBuffer()` and the `inFlight` map entry MUST be removed

#### Scenario: Late activate

- GIVEN a background Observer LLM call is in-flight for the session
- WHEN `OMBuf.check()` returns `"activate"` before the background call finishes
- THEN the system MUST await the existing promise from the `inFlight` map
- AND after it resolves, the system MUST call `OM.activate()` to merge the buffers

#### Scenario: Duplicate buffer prevention

- GIVEN a background Observer LLM call is already in-flight for the session
- WHEN `OMBuf.check()` returns `"buffer"` again
- THEN the system MUST NOT start a second Observer LLM call
- AND the existing promise MUST continue unchanged

#### Scenario: Session end with in-flight promise

- GIVEN a background Observer LLM call is in-flight for the session
- WHEN the session ends or is cleaned up
- THEN the system MUST await the promise in the `inFlight` map before disposing of the session
- AND the observation MUST NOT be lost

### Requirement: In-Flight Operations Tracking

A module-level `Map<SessionID, Promise<void>>` (call it `inFlight`) MUST track in-flight background operations per session, preventing duplicate fires and ensuring proper cleanup on session end.

## Phase 1B — Compression Start Level (Gap 3)

### Requirement: Reflector Compression Initialization

The Reflector MUST NOT start the compression retry loop at level 0 (no guidance). For model IDs containing `"gemini-2.5-flash"`, the Reflector MUST start compression at level 2. For all other models, the Reflector MUST start compression at level 1. A pure helper function `startLevel(modelId: string): CompressionLevel` MUST be exported from `reflector.ts` for testability.

#### Scenario: gemini-2.5-flash starts at level 2

- GIVEN the configured observer model ID contains `"gemini-2.5-flash"`
- WHEN the Reflector starts the compression loop
- THEN the `startLevel` helper MUST return `2`
- AND the compression loop MUST begin at level 2

#### Scenario: Other model starts at level 1

- GIVEN the configured observer model ID is `"gpt-4o"` (or any other model)
- WHEN the Reflector starts the compression loop
- THEN the `startLevel` helper MUST return `1`
- AND the compression loop MUST begin at level 1

#### Scenario: Compression succeeds at start level

- GIVEN the Reflector starts compression at level 1 or 2
- WHEN the LLM returns a successfully compressed output on the first attempt
- THEN the loop MUST terminate
- AND no escalation to higher levels MUST occur

## Phase 2 — Observer Prompt Richness (Gap 2)

### Requirement: Enriched Observer Prompt

The Observer `PROMPT` MUST include temporal anchoring instructions for splitting multi-event messages, state-change framing instructions for transitions, precise action verb mapping (replacing vague verbs), and detail preservation guidance for lists, names, @handles, numerical values, and identifiers. The existing XML output format (`<observations>`, `<current-task>`, `<suggested-response>`) MUST be preserved unchanged.

#### Scenario: Multi-event message is split correctly

- GIVEN a user message contains multiple distinct events (e.g., "Yesterday I did X, today I am doing Y")
- WHEN the Observer LLM processes the message
- THEN the output MUST contain separate observation lines for X and Y
- AND each line MUST include its correct resolved temporal anchor

#### Scenario: State change framing produced

- GIVEN a user states they are moving from React to Svelte
- WHEN the Observer LLM processes the message
- THEN the generated observation MUST frame the change explicitly, such as "will use Svelte (replacing React)"

#### Scenario: Vague verb replaced

- GIVEN a user says "I got the new Pro subscription"
- WHEN the Observer LLM processes the message
- THEN the vague verb "got" MUST be replaced with a precise action verb like "subscribed to" or "purchased"

## Phase 3 — Observer Context Truncation (Gap 4)

### Requirement: Observer Previous Context Truncation

A pure function `truncateObsToBudget(obs: string, budget: number): string` MUST be implemented in `observer.ts`, using `char >> 2` as the token estimate. The function MUST preserve all lines containing `🔴` (user assertions) and `✅` (completions) from the head, keep a raw tail of the most recent observations (O(1) suffix-sum lookup), and insert `[N observations truncated here]` markers at truncation gaps. When `budget === 0`, it MUST return an empty string. When observations fit within budget, it MUST return them unchanged.

#### Scenario: Observations fit in budget

- GIVEN the previous observations string is estimated to be 1000 tokens
- AND the configured budget is 2000 tokens
- WHEN `truncateObsToBudget` is called
- THEN the function MUST return the original observations unchanged

#### Scenario: Observations exceed budget

- GIVEN the previous observations string is estimated to be 5000 tokens
- AND the configured budget is 2000 tokens
- WHEN `truncateObsToBudget` is called
- THEN the function MUST truncate the middle observations
- AND the function MUST return a string containing the preserved head, a `[N observations truncated here]` marker, and the most recent tail fitting the budget

#### Scenario: budget=0

- GIVEN the previous observations string contains content
- AND the configured budget is `0`
- WHEN `truncateObsToBudget` is called
- THEN the function MUST return an empty string

#### Scenario: 🔴 lines preserved from head even when truncating

- GIVEN the previous observations string exceeds the token budget
- AND the head of the observations contains lines with the `🔴` emoji
- WHEN `truncateObsToBudget` is called
- THEN the returned string MUST include those `🔴` lines from the head, up to the remaining token budget limit

### Requirement: Observer Configuration for Context Truncation

The config key `experimental.observer_prev_tokens` (type: `number | false`) MUST be added. Default is `2000`. `false` disables truncation (legacy behavior). `Observer.run()` MUST apply `truncateObsToBudget` to `input.prev` before appending to the system prompt, using the configured budget.

## Phase 4 — Observation Groups and Recall (om-observation-groups)

### Requirement: Group utilities (om/groups.ts)

**REQ-1.1**: A pure function `wrapInObservationGroup(obs: string, range: string, id?: string): string` MUST wrap observations in `<observation-group id="..." range="startId:endId">...</observation-group>`. If no `id` provided, generate a short unique ID (ulid or similar).

**REQ-1.2**: A pure function `parseObservationGroups(text: string): ObservationGroup[]` MUST extract all groups from a string. For flat strings with no group markers, it MUST return `[]` (backward compatibility).

**REQ-1.3**: A pure function `stripObservationGroups(text: string): string` MUST remove all `<observation-group>` wrappers, leaving only the inner content concatenated.

**REQ-1.4**: A pure function `renderObservationGroupsForReflection(text: string): string` MUST convert groups to a format the Reflector LLM can process (markdown `## Group id` headers, preserving content).

**REQ-1.5**: A pure function `reconcileObservationGroupsFromReflection(reflected: string, source: string): string` MUST re-apply group wrappers from `source` to `reflected` output using a line-overlap heuristic. If no groups found in source, return `reflected` unchanged. If reconciliation fails to assign any groups, MUST wrap entire reflected output in a single group spanning the full source range.

**REQ-1.6**: The `ObservationGroup` type MUST be exported with fields: `id: string`, `range: string`, `content: string`.

#### Scenario: Wrap observations

- GIVEN a string of observations
- WHEN `wrapInObservationGroup` is called with a range
- THEN the output contains `<observation-group id="..." range="...">` wrapping the content

#### Scenario: Parse groups

- GIVEN a wrapped observations string
- WHEN `parseObservationGroups` is called
- THEN it returns an array with one entry per group

#### Scenario: Parse flat observations

- GIVEN a flat observations string with no group markers
- WHEN `parseObservationGroups` is called
- THEN it returns `[]`

#### Scenario: Strip groups

- GIVEN a wrapped string
- WHEN `stripObservationGroups` is called
- THEN only the inner content remains

#### Scenario: Reconcile reflections

- GIVEN the Reflector compressed observations that restructured lines
- WHEN `reconcileObservationGroupsFromReflection` is called
- THEN the output has group wrappers re-applied using line overlap

### Requirement: Observer integration

**REQ-2.1**: After `parseObserverOutput()` succeeds, `Observer.run()` MUST wrap `result.observations` in `wrapInObservationGroup(obs, range)` where `range = "firstMsgId:lastMsgId"` derived from the input messages.

**REQ-2.2**: The message range MUST use the actual `MessageID` of the first and last messages passed to the Observer, not timestamps.

**REQ-2.3**: Before calling `truncateObsToBudget`, `Observer.run()` MUST call `stripObservationGroups()` on the `prev` observations so truncation operates on clean text.

**REQ-2.4**: `OM.activate()` MUST wrap the merged output from `Observer.condense()` in a group spanning the full buffer range (first message of first buffer → last message of last buffer). The buffer records MUST carry `first_msg_id` and `last_msg_id` fields to enable this.

#### Scenario: Wrap new observer output

- GIVEN Observer.run() completes successfully
- WHEN the output is written
- THEN it is wrapped in `<observation-group range="firstId:lastId">`

#### Scenario: Truncate clean text

- GIVEN `prev` observations contain group wrappers
- WHEN building the Observer system prompt
- THEN groups are stripped before `truncateObsToBudget`

### Requirement: Reflector integration

**REQ-3.1**: Before building the Reflector prompt, `Reflector.run()` MUST call `renderObservationGroupsForReflection()` on the raw observations string to present groups to the LLM with structure.

**REQ-3.2**: After the Reflector LLM returns output, `Reflector.run()` MUST call `reconcileObservationGroupsFromReflection(reflected, source)` to re-apply group lineage.

**REQ-3.3**: The reconciled output (with group wrappers restored) MUST be what is persisted to `ObservationTable.reflections`.

#### Scenario: Render groups for Reflector

- GIVEN observations contain multiple groups
- WHEN Reflector.run() starts
- THEN the LLM receives rendered group headers

#### Scenario: Restore group lineage

- GIVEN Reflector LLM returns compressed output
- WHEN the result is parsed
- THEN group wrappers from the source are reconciled back onto the output

### Requirement: Recall tool

**REQ-4.1**: A tool named `recall` MUST be implemented at `packages/opencode/src/tool/recall.ts` and registered in `packages/opencode/src/tool/registry.ts`.

**REQ-4.2**: The tool MUST accept input `{ range: string }` where `range` is a `"startId:endId"` string from an observation group.

**REQ-4.3**: The tool MUST query the message store for messages with IDs between `startId` and `endId` (inclusive), scoped to the current session.

**REQ-4.4**: The tool MUST return a formatted list of messages (role + text content), truncated to a reasonable token limit (default 4000 tokens, `char >> 2`).

**REQ-4.5**: If no messages are found for the range, the tool MUST return a clear "no messages found" message rather than an error.

**REQ-4.6**: The tool MUST only be available when the OM system is active (i.e., observations exist for the session).

#### Scenario: Recall valid range

- GIVEN an observation group with range "msg-001:msg-050"
- WHEN the agent calls recall with that range
- THEN messages between those IDs are returned

#### Scenario: Recall empty range

- GIVEN a range with no matching messages
- WHEN recall is called
- THEN a "no messages found" message is returned (no error thrown)

### Requirement: System prompt integration

**REQ-5.1**: When observations exist and contain at least one observation group, `SystemPrompt.observations()` MUST append `OBSERVATION_RETRIEVAL_INSTRUCTIONS` after the observations block, explaining to the agent how to use the `recall` tool.

**REQ-5.2**: `OBSERVATION_RETRIEVAL_INSTRUCTIONS` MUST explain: what observation groups are, when to use recall (user asks for exact content, source needed), and how to extract the range from `<observation-group range="...">` tags.

### Requirement: Backward compatibility

**REQ-6.1**: Sessions with flat (non-grouped) observations MUST continue to work. `parseObservationGroups` returning `[]` MUST be handled gracefully everywhere it's called.

**REQ-6.2**: The `recall` tool called with a range from a legacy session MUST return a graceful "no source range available" message.

#### Scenario: Recall legacy session

- GIVEN a flat observations string (legacy session)
- WHEN the agent calls recall
- THEN a graceful "no source range" message is returned

## Deferred Requirements

(None currently. All planned phases have been implemented.)
