# Observational Memory + Engram Integration Specification

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

- GIVEN a session has between 30k and 36k unobserved tokens
- WHEN a turn completes
- THEN the system MUST activate the Observer to process the buffered tokens and unobserved messages via a non-blocking fiber

#### Scenario: Tokens exceed force-sync threshold

- GIVEN a session exceeds 36k unobserved tokens
- WHEN a turn completes
- THEN the system MUST force-sync the Observer immediately and block further context accumulation until complete

### Requirement: Observer LLM Output Storage

The system MUST store the generated observations securely and reliably.

#### Scenario: Observer LLM runs successfully

- GIVEN unobserved messages are sent to the Observer LLM
- WHEN the Observer LLM generates a successful response
- THEN the system MUST store the resulting markdown observation log in the `ObservationTable`
- AND the system MUST update the `last_observed_at` boundary timestamp

#### Scenario: Observer LLM fails or times out

- GIVEN unobserved messages are sent to the Observer LLM
- WHEN the Observer LLM fails or times out
- THEN the system MUST NOT update the `last_observed_at` boundary and MUST discard the failed output

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

The Reflector MUST process and persist condensed observations when successful, and handle failures gracefully.

#### Scenario: Successful reflection

- GIVEN observations text passed to Reflector
- WHEN Reflector LLM responds successfully
- THEN `reflections` column MUST be updated with condensed text
- AND condensed text MUST preserve all 🔴 user assertions
- AND condensed text MUST condense older observations more aggressively than recent ones

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

## Deferred Requirements

(None currently. All planned phases have been implemented.)
