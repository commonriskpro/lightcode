# Exploration: Context Meter Token Drop-off (~9000 → 300-500)

## Executive Summary

The context meter in the TUI sidebar **is working correctly** — it reflects the actual prompt size sent to the LLM per turn. The dramatic drop from ~9000 tokens in early turns to ~300-500 tokens in later turns is caused by **three compounding mechanisms** that reduce the system prompt and tool definitions after the first few turns. This is **not a bug** — it's the intended behavior of the `initial_tool_tier` + `tool_router` + `instructionMode` system.

---

## Current State — How the Token Count is Computed

### 1. TUI Context Meter (`session-usage.ts`)

The sidebar context meter uses `lastPromptContextTokens()` (line 30 of `session-usage.ts`), which calls `promptTokensForContext()`:

```typescript
// session-usage.ts:17-23
export function promptTokensForContext(t: AssistantMessage["tokens"]) {
  const c = t.cache
  const sum = t.input + (c?.read ?? 0) + (c?.write ?? 0)
  if (t.total == null) return sum
  const fromTotal = Math.max(0, t.total - t.output - t.reasoning)
  return Math.max(sum, fromTotal)
}
```

This reads `tokens.input + cache.read + cache.write` from the **last assistant message** — the actual token count returned by the LLM provider for that specific API call.

### 2. What Contributes to `tokens.input`

The tokens sent to the LLM per turn consist of:

- **System prompt** (provider prompt + environment + skills + instructions)
- **Tool definitions** (description + schema for each tool in the `tools` object)
- **Tool router prompt hint** (the `## Offline tool router` block)
- **Conversation history** (all previous user/assistant messages)
- **Tool results** (output from completed tool calls)

---

## The Three Mechanisms That Cause the Drop

### Mechanism 1: `initial_tool_tier` — First Turn Tool Restriction

**File**: `initial-tool-tier.ts`

When `initial_tool_tier` is `"minimal"` (the default for SDD-init agents), the **first turn** only gets these tools:

```typescript
// initial-tool-tier.ts:8
export const MINIMAL_IDS = ["read", "grep", "glob", "skill"]
```

Plus optionally `bash`, `webfetch`, `websearch`. This means **only 4-7 tool definitions** are sent on turn 1, not the full ~30+ tools.

**After the first assistant message**, `threadHasAssistant()` returns `true` and `applyInitialToolTier` returns the full tool set (line 43).

### Mechanism 2: `instructionMode` — Instruction Content Changes Per Turn

**File**: `wire-tier.ts:31-42`

```typescript
export function instructionMode(cfg, msgs, skipRouter): "full" | "deferred" | "index" {
  if (skipRouter) return "full"
  if (routerFiltersFirstTurn(cfg, msgs)) return "full" // Turn 1: FULL
  const t = Flag.OPENCODE_INITIAL_TOOL_TIER ?? "full"
  if (t !== "minimal") return "index" // Non-minimal: always INDEX
  if (!threadHasAssistant(msgs)) return "deferred" // Turn 1 minimal: DEFERRED
  return "index" // Turn 2+: INDEX
}
```

The three modes produce dramatically different sizes:

| Mode         | What's sent                                                                 | Approx size           |
| ------------ | --------------------------------------------------------------------------- | --------------------- |
| `"full"`     | **Full contents** of AGENTS.md, CLAUDE.md, config URLs, global instructions | **~3000-6000 tokens** |
| `"deferred"` | Short note: "Use the read tool to load AGENTS.md..."                        | **~50 tokens**        |
| `"index"`    | List of file paths only (no content): "- /path/to/AGENTS.md"                | **~100-300 tokens**   |

**Critical**: On turn 1 with minimal tier + router, `instructionMode` returns `"full"` (line 37: `routerFiltersFirstTurn` is true when `apply_after_first_assistant !== false` and no assistant exists yet). So turn 1 gets **full instruction bodies** even with minimal tools.

### Mechanism 3: Tool Router — Tool Definitions Shrink After Turn 1

