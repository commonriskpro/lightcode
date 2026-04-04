# Pi Monorepo — Context Pruning & Compaction Architecture

> Analysis of context window management in [pi-mono](https://github.com/nicobailon/pi-mono) by Mario Zechner (@badlogic).

---

## 1. Overview

Pi uses a **cut-point + LLM summarization** strategy for context management. Instead of silently dropping messages (sliding window), it summarizes older segments via an LLM call and replaces them with a structured summary. This preserves semantic context at the cost of one extra LLM call per compaction.

### Key Design Decisions

| Decision             | Approach                                   | Rationale                                                 |
| -------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Pruning strategy     | Cut-point + LLM summary                    | Preserves semantic context vs. silent message drops       |
| Token counting       | `chars/4` heuristic                        | No tiktoken dependency; conservative overestimate is safe |
| Session structure    | Tree (not linear array)                    | Enables branching, forking, branch summaries              |
| Iterative compaction | Updates previous summary                   | Prevents information loss through repeated compactions    |
| Extension hooks      | Before/after compaction + per-call context | Fully extensible for custom strategies                    |

---

## 2. Architecture Layers

Context management operates across three layers:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Session & Compaction (coding-agent)           │
│  ┌─────────────────────────────────────────────────┐    │
│  │  AgentSession                                    │    │
│  │  - Orchestration: when to compact                │    │
│  │  - Overflow recovery: detect → compact → retry   │    │
│  │  - Manual /compact command                       │    │
│  └─────────┬───────────────────────────────────┬────┘    │
│            │                                   │         │
│  ┌─────────▼──────────┐    ┌──────────────────▼──────┐  │
│  │  compaction.ts      │    │  session-manager.ts     │  │
│  │  - Cut point algo   │    │  - Tree persistence     │  │
│  │  - Summary gen      │    │  - Context rebuild      │  │
│  │  - Token estimation │    │  - CompactionEntry      │  │
│  └─────────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Layer 2: Agent Loop (agent-core)                       │
│  - transformContext hook (runs before every LLM call)   │
│  - convertToLlm (AgentMessage[] → Message[])            │
│  - Loop does NOT prune; delegates to hook               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Layer 1: Provider Overflow Detection (ai)              │
│  - 18 regex patterns for provider error messages        │
│  - Silent overflow detection (z.ai: usage > window)     │
│  - Anti-patterns exclude rate-limit false positives     │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Flow: From Detection to Action

```
User sends prompt
    │
    ▼
AgentSession.prompt()
    │
    ├──▶ Pre-prompt compaction check (_checkCompaction on last assistant msg)
    │
    ▼
Agent.prompt() → runLoop()
    │
    ▼
streamAssistantResponse()
    │
    ├──▶ config.transformContext()     ← Extension "context" event hook
    ├──▶ config.convertToLlm()        ← AgentMessage[] → Message[]
    ├──▶ LLM call via provider
    │
    ▼
Assistant message received
    │
    ▼
_processAgentEvent("agent_end")
    │
    ├──▶ _isRetryableError? → _handleRetryableError (exponential backoff)
    │
    └──▶ _checkCompaction(assistantMessage)
         │
         ├── Case 1: isContextOverflow() detected
         │   → Remove error message from state
         │   → _runAutoCompaction("overflow", willRetry=true)
         │   → agent.continue() after compaction (auto-retry)
         │
         └── Case 2: shouldCompact() threshold exceeded
             → _runAutoCompaction("threshold", willRetry=false)
             → User continues manually
```

### Dual Trigger System

| Trigger     | Cause                                           | Behavior After Compaction                    |
| ----------- | ----------------------------------------------- | -------------------------------------------- |
| `overflow`  | Provider returns context-too-long error         | Remove error msg → compact → auto-retry once |
| `threshold` | `contextTokens > contextWindow - reserveTokens` | Compact → user continues manually            |

---

## 4. Cut Point Algorithm

**File**: `packages/coding-agent/src/core/compaction/compaction.ts`, lines 386-448

Pi does NOT silently drop messages. It finds a semantic boundary ("cut point") and summarizes everything before it.

### Algorithm

1. **Walk backwards** from newest message, accumulating estimated token sizes
2. **Stop when accumulated >= `keepRecentTokens`** (default: 20,000 tokens)
3. **Find nearest valid cut point** at or after the budget boundary
4. **Valid cut points**: `user`, `assistant`, `custom`, `bashExecution`, `branchSummary`, `customMessage` — NEVER `toolResult` (must stay paired with its tool call)
5. **Handle split turns**: If cut lands mid-turn (between assistant messages within one user prompt), separately summarize the turn prefix

```typescript
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex)
  let accumulatedTokens = 0
  let cutIndex = cutPoints[0] // Default: keep from first message

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i]
    if (entry.type !== "message") continue
    const messageTokens = estimateTokens(entry.message)
    accumulatedTokens += messageTokens
    if (accumulatedTokens >= keepRecentTokens) {
      // Find closest valid cut point at or after this entry
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c]
          break
        }
      }
      break
    }
  }
  // ... scan backwards for non-message entries, detect split turns
}
```

### What Gets Preserved vs. Removed

| Preserved (kept in context)                             | Removed (summarized away)                               |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Messages after the cut point (~20K tokens)              | All messages before the cut point                       |
| Compaction summary (injected as user-role message)      | Previous compaction entries (replaced)                  |
| File operation tracking (read/modified files)           | Tool result content truncated to 2,000 chars in summary |
| Previous compaction summary text (for iterative update) |                                                         |

---

## 5. Summarization System

### Summary Generation

**File**: `packages/coding-agent/src/core/compaction/compaction.ts`, lines 530-588

Uses the **same active model** for summarization. Two modes:

#### Initial Compaction (first time)

Structured checkpoint format:

```
## Goal
## Constraints & Preferences
## Progress (Done / In Progress / Blocked)
## Key Decisions
## Next Steps
## Critical Context
```

#### Iterative Update (subsequent compactions)

When a previous summary exists, the LLM is instructed to UPDATE it:

```
UPDATE the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done"
```

This means **summaries accumulate** rather than starting fresh — no information loss through repeated compactions.

### Implementation Details

- Conversation serialized to text first (prevents LLM from treating it as a conversation to continue)
- System prompt: `"You are a context summarization assistant. Your task is to read a conversation... Do NOT continue the conversation."`
- Max summary tokens = `0.8 × reserveTokens` = ~13,107 tokens
- For reasoning models, `reasoning: "high"` is enabled
- Tool results truncated to 2,000 chars during serialization

### File Operation Tracking

Every compaction tracks file operations extracted from tool calls:

| Tool    | Tracked As        |
| ------- | ----------------- |
| `read`  | `fileOps.read`    |
| `write` | `fileOps.written` |
| `edit`  | `fileOps.edited`  |

These are appended to the summary as XML tags and carried forward across compaction boundaries:

```xml
<read-files>
path/to/file1
</read-files>

<modified-files>
path/to/file2
</modified-files>
```

### Split Turn Summarization

When a cut happens mid-turn (between assistant messages within one user prompt), a separate shorter summary captures:

- Original request
- Early progress
- Context for the retained suffix

Budget: `0.5 × reserveTokens` ≈ 8,192 tokens.

### Context Reconstruction After Compaction

**File**: `packages/coding-agent/src/core/session-manager.ts`, lines 310-417

```
[compaction summary]          ← user-role message wrapping the structured summary
[kept messages]               ← from firstKeptEntryId to compaction entry
[post-compaction messages]    ← anything appended after compaction
```

The summary is wrapped:

```typescript
const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n`
const COMPACTION_SUMMARY_SUFFIX = `\n</summary>`
```

---

## 6. Token Counting

### Estimation Heuristic

**File**: `packages/coding-agent/src/core/compaction/compaction.ts`, lines 229-290

Pi uses `chars / 4` — a conservative overestimate with no tokenizer dependency:

```typescript
export function estimateTokens(message: AgentMessage): number {
  let chars = 0
  switch (message.role) {
    case "user": // text content chars
    case "assistant": // text + thinking + tool call args
    case "toolResult": // text + images (estimated as 4800 chars = 1200 tokens each)
    case "bashExecution": // command + output
  }
  return Math.ceil(chars / 4)
}
```

### Hybrid Usage Tracking

**File**: `packages/coding-agent/src/core/compaction/compaction.ts`, lines 186-214

Uses a **hybrid** approach combining real usage data with heuristic estimation:

1. Find the **last non-aborted assistant message** with usage data
2. Use its `totalTokens` (or `input + output + cacheRead + cacheWrite`) as base
3. **Estimate trailing tokens** for messages after last usage via `chars/4`

```typescript
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
    const usageInfo = getLastAssistantUsageInfo(messages)
    if (!usageInfo) {
        return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null }
    }
    const usageTokens = calculateContextTokens(usageInfo.usage)
    let trailingTokens = 0
    for (let i = usageInfo.index + 1; i < messages.length; i++) {
        trailingTokens += estimateTokens(messages[i])
    }
    return { tokens: usageTokens + trailingTokens, ... }
}
```

After compaction, usage is reported as `null` (displayed as `?/200k` in the TUI footer) until the next LLM response provides fresh data.

---

## 7. Provider Overflow Detection

**File**: `packages/ai/src/utils/overflow.ts`

18 regex patterns for error-based detection:

```typescript
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic
  /request_too_large/i, // Anthropic 413
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI
  /input token count.*exceeds the maximum/i, // Google Gemini
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek, vLLM
  /context length is only \d+ tokens/i, // vLLM
  /input length.*exceeds.*context length/i, // vLLM
  /prompt too long.*exceeded.*context length/i, // Ollama
  /too large for model with \d+ max.*context/i, // Mistral
  /model_context_window_exceeded/i, // z.ai
  /context_length_exceeded/i, // Generic
  /request entity too large/i, // HTTP 413
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp
  /greater than the context length/i, // LM Studio
]
```

Silent overflow detection for z.ai: `usage.input > contextWindow` on successful responses.

Anti-patterns (excluded to prevent false positives):

```typescript
const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i, // AWS Bedrock throttling
  /rate limit/i,
  /too many requests/i,
]
```

---

## 8. Error Recovery

### Overflow Recovery

**File**: `packages/coding-agent/src/core/agent-session.ts`, lines 1739-1817

```
Overflow detected in _checkCompaction()
    │
    ├── Already attempted recovery?
    │   YES → Emit error: "Context overflow recovery failed..."
    │         Give up (user must reduce context or switch models)
    │
    └── NO:
        → Set _overflowRecoveryAttempted = true
        → Remove error message from agent state (keep in session history)
        → _runAutoCompaction("overflow", willRetry=true)
        → After compaction: setTimeout(100ms) → agent.continue() (auto-retry)
