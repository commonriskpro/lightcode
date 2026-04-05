# Specification: Cache-Optimized Context Management

> **Status (2026-04-05):** REQ-1 through REQ-3 ✅ implemented. REQ-4 through REQ-10 (compaction requirements) are **obsolete** — the compaction system was deleted. See `docs/om-replace-compaction.md` for the replacement architecture.

## Requirements

### REQ-1: Breakpoint Placement by Volatility

The system MUST place Anthropic cache breakpoints in order of content stability, using all 4 available slots:

| Breakpoint | Target                                         | TTL  | Condition                                               |
| ---------- | ---------------------------------------------- | ---- | ------------------------------------------------------- |
| BP1        | Tool definitions                               | 1hr  | Only for Anthropic-compatible providers                 |
| BP2        | System message 1 (agent prompt)                | 1hr  | Only if agent prompt ≥ model's minimum cacheable tokens |
| BP3        | System message 2 (env + skills + instructions) | 5min | Only if content ≥ minimum cacheable tokens              |
| BP4        | Second-to-last conversation message            | 5min | Only if conversation has ≥ 3 messages                   |

For non-Anthropic providers (OpenAI, Google, OpenRouter): continue placing `cache_control` on system messages and conversation, but without TTL specifications (they use automatic caching).

### REQ-2: TTL Ordering Enforcement

The system MUST ensure 1-hour TTL breakpoints appear before 5-minute TTL breakpoints in the prefix order. Anthropic rejects requests where shorter TTLs precede longer ones.

Since prefix order is `tools → system → messages`, and BP1+BP2 (1hr) are on tools and system[0], while BP3+BP4 (5min) are on system[1] and messages, this is naturally satisfied. The implementation MUST NOT reorder them.

### REQ-3: System Prompt Stability

The system MUST NOT include data that changes between turns (date, model name) in system messages that are marked with cache breakpoints. Volatile data MUST be either:

- (a) Placed in a separate uncached system message after the cached ones, OR
- (b) Moved to the first user message as environmental context, OR
- (c) Placed in a position after BP3 but before BP4

The chosen approach MUST NOT change the model's visible behavior (the model must still receive all the same information).

### REQ-4: Cut-Point Compaction

When compacting a session, the system MUST:

1. Determine a cut point based on `keepRecentTokens` budget (default: 20,000 tokens)
2. Summarize only the messages BEFORE the cut point
3. Keep messages AFTER the cut point verbatim in the conversation
4. Insert the summary as a compaction message at the cut point position

The system MUST preserve the existing `filterCompacted()` contract: walking newest-to-oldest, stopping at the first completed compaction boundary.

### REQ-5: Cut-Point Token Budget

The cut-point algorithm MUST:

- Walk backward from the newest message, accumulating estimated token sizes
- Stop when accumulated tokens ≥ `keepRecentTokens`
- Find the nearest valid cut point at or after the budget boundary
- Valid cut points: user messages and assistant messages that are NOT preceded by an orphaned tool result
- If no valid cut point exists, fall back to full-replacement compaction

### REQ-6: Iterative Summary Updates

When compacting a session that already has a compaction summary, the system MUST:

1. Detect the previous compaction summary in the message history
2. Include it in the compaction prompt with instructions to UPDATE, not replace
3. Explicitly instruct the LLM to preserve all existing information
4. Add new progress, decisions, and context from the new messages

### REQ-7: Overflow Replay Compatibility

On overflow-triggered compaction, the system MUST still replay the last user message after compaction (existing behavior). The cut-point strategy MUST be compatible with the replay mechanism:

- If the cut point is before the triggering user message: that message is in the "kept" zone, no replay needed
- If the cut point is after the triggering user message: fall back to full-replacement with replay (current behavior)

### REQ-8: Pruning Compatibility

The existing pruning system (`prune()`) MUST continue to work with cut-point compaction:

- Pruning operates on tool output content, independent of compaction strategy
- Pruned tool outputs (`[Old tool result content cleared]`) MUST be preserved verbatim in the kept zone after cut-point compaction

### REQ-9: Plugin Hook Compatibility

The existing plugin hooks MUST continue to work:

- `"experimental.session.compacting"` — plugins can still replace/augment the compaction prompt
- `"experimental.chat.messages.transform"` — plugins can still transform messages before LLM calls
- `"experimental.chat.system.transform"` — plugins can still modify system messages (but this may invalidate BP2)

### REQ-10: No Configuration Changes

No new config keys are required. Existing keys are reused:

- `compaction.auto` — enables/disables auto-compaction (unchanged)
- `compaction.prune` — enables/disables pruning (unchanged)
- `compaction.reserved` — token buffer for compaction trigger (unchanged, reused for cut-point budget)

A new optional key MAY be added:

- `compaction.keep` — tokens of recent conversation to keep after compaction (default: 20,000)

---

## Scenarios

### S-1: Normal 10-Turn Session (Happy Path)

**Given** a session using Claude Sonnet 4 with 15 tools configured
**When** the user sends 10 messages with tool use in each turn
**Then**:

