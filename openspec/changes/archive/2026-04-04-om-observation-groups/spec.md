# Specification: om-observation-groups

## Purpose

Implement observation groups with XML wrappers to preserve provenance and enable source message retrieval via a new `recall` tool.

## Requirements

### Group utilities (om/groups.ts)

**REQ-1.1**: A pure function `wrapInObservationGroup(obs: string, range: string, id?: string): string` MUST wrap observations in `<observation-group id="..." range="startId:endId">...</observation-group>`. If no `id` provided, generate a short unique ID (ulid or similar).

**REQ-1.2**: A pure function `parseObservationGroups(text: string): ObservationGroup[]` MUST extract all groups from a string. For flat strings with no group markers, it MUST return `[]` (backward compatibility).

**REQ-1.3**: A pure function `stripObservationGroups(text: string): string` MUST remove all `<observation-group>` wrappers, leaving only the inner content concatenated.

**REQ-1.4**: A pure function `renderObservationGroupsForReflection(text: string): string` MUST convert groups to a format the Reflector LLM can process (markdown `## Group id` headers, preserving content).

**REQ-1.5**: A pure function `reconcileObservationGroupsFromReflection(reflected: string, source: string): string` MUST re-apply group wrappers from `source` to `reflected` output using a line-overlap heuristic. If no groups found in source, return `reflected` unchanged. If reconciliation fails to assign any groups, MUST wrap entire reflected output in a single group spanning the full source range.

**REQ-1.6**: The `ObservationGroup` type MUST be exported with fields: `id: string`, `range: string`, `content: string`.

#### Scenario: Wrap observations

- GIVEN a string of observations
- WHEN `wrapInObservationGroup` is called with a range
- THEN the output contains `<observation-group id="..." range="...">` wrapping the content

#### Scenario: Parse groups

- GIVEN a wrapped observations string
- WHEN `parseObservationGroups` is called
- THEN it returns an array with one entry per group

#### Scenario: Parse flat observations

- GIVEN a flat observations string with no group markers
- WHEN `parseObservationGroups` is called
- THEN it returns `[]`

#### Scenario: Strip groups

- GIVEN a wrapped string
- WHEN `stripObservationGroups` is called
- THEN only the inner content remains

#### Scenario: Reconcile reflections

- GIVEN the Reflector compressed observations that restructured lines
- WHEN `reconcileObservationGroupsFromReflection` is called
- THEN the output has group wrappers re-applied using line overlap

### Observer integration

**REQ-2.1**: After `parseObserverOutput()` succeeds, `Observer.run()` MUST wrap `result.observations` in `wrapInObservationGroup(obs, range)` where `range = "firstMsgId:lastMsgId"` derived from the input messages.

**REQ-2.2**: The message range MUST use the actual `MessageID` of the first and last messages passed to the Observer, not timestamps.

**REQ-2.3**: Before calling `truncateObsToBudget`, `Observer.run()` MUST call `stripObservationGroups()` on the `prev` observations so truncation operates on clean text.

**REQ-2.4**: `OM.activate()` MUST wrap the merged output from `Observer.condense()` in a group spanning the full buffer range (first message of first buffer → last message of last buffer). The buffer records MUST carry `first_msg_id` and `last_msg_id` fields to enable this.

#### Scenario: Wrap new observer output

- GIVEN Observer.run() completes successfully
- WHEN the output is written
- THEN it is wrapped in `<observation-group range="firstId:lastId">`

#### Scenario: Truncate clean text

- GIVEN `prev` observations contain group wrappers
- WHEN building the Observer system prompt
- THEN groups are stripped before `truncateObsToBudget`

### Reflector integration

**REQ-3.1**: Before building the Reflector prompt, `Reflector.run()` MUST call `renderObservationGroupsForReflection()` on the raw observations string to present groups to the LLM with structure.

**REQ-3.2**: After the Reflector LLM returns output, `Reflector.run()` MUST call `reconcileObservationGroupsFromReflection(reflected, source)` to re-apply group lineage.

**REQ-3.3**: The reconciled output (with group wrappers restored) MUST be what is persisted to `ObservationTable.reflections`.

#### Scenario: Render groups for Reflector

- GIVEN observations contain multiple groups
- WHEN Reflector.run() starts
- THEN the LLM receives rendered group headers

#### Scenario: Restore group lineage

- GIVEN Reflector LLM returns compressed output
- WHEN the result is parsed
- THEN group wrappers from the source are reconciled back onto the output

### Recall tool

**REQ-4.1**: A tool named `recall` MUST be implemented at `packages/opencode/src/tool/recall.ts` and registered in `packages/opencode/src/tool/registry.ts`.

**REQ-4.2**: The tool MUST accept input `{ range: string }` where `range` is a `"startId:endId"` string from an observation group.

**REQ-4.3**: The tool MUST query the message store for messages with IDs between `startId` and `endId` (inclusive), scoped to the current session.

**REQ-4.4**: The tool MUST return a formatted list of messages (role + text content), truncated to a reasonable token limit (default 4000 tokens, `char >> 2`).

**REQ-4.5**: If no messages are found for the range, the tool MUST return a clear "no messages found" message rather than an error.

**REQ-4.6**: The tool MUST only be available when the OM system is active (i.e., observations exist for the session).

#### Scenario: Recall valid range

- GIVEN an observation group with range "msg-001:msg-050"
- WHEN the agent calls recall with that range
- THEN messages between those IDs are returned

#### Scenario: Recall empty range

- GIVEN a range with no matching messages
- WHEN recall is called
- THEN a "no messages found" message is returned (no error thrown)

### System prompt integration

**REQ-5.1**: When observations exist and contain at least one observation group, `SystemPrompt.observations()` MUST append `OBSERVATION_RETRIEVAL_INSTRUCTIONS` after the observations block, explaining to the agent how to use the `recall` tool.

**REQ-5.2**: `OBSERVATION_RETRIEVAL_INSTRUCTIONS` MUST explain: what observation groups are, when to use recall (user asks for exact content, source needed), and how to extract the range from `<observation-group range="...">` tags.

### Backward compatibility

**REQ-6.1**: Sessions with flat (non-grouped) observations MUST continue to work. `parseObservationGroups` returning `[]` MUST be handled gracefully everywhere it's called.

**REQ-6.2**: The `recall` tool called with a range from a legacy session MUST return a graceful "no source range available" message.

#### Scenario: Recall legacy session

- GIVEN a flat observations string (legacy session)
- WHEN the agent calls recall
- THEN a graceful "no source range" message is returned
