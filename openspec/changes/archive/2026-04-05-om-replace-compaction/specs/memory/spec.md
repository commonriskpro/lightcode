# Delta Spec: om-replace-compaction → memory capability

## Modified Requirements

### MODIFIED: Observer LLM Input — tool parts included

The Observer MUST include tool call/result parts when building the context string for the Observer LLM call.

#### Scenario: Observer runs with tool results in unobserved messages

- GIVEN the unobserved message slice contains messages with completed tool parts
- WHEN `Observer.run({ msgs: unobserved, ... })` builds the context string
- THEN each completed tool part MUST be formatted as `[Tool: {toolName}]\n{truncatedOutput}`
- AND the output MUST be truncated to at most `experimental.observer_max_tool_result_tokens * 4` characters (default 500 tokens = 2000 chars)
- AND tool parts MUST be appended after the text content of the same message
- AND messages with only tool parts and no text MUST still be included if they have completed tool results

#### Scenario: Observer runs with no tool results

- GIVEN the unobserved message slice contains only text messages
- WHEN `Observer.run()` builds the context string
- THEN behavior is identical to current — no tool formatting applied
- AND no regression in output quality

---

### MODIFIED: System prompt slot order — observations at BP3

The system prompt MUST be assembled so that `observations` occupies `system[1]` (BP3 cache slot) and `recall` occupies `system[2]` (uncached).

#### Scenario: Engram recall present, observations active

- GIVEN `input.recall` is a non-empty string
- AND `input.observations` is a non-empty string
- WHEN `LLM.stream()` assembles the `system` array
- THEN `system[0]` MUST be the agent prompt + env + skills + instructions
- AND `system[1]` MUST be `input.observations` (wrapped in `<local-observations>` tags)
- AND `system[2]` MUST be `input.recall` (wrapped in `<engram-recall>` tags)
- AND `system[last]` MUST be `SystemPrompt.volatile(model)`
- AND `applyCaching` MUST place BP3 on `system[1]` (observations)

#### Scenario: No recall, observations active

- GIVEN `input.recall` is undefined or empty
- AND `input.observations` is a non-empty string
- WHEN `LLM.stream()` assembles the `system` array
- THEN `system[1]` MUST be `input.observations`
- AND `system[2]` MUST be the volatile block
- AND BP3 MUST be placed on `system[1]` — no slot shift

#### Scenario: No recall, no observations (new session)

- GIVEN both `input.recall` and `input.observations` are undefined
- WHEN `LLM.stream()` assembles the `system` array
- THEN `system[1]` MUST be the stable sentinel string `"<!-- ctx -->"`
- AND BP3 MUST be placed on that sentinel (stable, never changes within session)
- AND no empty system message is sent

#### Scenario: BP3 cache stability across turns

- GIVEN observations have NOT been updated between turn N and turn N+1
- WHEN the LLM call is made on turn N+1
- THEN `system[1]` content MUST be byte-for-byte identical to turn N
- AND Anthropic MUST return `cache_read_input_tokens > 0` for the BP3 slot

---

### NEW: Message tail boundary — `lastObservedAt` applied to LLM call

The message array passed to `toModelMessages` MUST be filtered to only include messages created after `last_observed_at` when OM has an active observation record.

#### Scenario: OM has observed at least one batch

- GIVEN `OM.get(sessionID)` returns a record with `last_observed_at > 0`
- WHEN the main LLM call is assembled in `prompt.ts`
- THEN the message array passed to `toModelMessages` MUST only contain messages where `info.time.created > last_observed_at`
- AND the observations block in `system[1]` MUST contain the compressed summary of all previously-observed messages
- AND the model MUST NOT receive raw message content that has already been observed

#### Scenario: OM has never fired (boundary = 0)

- GIVEN `OM.get(sessionID)` returns undefined OR `last_observed_at === 0`
- WHEN the main LLM call is assembled
- THEN the full `msgs` array MUST be used (no filtering)
- AND behavior MUST be identical to current behavior

#### Scenario: Tail boundary does NOT apply to compaction LLM calls

- GIVEN a compaction LLM call is in progress (this is now dead code — compaction is removed)
- N/A — compaction LLM calls no longer exist

#### Scenario: Tail boundary does NOT apply to Observer input

- GIVEN `Observer.run()` is called with `msgs: unobserved`
- THEN `unobserved` is already the pre-filtered slice (`msgs.filter(m => created > boundary)`)
- AND no change to Observer input pipeline

---

### REMOVED: Emergency compaction

The following requirements from the previous spec are **deleted**:

- Emergency compaction trigger at context overflow threshold
- Cut-point compaction (summarize old, keep recent verbatim)
- Full replacement compaction (summarize all, replay last user message)
- `prune` operation (erasing old tool result content from DB)
- `POST /session/:id/compact` endpoint
- `CompactionPart` handling in the run loop (part type kept in schema for DB compat, but the loop no longer acts on it)
- `needsCompaction` flag in processor
- `isOverflow` check in the main run loop
- Compaction agent definition

#### Scenario: Provider returns context overflow error (413 / context_length_exceeded)

- GIVEN the LLM provider returns a context length error
- WHEN `processor.ts` catches a `ContextOverflowError`
- THEN the session MUST be marked as errored with a descriptive message
- AND the user MUST see the error in the UI
- AND no automatic compaction MUST be triggered
- AND the user may start a new session to continue

#### Scenario: Session history older than `last_observed_at`

- GIVEN a session has messages older than `last_observed_at`
- WHEN those messages are loaded via `filterCompacted`/`filterCompactedEffect`
- THEN they MUST still be loadable and displayable (DB backwards compat)
- AND `CompactionPart` rows in the DB MUST deserialize without error
- AND the `filterCompacted` function MUST continue to handle legacy compacted sessions correctly
