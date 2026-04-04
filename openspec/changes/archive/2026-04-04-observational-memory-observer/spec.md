# Specification: observational-memory-observer

## Purpose

Proactive background Observer agent that fires during active sessions to compress unobserved message history into a local `ObservationTable`.

## ADDED Requirements

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

### Requirement: Graceful Degradation

The system MUST ensure Observer failures do not crash the session loop.

#### Scenario: Observer LLM call fails

- GIVEN the Observer fires
- WHEN the LLM call fails, model is not configured, or DB is unavailable
- THEN the session MUST continue normally without observations

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

## MODIFIED Requirements

### Requirement: System Prompt Assembly

The system MUST assemble the prompt such that local observations are included without destabilizing existing cached segments.
(Previously: System prompt consisted of agent prompt, recall, env+skills, and volatile segments.)

#### Scenario: Session has active observations

- GIVEN a session with active observations in the `ObservationTable`
- WHEN the system prompt is assembled
- THEN the system MUST inject the observations at `system[2]`
- AND the system MUST leave `system[0]` untouched (1h cache)
- AND the system MUST leave `system[1]` untouched (5min cache)

### Requirement: AutoDream Context Consolidation

The system MUST provide AutoDream with a complete picture of the session, including local observations.
(Previously: AutoDream only read summary assistant messages from compaction.)

#### Scenario: AutoDream fires with local observations

- GIVEN a session with local observations in `ObservationTable` (no compaction summaries)
- WHEN the session goes idle and AutoDream fires
- THEN the system MUST read the local observations AND existing summaries
- AND the system MUST pass the combined signal to the dream agent