```

**Critical**: Overflow recovery is attempted **exactly once**. If compaction + retry still overflows, the system stops.

### Safety Guards

| Guard                       | Purpose                                                       |
| --------------------------- | ------------------------------------------------------------- |
| **Model switch protection** | Stale overflow from old model not misinterpreted after switch |
| **Stale compaction guard**  | Assistant messages from before compaction don't re-trigger    |
| **Single recovery attempt** | `_overflowRecoveryAttempted` flag prevents infinite loops     |

### Transient Error Retry

**File**: `packages/coding-agent/src/core/agent-session.ts`, lines 2381-2473

| Parameter           | Default | Description                    |
| ------------------- | ------- | ------------------------------ |
| `retry.enabled`     | `true`  | Master switch                  |
| `retry.maxRetries`  | `3`     | Max attempts                   |
| `retry.baseDelayMs` | `2000`  | Base backoff delay             |
| `retry.maxDelayMs`  | `60000` | Max server-requested delay cap |

Backoff formula: `baseDelayMs × 2^(attempt-1)` → 2s, 4s, 8s

Retryable errors: overloaded, rate limit, 429, 500-504, connection errors, timeouts.
Context overflow errors are **explicitly excluded** (handled by compaction).

---

## 9. Configuration

### Compaction Settings

```typescript
interface CompactionSettings {
  enabled: boolean // default: true
  reserveTokens: number // default: 16384
  keepRecentTokens: number // default: 20000
}
```

User-configurable via `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### Trigger Formula

