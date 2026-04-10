# Subagent Launch Specification

## Purpose

Define the durable async-safe lifecycle for parent→child agent launch so child execution does not depend on inline, best-effort persistence.

## Requirements

### Requirement: Durable Launch Preparation

The system MUST prepare subagent launch state durably before child execution begins.

#### Scenario: Prepare child launch successfully

- GIVEN a parent session invokes the task tool for a subagent
- WHEN launch preparation runs
- THEN the system MUST create or reserve the child session identity
- AND MUST persist launch-critical state before the child prompt starts

#### Scenario: Preparation fails before durability completes

- GIVEN a parent session invokes the task tool for a subagent
- WHEN launch preparation fails before durable state is committed
- THEN the system MUST NOT start child execution
- AND MUST return the launch as failed to the caller

### Requirement: Ordered Launch Lifecycle

The system MUST model subagent launch as explicit lifecycle states and SHALL only advance in order.

#### Scenario: Child starts after prepared state

- GIVEN a launch has reached a durable prepared state
- WHEN the runtime starts the child prompt
- THEN the system MUST transition the launch to a started state
- AND MUST associate the started child with the prepared launch record

#### Scenario: Abort between prepare and start

- GIVEN a launch has been prepared durably
- AND the parent aborts before child start
- WHEN the runtime handles the abort
- THEN the system MUST NOT start the child prompt
- AND MUST mark the launch as cancelled or failed

### Requirement: Coordinated Launch Writes

The system MUST use a single coordinated ownership path for launch-critical writes.

#### Scenario: Session and snapshot writes share one coordinator

- GIVEN launch preparation writes child session state and parent snapshot data
- WHEN those writes execute against the async database
- THEN the system MUST route them through one coordinated write path
- AND MUST NOT rely on scattered inline writes from the task tool

#### Scenario: Non-critical work happens after launch durability

- GIVEN launch-critical state has been committed
- WHEN optional metadata or background recovery work runs
- THEN the system MAY execute that work later
- AND MUST NOT delay child start on non-critical persistence
