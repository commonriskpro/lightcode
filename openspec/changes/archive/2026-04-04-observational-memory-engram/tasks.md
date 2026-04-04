# Tasks: Observational Memory + Engram Integration

## Phase 1: Infrastructure

- [x] 1.1 Confirm the session recall hook in `packages/opencode/src/session/system.ts:11-61` and the prompt assembly site in `packages/opencode/src/session/prompt.ts:1679-1696`; keep names single-word and preserve BP1-BP4 cache boundaries.
- [x] 1.2 Define backward-compatible threading in `packages/opencode/src/dream/index.ts:60-122`: keep `run(focus?: string)` public and add internal `idle(sid: string)` for idle summaries flow.
- [x] 1.3 Add `recall?: string` to the input extension in `packages/opencode/src/session/llm.ts` by explicitly extending `LLM.StreamInput` so recall stays separate from `input.system`.

## Phase 2: recall() function

- [x] 2.1 Implement `SystemPrompt.recall(pid)` in `packages/opencode/src/session/system.ts:11-61` using `MCP.tools()`, `engram_mem_context`, `{ limit: 30, project: pid }`, and `<engram-recall>` wrapping.
- [x] 2.2 Cap recall output to ~2000 tokens with `Token.estimate`, return `undefined` on missing tool/failure, and keep output ready for a dedicated `recall` field.

## Phase 3: recall injection

- [x] 3.1 Update `packages/opencode/src/session/prompt.ts:1679-1696` to fetch recall with `step === 1`, cache it in the loop closure, and return it as `recall` (not in `system`). Derive `pid` from `Instance.project.id` at prompt loop scope — reuse same reference for both `handle.process` call sites (lines 1581 and 1698).
- [x] 3.2 Update `packages/opencode/src/session/llm.ts` to insert recall explicitly between base `system[0]` and volatile content via `system.splice(1, 0, input.recall)`.
- [x] 3.3 Thread the `recall` field into the `handle.process({...})` call in `packages/opencode/src/session/prompt.ts` (real injection site around lines 1581 and 1698).

## Phase 4: AutoDream threading

- [x] 4.1 Add internal `idle(sid)` in `packages/opencode/src/dream/index.ts:60-122` so idle-triggered flow reads `Session.messages()` for that sid and extracts `summary === true` assistant text parts.
- [x] 4.2 Add fallback extraction when summary msgs are empty: take last 10 user+assistant text msgs and cap to ~2000 tokens.
- [x] 4.3 Wire idle callback as `Bus.subscribe(Event.Idle, (event) => { void idle(event.properties.sessionID) })`.
- [x] 4.4 Thread extracted obs into `spawn(focus, obs)`, cap summaries at ~4000 tokens, and omit the extra prompt section when obs is empty.

## Phase 5: Dream prompt

- [x] 5.1 Extend `packages/opencode/src/dream/prompt.txt:1-45` with `## Session Observations` and the mem_search-before-save guidance.
- [x] 5.2 Document `topic_key` format as `project/{name}/session-insight/{topic}` and require `mem_update` for matching topics to avoid duplicates.

## Phase 6: Tests

- [x] 6.1 Add unit tests for `SystemPrompt.recall()` in `packages/opencode/src/session/system.ts`: Engram present, Engram absent, and failure fallback.
- [x] 6.2 Add unit tests for `Session.messages()` extraction in `packages/opencode/src/dream/index.ts`: summary-first path with 4000-token truncation plus fallback path (last 10 msgs, 2000-token cap).
- [x] 6.3 Add prompt tests for `packages/opencode/src/dream/prompt.txt` output: section present with observations, omitted when empty, and topic_key instructions included.

## Phase 7: Integration verification

- [x] 7.1 Run `bun test` from `packages/opencode` to verify recall, summary threading, and prompt construction together.
- [x] 7.2 Run `bun typecheck` from `packages/opencode` and confirm `run(focus?)` remains valid while `idle(sid)` handles idle threading, plus `recall(pid)` signatures compile cleanly.