```typescript
shouldCompact = contextTokens > contextWindow - reserveTokens
```

For Claude Sonnet (200K window): triggers at **183,616 tokens** (200000 - 16384).

### Summary Budget

| Phase               | Formula               | Default        |
| ------------------- | --------------------- | -------------- |
| Main summary        | `0.8 × reserveTokens` | ~13,107 tokens |
| Turn prefix summary | `0.5 × reserveTokens` | ~8,192 tokens  |

---

## 10. Key Files Reference

### Core Compaction Engine

| File                                                                | Purpose                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/coding-agent/src/core/compaction/compaction.ts`           | Cut point algorithm, token estimation, summary generation |
| `packages/coding-agent/src/core/compaction/utils.ts`                | File op tracking, message serialization, truncation       |
| `packages/coding-agent/src/core/compaction/branch-summarization.ts` | Branch navigation summaries                               |

### Orchestration

| File                                                          | Purpose                                   |
| ------------------------------------------------------------- | ----------------------------------------- |
| `packages/coding-agent/src/core/agent-session.ts` (1575-2005) | Manual/auto compaction, overflow recovery |
| `packages/coding-agent/src/core/agent-session.ts` (2373-2505) | Auto-retry with exponential backoff       |
| `packages/coding-agent/src/core/agent-session.ts` (2905-2949) | `getContextUsage()` for UI display        |

### Session Persistence

| File                                                          | Purpose                                            |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `packages/coding-agent/src/core/session-manager.ts` (66-75)   | `CompactionEntry` type                             |
| `packages/coding-agent/src/core/session-manager.ts` (310-417) | `buildSessionContext()` — reconstructs LLM context |

### Provider Layer

| File                                         | Purpose                                  |
| -------------------------------------------- | ---------------------------------------- |
| `packages/ai/src/utils/overflow.ts`          | 18 regex patterns for overflow detection |
| `packages/agent/src/agent-loop.ts` (238-271) | `transformContext` hook                  |

### Extension Hooks

| File                                                            | Hook                     | Purpose                                     |
| --------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `packages/coding-agent/src/core/extensions/types.ts` (467-480)  | `session_before_compact` | Cancel compaction or provide custom summary |
| `packages/coding-agent/src/core/extensions/types.ts` (467-480)  | `session_compact`        | Notified after compaction                   |
| `packages/coding-agent/src/core/extensions/types.ts` (533-536)  | `context`                | Transform messages before every LLM call    |
| `packages/coding-agent/src/core/extensions/runner.ts` (714-744) | `emitContext()`          | Per-LLM-call context transformation         |

### Tests

| File                                                                     | Coverage                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| `packages/coding-agent/test/compaction.test.ts`                          | Cut point, session context, token calculation    |
| `packages/coding-agent/test/agent-session-auto-compaction-queue.test.ts` | Auto-compaction triggering, message queue resume |
| `packages/ai/test/context-overflow.test.ts`                              | Provider-specific overflow detection             |
| `packages/ai/test/overflow.test.ts`                                      | Overflow pattern matching edge cases             |

---

## 11. Comparison with LightCode (OpenCode)

| Aspect                               | Pi                                      | LightCode                                     |
| ------------------------------------ | --------------------------------------- | --------------------------------------------- |
| **Strategy**                         | Cut-point + LLM summary                 | Cut-point + LLM summary (similar)             |
| **Token counting**                   | `chars/4` heuristic (no tokenizer)      | Provider-reported usage + estimation          |
| **Session structure**                | Tree (branching, forking)               | Linear (with fork via subagents)              |
| **Iterative compaction**             | Updates previous summary (accumulates)  | Fresh summary each time                       |
| **Split turn handling**              | Separate turn-prefix summary            | Removes empty assistant messages              |
| **File tracking across compactions** | Read/written/edited file lists in XML   | Not tracked across boundaries                 |
| **Overflow recovery**                | Exactly 1 retry                         | Up to MAX_COMPACTS (3) retries                |
| **Extension hooks**                  | Before/after compact + per-call context | Plugin system (transform hooks)               |
| **Error UI on overflow**             | Silent (no error flash)                 | Silent (fixed in this fork; upstream flashes) |
| **Compaction trigger**               | `contextTokens > window - reserve`      | Same formula                                  |
| **Branch summaries**                 | Yes (tree navigation)                   | No (linear sessions)                          |

### Notable Pi Patterns Worth Adopting

1. **Iterative summary updates** — Pi's approach of updating the previous summary instead of regenerating from scratch prevents information loss through repeated compactions. LightCode currently generates fresh summaries each time.

2. **File operation tracking across compactions** — Pi tracks which files were read/modified across the entire session history, carrying this forward through compaction boundaries. LightCode loses this context.

3. **Post-compaction usage uncertainty** — Pi correctly reports context usage as `null` after compaction until the next LLM call provides fresh data. This prevents stale numbers in the UI.

4. **Extension hooks on compaction** — Pi's `session_before_compact` allows extensions to cancel compaction or provide custom summaries. LightCode's plugin system doesn't have compaction-specific hooks.
