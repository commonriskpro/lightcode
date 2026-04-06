# Delta Spec: high-context-prompt-cache → memory capability

## Modified Requirements

---

### MODIFIED: Canonical memory context composition exposes prompt block metadata

`Memory.buildContext()` MUST remain the canonical memory composition entry point, and it MUST expose prompt-block metadata needed for cache-aware runtime assembly.

#### Scenario: Memory context built for a high-context turn

- GIVEN a thread scope plus ancestor scopes
- WHEN `Memory.buildContext()` is called
- THEN it MUST return the composed memory context
- AND it MUST expose stable block metadata for each included memory layer
- AND each block MUST include identity sufficient to detect whether that layer changed between turns

#### Scenario: Working memory block emitted

- GIVEN working memory records exist for the active scope chain
- WHEN the context is built
- THEN the returned working-memory block MUST include token accounting
- AND it MUST include a deterministic hash for the formatted block
- AND it MUST be marked stable for prompt-cache purposes

#### Scenario: Semantic recall block emitted

- GIVEN semantic recall artifacts are returned for the active scopes
- WHEN the context is built
- THEN the semantic-recall block MUST include token accounting
- AND it MUST include a deterministic hash for the formatted block
- AND it MUST be marked reusable only when its content is unchanged

---

### NEW: Observations are split into stable and volatile prompt layers

The system MUST separate high-value stable observations from turn-volatile observation hints so that small changes do not invalidate the full observation payload.

#### Scenario: Stable observations available

- GIVEN an observation record exists with `reflections` or `observations`
- WHEN the system builds prompt blocks
- THEN the consolidated observation content MUST be emitted as a stable observations block
- AND that stable block MUST preserve observation-group retrieval instructions when needed

#### Scenario: Volatile observation hints available

- GIVEN an observation record contains short-lived continuation or task hints
- WHEN the system builds prompt blocks
- THEN those hints MUST be emitted separately from the stable observations block
- AND modifying those hints MUST NOT require regenerating the stable observations block

#### Scenario: No volatile hints present

- GIVEN the observation record has no continuation or volatile hints
- WHEN the system builds prompt blocks
- THEN the volatile observations block MAY be omitted
- AND the stable observations block MUST remain valid on its own

---

### NEW: Prompt assembly MUST be deterministic and cache-aware

The runtime prompt assembler MUST preserve a deterministic order of stable and volatile blocks so that high-context sessions maximize prefix reuse.

#### Scenario: Two equivalent follow-up turns

- GIVEN two turns in the same session with identical stable memory layers
- WHEN the system assembles the prompt for both turns
- THEN the stable prompt prefix MUST appear in the same order in both requests
- AND the stable block hashes MUST remain unchanged

#### Scenario: Volatile block changes only

- GIVEN only the volatile observation hint or live message tail changes between turns
- WHEN the second prompt is assembled
- THEN the stable prefix MUST remain unchanged
- AND only the volatile suffix MUST differ

#### Scenario: Optional blocks absent

- GIVEN a memory layer is absent for a turn
- WHEN the prompt is assembled
- THEN the assembler MUST omit that block deterministically
- AND MUST NOT reorder the remaining stable blocks

---

### NEW: Provider-aware prompt cache metadata for stable blocks

The system MUST attach provider-aware prompt cache metadata to stable prompt blocks when the provider supports prompt caching.

#### Scenario: Anthropic model used for a high-context turn

- GIVEN the selected model supports Anthropic prompt caching
- WHEN the request is assembled
- THEN stable prompt blocks MUST carry Anthropic cache metadata through provider options
- AND this metadata MUST apply to prompt content, not only tool definitions

#### Scenario: Provider without prompt-cache support

- GIVEN the selected provider does not support prompt caching
- WHEN the request is assembled
- THEN prompt assembly MUST still succeed
- AND unsupported cache metadata MUST NOT break the request

#### Scenario: Tool-only caching no longer the only prompt cache surface

- GIVEN stable working memory, observations, or recall are present
- WHEN the request is sent to a provider that supports prompt caching
- THEN those stable memory blocks MUST be eligible for provider-side prompt caching
- AND tool caching alone MUST NOT be the only explicit cache mechanism

---

### NEW: Same-topic semantic recall reuse

The system MUST reuse semantic recall across short same-topic follow-ups when the prior recall remains valid.

#### Scenario: Short same-topic follow-up

- GIVEN a session already loaded semantic recall for an active topic
- AND the next user turn is a short follow-up on the same topic
- WHEN the next prompt is assembled
- THEN the system SHOULD reuse the prior semantic recall block
- AND the semantic-recall hash SHOULD remain unchanged

#### Scenario: Topic shift

- GIVEN a session already loaded semantic recall for one topic
- AND the next user turn materially changes topic or domain
- WHEN the prompt is assembled
- THEN semantic recall MUST be recomputed for the new topic
- AND the new semantic-recall block MUST replace the old one

#### Scenario: Exact historical retrieval requested

- GIVEN a same-topic follow-up turn
- AND the user asks for exact historical details rather than general continuity
- WHEN the prompt is assembled
- THEN the system MUST be allowed to refresh semantic recall instead of blindly reusing it

---

### NEW: Prompt cache observability by layer

The runtime MUST expose enough diagnostics to understand cache-hit behavior for each high-context layer.

#### Scenario: Prompt request emitted

- GIVEN an LLM request is constructed
- WHEN the runtime emits diagnostics for that request
- THEN it MUST include per-layer token counts for the major prompt blocks
- AND it MUST include stable identities or hashes for those blocks

#### Scenario: Provider returns cache counters

- GIVEN the model provider returns cache read or cache write counters
- WHEN the request completes
- THEN the runtime MUST preserve those counters in request diagnostics
- AND they MUST be attributable to the request that produced them

#### Scenario: High-context workflow retained

- GIVEN a workflow that requires large memory budgets
- WHEN cache observability is enabled
- THEN the runtime MUST report the true token weight of each memory layer
- AND it MUST NOT require reducing budgets in order to improve visibility or cache behavior
