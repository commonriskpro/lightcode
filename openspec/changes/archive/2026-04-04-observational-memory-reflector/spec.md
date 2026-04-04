# Observational Memory Reflector Specification

## Purpose

Condense observational memory when it grows too large (e.g., > 40,000 tokens) to prevent prompt bloat while preserving continuity for the background observer.

## Requirements

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

### Requirement: system[2] injection preference

The system prompt assembler MUST prioritize `reflections` over raw `observations`.

#### Scenario: Reflections available

- GIVEN a session has non-null `reflections`
- WHEN system prompt is assembled
- THEN `system[2]` MUST use `reflections` content

#### Scenario: Reflections absent

- GIVEN a session has NULL `reflections` but non-null `observations`
- WHEN system prompt is assembled
- THEN `system[2]` MUST use `observations` content (Phase 2 behavior)

### Requirement: observations preserved for Observer continuity

The original observations MUST be preserved for the next Observer cycle.

#### Scenario: Observer cycle after reflection

- GIVEN Reflector runs successfully
- WHEN next Observer cycle fires
- THEN Observer.run MUST receive `observations` as `prev` (not `reflections`)
- AND `observations` MUST NOT be cleared or replaced by the Reflector

### Requirement: Graceful degradation

The system MUST NOT trigger reflection if the observer is disabled and no model is configured.

#### Scenario: Unconfigured observer fallback

- GIVEN `observer_model` is not configured AND `observer: false`
- WHEN observation_tokens crosses 40k threshold
- THEN Reflector MUST NOT fire
- AND session MUST continue with existing observations injected normally