- Turn 1: Tools (BP1 write 1hr) + system[0] (BP2 write 1hr) + system[1] (BP3 write 5min) + first messages (uncached)
- Turn 2: BP1 read + BP2 read + BP3 read + conversation (BP4 write 5min on turn 1's assistant msg) + new user msg (uncached)
- Turn 3-10: BP1-3 reads + BP4 read (growing conversation prefix) + BP4 write (extends) + new user msg (uncached)
- Cache read tokens increase each turn; cache write is only the new conversation increment

### S-2: Agent Switch Mid-Session

**Given** a session where the user switches from `build` agent to `plan` agent at turn 5
**When** the agent switch changes the agent prompt (system[0])
**Then**:

- BP1 (tools) remains cached — tools don't change on agent switch
- BP2 (agent prompt) is a cache MISS — new prompt, new write
- BP3 (env + instructions) is a cache MISS — prefix changed before this breakpoint
- BP4 (conversation) is a cache MISS — prefix changed before this breakpoint
- On turn 6 (still `plan`): all 4 breakpoints hit again

### S-3: Tool Added via MCP Reconnect

**Given** a session where an MCP server reconnects and adds a new tool at turn 7
**When** the tool list changes
**Then**:

- BP1 (tools) is a cache MISS — tool definitions changed, new write
- BP2-4 all MISS — tool prefix changed, everything after is invalidated
- On turn 8: all 4 breakpoints hit again

### S-4: Compaction Triggered by Threshold

**Given** a session with 180K tokens used (Sonnet 4, 200K context, 20K reserve)
**When** `shouldCompact()` returns true after turn 15
**Then**:

- Cut-point algorithm finds a boundary keeping ~20K recent tokens
- Messages before the cut point are summarized
- Summary inserted as compaction message
- Messages after the cut point STAY in context (their cache entries survive)
- BP4 on the kept conversation still hits on the next turn
- Only the summary (new text) causes a cache write

### S-5: Compaction Triggered by Overflow Error

**Given** a session where the provider returns "prompt too long"
**When** `halt()` detects `ContextOverflowError`
**Then**:

- Error message is NOT published to UI (existing fix)
- Cut-point compaction runs with `overflow: true`
- If the triggering user message is in the "kept" zone: no replay needed, the message is preserved
- If the triggering user message is in the "summarized" zone: fall back to full-replacement + replay (current behavior)
- After compaction, the loop retries automatically

### S-6: Second Compaction (Iterative Update)

**Given** a session that was already compacted once (compaction summary exists at position 5)
**When** context grows again and a second compaction triggers at turn 25
**Then**:

- The previous compaction summary is detected
- Cut-point algorithm operates on messages AFTER the previous compaction boundary
- New summary prompt includes the previous summary with "UPDATE this summary" instructions
- Previous information is preserved; new progress is added
- Net result: one compaction summary (updated) + ~20K recent tokens

### S-7: Date Change During Session

**Given** a session started at 11:55 PM, continuing past midnight
**When** the date changes
**Then**:

- If date is in an uncached injection point: no cache impact. BP1-3 all still hit.
- If date is still in system[1] (not yet migrated): BP3 misses, BP4 misses. BP1-2 still hit (1hr TTL).

### S-8: Session Below Minimum Cacheable Tokens

**Given** a very short conversation (< 1,024 tokens total)
**When** breakpoints are placed
**Then**:

- Caching silently does nothing (Anthropic ignores sub-threshold breakpoints)
- No errors, no behavior change
- Cost is identical to uncached operation

### S-9: Non-Anthropic Provider (OpenAI)

**Given** a session using GPT-5.4
**When** cache breakpoints are placed
**Then**:

- TTL-specific options are NOT set (OpenAI uses automatic caching)
- `prompt_cache_key = sessionID` continues to be set (existing behavior)
- Tool sorting continues to ensure prefix stability
- System prompt split into 2 parts continues to work
- OpenAI's automatic cache benefits from the stable prefix structure

### S-10: Compaction When No Valid Cut Point

**Given** a very short conversation (3 messages) that somehow triggers compaction
**When** the cut-point algorithm can't find a boundary with ≥ 2 messages in the "kept" zone
**Then**:

- Falls back to full-replacement compaction (current behavior)
- Replay of last user message works as before

---

## Acceptance Criteria

### AC-1: Cache Hit Rates

On a 10-turn Anthropic session with stable tools:

- Turns 2-10: `cache_read_input_tokens` > 0 for tool definitions + agent prompt
- Turn 3+: `cache_read_input_tokens` > 0 for conversation prefix
- `cache_creation_input_tokens` should be < 15% of total input after turn 3

### AC-2: Cost Reduction

On a 10-turn session with Sonnet 4, ~8K tokens per turn:

- Total input cost MUST be < 40% of the non-optimized baseline
- Measured via `usage.cache_read_input_tokens` / total input tokens ratio > 60% after turn 3

### AC-3: Post-Compaction Cache Survival

After cut-point compaction:

- `cache_read_input_tokens` on the first post-compaction turn MUST include tokens from the "kept" conversation zone
- Only the compaction summary should appear as `cache_creation_input_tokens`

### AC-4: No Behavioral Regression

- All existing tests pass without modification
- Model responses are identical (caching does not affect output)
- Existing compaction tests continue to pass
- Existing overflow recovery tests continue to pass
- Plugin hooks fire with the same arguments

### AC-5: TTL Ordering

- No Anthropic API 400 errors from TTL ordering violations
- 1-hour breakpoints always precede 5-minute breakpoints in the assembled message array
