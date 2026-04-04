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

## Deferred Requirements

- Proactive Observer (Phase 2): Background LLM observation every N tokens or turns, and the implementation of `ObservationTable`.
