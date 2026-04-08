# Delta for Memory (om-observer-gaps)

## ADDED Requirements

### Requirement: Observer Completion Tracking

The Observer prompt MUST instruct the LLM to emit a `✅` marker on observation lines where a previously requested task or action has been completed by the assistant in the conversation.

A completion marker MUST only be emitted when there is clear evidence in the conversation that the task was finished (e.g., assistant confirmed, code was produced, file was written). The marker MUST NOT be emitted speculatively.

The `✅` marker MUST appear at the start of the bullet, before the emoji role marker if any, so existing `truncateObsToBudget` and Reflector logic that scan for `✅` lines continue to work without modification.

#### Scenario: Task completed in the same turn

- GIVEN the assistant produces output that clearly resolves a user-requested task
- WHEN the Observer processes that turn
- THEN the generated observation MUST start with `✅`
- AND MUST describe the outcome (what was built/fixed/answered), not just "task done"

#### Scenario: Task still in progress

- GIVEN the assistant worked on something but did not conclude it
- WHEN the Observer processes that turn
- THEN the observation MUST NOT include a `✅` marker
- AND SHOULD describe the partial progress if meaningful

#### Scenario: ✅ lines preserved by truncation

- GIVEN observations contain `✅` lines in the head
- WHEN `truncateObsToBudget` runs
- THEN `✅` lines MUST be treated as important and preserved alongside `🔴` lines (existing behavior already covers this — no code change required)

---

### Requirement: Observer Conversation Context Capture

The Observer prompt MUST instruct the LLM to capture technical conversation artifacts when they appear in the conversation, specifically:

- Code snippets, file contents, or diffs that the user provides as context
- Multi-step sequences (e.g., migration steps, install sequences) described by the user
- Explicit requirements or constraints stated by the user ("it must X", "never do Y")

These MUST be captured as `🔴` (user assertions) because they are authoritative user context, not requests.

#### Scenario: User provides a code snippet as context

- GIVEN a user message includes a code block that describes a current system state
- WHEN the Observer processes the message
- THEN the observation MUST note the existence and purpose of the snippet
- AND MUST preserve language, key identifiers, and any constraints visible in the code

#### Scenario: User states an explicit requirement

- GIVEN a user says "it must use PostgreSQL, never SQLite"
- WHEN the Observer processes the message
- THEN the observation MUST capture this as a `🔴` constraint with the exact constraint preserved

#### Scenario: Multi-step sequence mentioned

- GIVEN a user describes a 3-step migration process
- WHEN the Observer processes the message
- THEN each step MUST appear as a separate `🔴` bullet (or grouped under a header) — not collapsed into "user described a migration"

---

### Requirement: Observer User Message Fidelity

The Observer prompt MUST instruct the LLM to distinguish between messages that should be captured near-verbatim and those that can be summarized:

- **Near-verbatim**: user assertions with specific values (names, numbers, identifiers, URLs, constraints) — these MUST be preserved with high fidelity
- **Summarize**: conversational filler, clarifications that repeat prior context, acknowledgements — these MAY be omitted or condensed

#### Scenario: High-fidelity assertion

- GIVEN a user says "my API key is stored in `.env` as `STRIPE_KEY`, rotate it monthly"
- WHEN the Observer processes this
- THEN the observation MUST include `.env`, `STRIPE_KEY`, and the rotation cadence verbatim
- AND MUST NOT generalize to "user has an API key"

#### Scenario: Conversational filler omitted

- GIVEN a user says "yeah, that makes sense, thanks"
- WHEN the Observer processes this
- THEN the observation MUST omit this message entirely (no `🟡` generated for acknowledgements)

---

### Requirement: Observer Thread Title Generation

The Observer MUST emit a `<thread-title>` XML tag in its output containing a 2–5 word title that captures the essence of the current conversation. The title MUST update each observation cycle to reflect the most recent focus.

`parseObserverOutput` MUST extract the `<thread-title>` tag into a new `threadTitle?: string` field on `ObserverResult`.

The system MUST apply `threadTitle` to the session title when all of the following are true:

- The session title is still the default (matches `Session.isDefaultTitle`)
- `threadTitle` is present and non-empty
- The session has at least one completed assistant turn

#### Scenario: Observer emits thread title

- GIVEN a conversation about fixing a TypeScript error
- WHEN the Observer processes the turn
- THEN `<thread-title>` MUST be present in the output
- AND its content MUST be 2–5 words (e.g., "Fix TypeScript Error")

#### Scenario: Thread title applied to default session

- GIVEN a session with a default title (e.g., "New Session")
- AND Observer returns a `threadTitle`
- WHEN `processor.ts` handles the Observer result
- THEN `Session.setTitle` MUST be called with the `threadTitle`
- AND subsequent turns MUST see the updated title

#### Scenario: Thread title does not overwrite custom title

- GIVEN a session whose title was manually set by the user
- WHEN Observer returns a new `threadTitle`
- THEN `Session.setTitle` MUST NOT be called
- AND the custom title MUST remain unchanged

#### Scenario: Missing thread-title tag

- GIVEN the Observer LLM omits the `<thread-title>` tag
- WHEN `parseObserverOutput` runs
- THEN `threadTitle` MUST be `undefined`
- AND the session title MUST remain unchanged