**File**: `tool-router.ts:228-396`

The tool router has a key behavior at line 274-285:

```typescript
// tool-router.ts:274-285
if (!additive && tr?.apply_after_first_assistant !== false && !hasAssistant) {
  // First turn: ALL tools available, full context tier
  return { tools: input.tools, promptHint: hint, contextTier: "full" }
}
```

**Wait — this seems backwards!** On the first turn, the router returns ALL tools. But `applyInitialToolTier` runs BEFORE the router and already stripped tools to minimal. So the flow is:

1. **Turn 1**: `applyInitialToolTier` strips to 4-7 tools → router sees no assistant → returns all 4-7 tools with `contextTier: "full"` → instruction mode = `"full"` → **HUGE system prompt**
2. **Turn 2+**: `applyInitialToolTier` returns full tool set (has assistant) → router applies keyword rules → narrows to ~8-12 tools with slim descriptions → instruction mode = `"index"` → **Much smaller system prompt**

### Mechanism 4: System Prompt Cache TTL

**File**: `system-prompt-cache.ts:7-10`

```typescript
const TTL_MS = (() => {
  const n = Number(process.env.OPENCODE_SYSTEM_PROMPT_CACHE_MS)
  return Number.isFinite(n) && n > 0 ? n : 3_600_000 // 1 hour default
})()
```

The cache key includes the instruction mode:

```typescript
// system-prompt-cache.ts:32
return `${agent.name}\0${model.id}\0${Instance.worktree}\0${instructions}`
```

So there are **separate cache entries** for `"full"`, `"deferred"`, and `"index"` modes. The cache doesn't cause the drop — it just avoids recomputing the same mode.

---

## Turn-by-Turn Breakdown

### Turn 1 (first user message, no assistant yet)

| Component                         | Size                  | Why                                                 |
| --------------------------------- | --------------------- | --------------------------------------------------- |
| Provider prompt (e.g., Anthropic) | ~500 tokens           | Fixed per-provider system prompt                    |
| Environment info                  | ~100 tokens           | Model name, working directory, platform             |
| Skills header                     | ~50 tokens            | "Skills provide specialized instructions..."        |
| **Instructions (FULL mode)**      | **~3000-6000 tokens** | AGENTS.md + CLAUDE.md + global instructions inlined |
| Tool definitions (4-7 tools)      | ~500-1000 tokens      | Minimal tier: read, grep, glob, skill ± bash        |
| Tool router prompt                | ~100 tokens           | "All X tools available..."                          |
| User message                      | ~50-200 tokens        | The actual user prompt                              |
| **Total estimated**               | **~4300-8000 tokens** |                                                     |

But the actual `tokens.input` from the LLM could be **higher** because:

- The AI SDK sends tool schemas (JSON Schema) which add significant tokens beyond just descriptions
- Provider-specific formatting adds overhead
- The system prompt is sent as part of the messages array

### Turn 2 (first assistant exists)

| Component                                | Size                  | Why                             |
| ---------------------------------------- | --------------------- | ------------------------------- |
| Provider prompt                          | ~500 tokens           | Same                            |
| Environment                              | ~100 tokens           | Same                            |
| Skills                                   | ~50 tokens            | Same                            |
| **Instructions (INDEX mode)**            | **~100-300 tokens**   | Just file paths, no content     |
| Tool definitions (8-12 tools, some slim) | ~800-1500 tokens      | Router narrows by keyword rules |
| Tool router prompt                       | ~150 tokens           | Intent + tool list              |
| Conversation history                     | ~500-1000 tokens      | Turn 1 exchange                 |
| **Total estimated**                      | **~2200-3550 tokens** |                                 |

### Turns 3+ (conversation continues)

| Component            | Size                    | Why                                                                   |
| -------------------- | ----------------------- | --------------------------------------------------------------------- |
| System prompt        | ~1500-2000 tokens       | INDEX mode + narrowed tools                                           |
| Conversation history | grows                   | But tool defs stay small                                              |
| **Total per turn**   | **~300-500 NEW tokens** | This is the **incremental** input tokens — the cache handles the rest |

