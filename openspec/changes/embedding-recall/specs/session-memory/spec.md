# Session Memory Specification

## Purpose

Intra-session vector index to retrieve relevant past messages from the current session that are outside the active context window.

## Requirements

### Requirement: Indexing User Messages

The system MUST embed and index user messages in the session index.

#### Scenario: Message meets token threshold

- GIVEN a user message arrives
- AND the message has >= 50 tokens
- AND an embedder is available
- WHEN the turn starts
- THEN the message is embedded and stored in `memory_session_vectors`

#### Scenario: Message below token threshold

- GIVEN a user message arrives
- AND the message has < 50 tokens
- WHEN the turn starts
- THEN the message is NOT indexed

#### Scenario: No embedder available

- GIVEN a user message arrives
- AND no embedder is available
- WHEN the turn starts
- THEN the indexing is silently skipped

### Requirement: Recalling Past Messages

The system SHALL query the session index for relevant past messages at the start of each turn.

#### Scenario: Relevant messages found

- GIVEN an active session with indexed messages
- AND the user sends a new message
- WHEN the turn starts
- THEN the system queries the index for the top 5 results
- AND results with a cosine distance score < 0.25 are excluded
- AND results already in the active context window (by `msg_id`) are excluded
- AND the remaining snippets are injected into the prompt

### Requirement: Session Cleanup

The system MUST clean up the session index when the session closes.

#### Scenario: Session ends

- GIVEN an active session with a populated index
- WHEN the session closes
- THEN all entries in `memory_session_vectors` for that session are deleted
