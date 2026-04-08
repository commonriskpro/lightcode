# Delta for obs-chunk-splitting

## ADDED Requirements

### Requirement: split-stable-obs-non-anthropic

For non-Anthropic providers, the `observationsStable` payload MUST be split into individual system messages at `<observation-group>` tag boundaries instead of being injected as a single monolithic system message.

Each `<observation-group>...</observation-group>` element SHALL become its own `{ role: "system", content: chunk }` entry in the message array, preserving the original XML tags and inner content verbatim.

If `observationsStable` contains zero `<observation-group>` tags, the system MUST fall back to a single system message containing the full `observationsStable` string — behaviour identical to today.

#### Scenario: multi-chunk split on non-Anthropic path

- GIVEN a session with `observationsStable` containing two `<observation-group>` blocks separated by whitespace
- WHEN `LLM.stream()` assembles the non-Anthropic `blocks` array
- THEN the assembled `blocks` array contains two consecutive `{ role: "system" }` entries, one per group, in original document order

#### Scenario: zero-boundary fallback

- GIVEN a session with `observationsStable` that contains no `<observation-group>` tags
- WHEN `LLM.stream()` assembles the non-Anthropic `blocks` array
- THEN the assembled `blocks` array contains exactly one `{ role: "system" }` entry for `observationsStable`, identical to the pre-change behaviour

#### Scenario: Anthropic path unchanged

- GIVEN an Anthropic-compatible provider (`anthropic === true`)
- WHEN `LLM.stream()` assembles the `blocks` array
- THEN the `blocks` array is identical to its pre-change form — no splitting occurs, breakpoint budget is not affected

---

### Requirement: prompt-profile-per-chunk-layers

`PromptProfile.set()` MUST record one layer entry per observation chunk, keyed `observations_stable_0`, `observations_stable_1`, … `observations_stable_N-1`, each with an independent token count and SHA-1 hash of that chunk's text.

The single `observations_stable` layer key MUST NOT appear in the non-Anthropic path when chunking is active. It MAY be retained as an alias for the Anthropic path or omitted — existing Anthropic layer tracking MUST NOT change.

#### Scenario: N chunks produce N profile layers

- GIVEN `observationsStable` is split into 3 chunks
- WHEN `PromptProfile.set()` is called at the end of request assembly
- THEN `entry.layers` contains exactly three entries with keys `observations_stable_0`, `observations_stable_1`, `observations_stable_2`
- AND each entry's `tokens` equals the estimated token count of its respective chunk
- AND each entry's `hash` equals the SHA-1 of its respective chunk text

#### Scenario: single fallback produces one layer

- GIVEN `observationsStable` has no `<observation-group>` tags (single-block fallback)
- WHEN `PromptProfile.set()` is called
- THEN `entry.layers` contains exactly one entry keyed `observations_stable_0`

---

### Requirement: bp2-stability-covers-all-chunks

The bp2 breakpoint stability signal in `PromptProfile` MUST reflect whether **any** `observations_stable_*` chunk changed between turns, not just a single key.

`bpStat` MUST match all keys whose name starts with `observations_stable` when computing bp2 status, regardless of how many chunks are present.

#### Scenario: unchanged chunks yield stable bp2

- GIVEN a prior turn with three `observations_stable_*` hashes recorded
- WHEN the next turn produces the same three chunks with identical text
- THEN `bpStatus.bp2` is `"stable"`

#### Scenario: new chunk appended yields broke bp2

- GIVEN a prior turn with two `observations_stable_*` hashes recorded
- WHEN the next turn produces three chunks (one new)
- THEN `bpStatus.bp2` is `"broke"` because a previously present key changed or a new key appeared

#### Scenario: first turn yields new bp2

- GIVEN no prior turn exists for the session
- WHEN the first turn produces any number of `observations_stable_*` layers
- THEN `bpStatus.bp2` is `"new"`

---

### Requirement: split-helper-pure-function

A pure helper function `splitObsChunks(text: string): string[]` MUST be added to `session/system.ts`.

- It MUST return an array containing the full text of each `<observation-group>...</observation-group>` element found in `text`, including the tags themselves.
- When no groups are found it MUST return `[text]`.
- It MUST NOT mutate `text` or produce side effects.
- It MUST handle an empty string input by returning `[""]` or `[]` — consistent with the zero-boundary fallback in `LLM.stream()`.

#### Scenario: splits correctly at group boundaries

- GIVEN a string containing two complete `<observation-group>` elements with arbitrary whitespace between them
- WHEN `splitObsChunks(text)` is called
- THEN it returns an array of length 2 where each element is one complete `<observation-group>...</observation-group>` tag with its inner content

#### Scenario: passthrough for plain text

- GIVEN a string with no `<observation-group>` tags
- WHEN `splitObsChunks(text)` is called
- THEN it returns `[text]`
