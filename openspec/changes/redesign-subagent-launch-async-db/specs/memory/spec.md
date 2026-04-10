# Delta for memory

## ADDED Requirements

### Requirement: Durable Parent Snapshot for Child Hydration

The system MUST persist the parent-derived handoff or fork snapshot as part of launch preparation so the child can hydrate from durable state.

#### Scenario: Handoff launch persists child hydration snapshot

- GIVEN a parent launches a child that requires handoff context
- WHEN launch preparation completes
- THEN the system MUST persist the handoff snapshot before child start
- AND the child MUST hydrate from that durable snapshot

#### Scenario: Fork launch persists resumable fork context

- GIVEN a parent launches a child in fork mode
- WHEN launch preparation completes
- THEN the system MUST persist the fork context before child start
- AND the child MUST be able to resume from that persisted fork context

### Requirement: Memory Writes Follow Launch Ownership

Launch-related handoff and fork writes SHALL be owned by the launch workflow rather than ad hoc task-tool persistence.

#### Scenario: Task tool delegates launch persistence

- GIVEN the task tool requests child launch
- WHEN handoff or fork memory must be written
- THEN the task tool MUST delegate that persistence to the launch workflow
- AND MUST NOT orchestrate those writes inline as independent steps

#### Scenario: Launch memory write fails

- GIVEN a launch requires handoff or fork persistence
- WHEN the launch-owned memory write fails
- THEN the system MUST fail or cancel child start
- AND MUST NOT continue with a partially prepared child session