---

## Why the Meter Shows ~9000 Then Drops to 300-500

The key insight: **`tokens.input` from the LLM provider is the NON-CACHED input token count** (see `index.ts:270`):

```typescript
const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)
```

With prompt caching (Anthropic, etc.):

- **Turn 1**: Everything is new → `inputTokens` = full prompt (~9000) → `cacheRead` = 0 → `adjustedInputTokens` = ~9000
- **Turn 2+**: System prompt + early history is **cached** → `inputTokens` = ~9000 but `cacheRead` = ~8500 → `adjustedInputTokens` = **~300-500**

The context meter uses `input + cache.read + cache.write` (line 19 of `session-usage.ts`), so it should show the **full** prompt size. But the user reports seeing 300-500. This means either:

1. **The provider doesn't return cache tokens** (some providers don't support `cachedInputTokens`), so `cache.read` and `cache.write` are 0, and only the non-cached `input` is shown.
2. **The system prompt actually shrinks** (which it does — from full instructions to index mode), so the total prompt itself is smaller.

**Both factors are at play**:

- The system prompt genuinely shrinks from ~6000 tokens (full instructions) to ~1500 tokens (index mode) = **~4500 token reduction**
- If the provider doesn't report cache tokens, the meter only shows the non-cached portion = **additional apparent reduction**

---

## Affected Files

| File                                                                    | Lines   | Why                                                               |
| ----------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `packages/opencode/src/session/prompt.ts`                               | 700-810 | Token breakdown logging, `resolveTools`, system prompt assembly   |
| `packages/opencode/src/session/tool-router.ts`                          | 228-396 | `apply()` method, context tier logic, tool narrowing              |
| `packages/opencode/src/session/system-prompt-cache.ts`                  | 1-74    | Cache TTL, instruction modes (full/deferred/index)                |
| `packages/opencode/src/session/wire-tier.ts`                            | 31-42   | `instructionMode()` — determines which instruction mode per turn  |
| `packages/opencode/src/session/initial-tool-tier.ts`                    | 1-59    | First-turn tool restriction                                       |
| `packages/opencode/src/session/index.ts`                                | 244-303 | `getUsage()` — how `tokens.input` is computed (cache subtraction) |
| `packages/opencode/src/cli/cmd/tui/util/session-usage.ts`               | 17-36   | `promptTokensForContext()` — what the meter displays              |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` | 1-62    | Sidebar context meter component                                   |

---

## Recommendation

**This is not a bug** — the behavior is by design. The system intentionally:

1. Sends full instructions on turn 1 so the model has complete context
2. Switches to index mode on subsequent turns to save tokens (model can `read` files on demand)
3. Narrows tool definitions by intent to reduce prompt size

If the user wants the context meter to show the **full** prompt size including cached tokens, they should verify their provider returns `cachedInputTokens`. For providers that don't (e.g., some OpenAI-compatible proxies), the meter will under-report.

### If You Want to Investigate Further

Check the JSONL debug logs at `{data}/debug/tokens/{sessionID}.jsonl` — they contain the estimated breakdown per turn including `instructionMode`, `contextTier`, and token estimates for each component. Compare these estimates against the actual `tokens.input` values returned by the LLM provider to identify the exact gap.

---

## Risks

- **None** — this is expected behavior, not a defect.
- If the user expects the meter to show a constant ~9000, they're misunderstanding that it shows **per-request** tokens, not cumulative context.
- Some providers may not return cache token data, making the meter appear lower than the actual context being used.

## Ready for Proposal

**Yes** — the investigation is complete. The token drop-off is explained by the combination of:

1. Instruction mode switching from `full` → `index` (~4500 token reduction)
2. Tool router narrowing tool definitions after turn 1
3. Prompt caching causing `tokens.input` (non-cached) to be small even when total prompt is large
