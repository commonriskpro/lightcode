# Specification: om-mastra-gaps

## Phase 1A — Async Buffering (Gap 1)

### Requirement: REQ-1.1

The OM system MUST pre-compute observations in the background when `OMBuf.check()` returns `"buffer"`, without blocking the agent loop turn.

### Requirement: REQ-1.2

The background Observer LLM call MUST write its result to `ObservationBufferTable` via `OM.addBuffer()`.

### Requirement: REQ-1.3

A module-level `Map<SessionID, Promise<void>>` (call it `inFlight`) MUST track in-flight background operations per session, preventing duplicate fires.

### Requirement: REQ-1.4

When `OMBuf.check()` returns `"activate"`, the system MUST await any in-flight promise for that session, then call `OM.activate()` to condense buffers into the main observations record.

### Requirement: REQ-1.5

When `OMBuf.check()` returns `"force"`, the system MUST fall back to synchronous Observer execution (existing behavior preserved).

### Requirement: REQ-1.6

On session end or cleanup, any in-flight promise for that session MUST be awaited before the session is disposed, to prevent partial observation loss.

### Requirement: REQ-1.7

The `inFlight` map MUST be cleaned up (entry deleted) when the background operation completes, whether it succeeded or failed.

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

## Phase 1B — Compression Start Level (Gap 3)

### Requirement: REQ-2.1

The Reflector MUST NOT start the compression retry loop at level 0 (no guidance).

### Requirement: REQ-2.2

For model IDs containing `"gemini-2.5-flash"`, the Reflector MUST start compression at level 2.

### Requirement: REQ-2.3

For all other models, the Reflector MUST start compression at level 1.

### Requirement: REQ-2.4

A pure helper function `startLevel(modelId: string): CompressionLevel` MUST be exported from `reflector.ts` for testability.

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

### Requirement: REQ-3.1

The Observer `PROMPT` MUST include temporal anchoring instructions: multi-event messages MUST be split into separate observation lines, each carrying its own resolved date.

### Requirement: REQ-3.2

The Observer `PROMPT` MUST include state-change framing instructions: when a user indicates a change from X to Y, the observation MUST be framed as "will use X (replacing Y)" or equivalent.

### Requirement: REQ-3.3

The Observer `PROMPT` MUST include precise action verb mapping: vague verbs like "getting/got/have" MUST be replaced with specific verbs (subscribed to, purchased, received, was given).

### Requirement: REQ-3.4

The Observer `PROMPT` MUST include detail preservation guidance for lists, names, @handles, numerical values, quantities, and identifiers — these MUST NOT be generalized away.

### Requirement: REQ-3.5

The existing XML output format (`<observations>`, `<current-task>`, `<suggested-response>`) MUST be preserved unchanged.

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

### Requirement: REQ-4.1

A pure function `truncateObsToBudget(obs: string, budget: number): string` MUST be implemented in `observer.ts`.

### Requirement: REQ-4.2

The function MUST use `char >> 2` as the token estimate (consistent with the rest of the codebase).

### Requirement: REQ-4.3

The function MUST preserve all lines containing `🔴` (user assertions) and `✅` (completions) from the head, if the budget allows.

### Requirement: REQ-4.4

The function MUST keep a raw tail of the most recent observations (O(1) suffix-sum lookup).

### Requirement: REQ-4.5

The function MUST insert `[N observations truncated here]` markers at truncation gaps.

### Requirement: REQ-4.6

When `budget === 0`, the function MUST return an empty string.

### Requirement: REQ-4.7

When the observations fit within budget, the function MUST return them unchanged.

### Requirement: REQ-4.8

`Observer.run()` MUST apply `truncateObsToBudget` to `input.prev` before appending to the system prompt, using the configured budget.

### Requirement: REQ-4.9

The config key `experimental.observer_prev_tokens` (type: `number | false`) MUST be added. Default is `2000`. `false` disables truncation (legacy behavior).

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
