# Technical Spec: Cost Tracker

## 1. Overview

Track and display token usage and estimated cost per session and per model. Display in the TUI footer, updated reactively as the conversation progresses.

## 2. Codebase Analysis — Current State

### 2.1 Cost Computation Pipeline Already Exists

The entire cost computation pipeline is already built end-to-end:

**`src/session/index.ts` lines 245-307 — `Session.getUsage()`**

Core calculation function. Takes `Provider.Model`, `LanguageModelV2Usage`, optional `ProviderMetadata`, returns:

```ts
{ cost: number, tokens: { total, input, output, reasoning, cache: { read, write } } }
```

Uses `Decimal.js` for precision. Handles pricing tiers (over 200K), reasoning tokens billed at output rate, cache token separation.

**`src/session/processor.ts` lines 267-286 — `finish-step` event handler**

Where `Session.getUsage()` is called during LLM streaming:

```ts
case "finish-step": {
  const usage = Session.getUsage({ model: ctx.model, usage: value.usage, metadata: value.providerMetadata })
  ctx.assistantMessage.cost += usage.cost     // accumulated across steps
  ctx.assistantMessage.tokens = usage.tokens  // overwritten per step
}
```

**`src/session/message-v2.ts` lines 403-450 — Assistant message schema**

Each assistant message stores:

```ts
cost: z.number(),
tokens: z.object({
  total: z.number().optional(),
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({ read: z.number(), write: z.number() }),
}),
```

### 2.2 Pricing Data Available

**`src/provider/models.ts` lines 25-77 — `ModelsDev.Model`**

```ts
cost: z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  context_over_200k: z.object({ ... }).optional(),
}).optional(),
```

Pricing available for all models via `models.dev`. Prices in USD per million tokens.

### 2.3 Cost Displayed in Multiple Locations (already implemented)

Cost and token tracking is implemented in **three locations**:

**`src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`**

Shows tokens of last message + context percentage of model limit + total session cost:

```ts
const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))
// renders: "45,200 tokens" + "$0.42 spent"
```

**`src/cli/cmd/tui/routes/session/subagent-footer.tsx`**

Shows cost per subagent task in the subagent footer bar.

**`src/cli/cmd/tui/component/prompt/index.tsx`**

Shows `{context} · {cost}` in the prompt input area footer (e.g. `"45.2K tokens · $0.42"`).

### 2.4 What IS Missing — Main Session Footer

**`src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`**

The sidebar footer shows: path, git branch, observer/reflector spinners, version. **No token count or cost.** This is the one location where the cost-tracker-arch.md spec calls for adding it — and it has NOT been implemented yet.

> The spec (Section 5) targets `src/cli/cmd/tui/routes/session/footer.tsx`. The actual file is `src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx` — same concept, different path.

### 2.5 Sync Store

**`src/cli/cmd/tui/context/sync.tsx` lines 36-106**

Already receives `message.updated` events with cost/tokens on assistant messages in real-time.

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│              LLM Stream (llm.ts)                     │
│  streamText() → fullStream → finish-step events      │
└────────────────────┬────────────────────────────────┘
                     │ usage + providerMetadata
                     ▼
┌─────────────────────────────────────────────────────┐
│          SessionProcessor (processor.ts)              │
│  finish-step handler:                                │
│    Session.getUsage(model, usage, metadata)           │
│    → msg.cost += cost                                │
│    → msg.tokens = tokens                             │
│    → session.updateMessage(msg)  ─────────┐          │
└───────────────────────────────────────────┼─────────┘
                                            │ SyncEvent
                                            ▼
┌─────────────────────────────────────────────────────┐
│          Sync Store (context/sync.tsx)                │
│  message.updated → store.message[sessionID][i]       │
│  Each assistant message has: { cost, tokens }        │
└────────────────────┬────────────────────────────────┘
                     │ reactive
                     ▼
┌─────────────────────────────────────────────────────┐
│               Footer (footer.tsx)                     │
│  createMemo → sum(msg.cost) from messages            │
│  Display: "$0.42 · 12.5K tokens"                     │
└─────────────────────────────────────────────────────┘
```

## 4. Data Model

### What to Track

| Field                | Type                                  | Source                             |
| -------------------- | ------------------------------------- | ---------------------------------- |
| Session total cost   | `number`                              | Sum of assistant message `.cost`   |
| Session total tokens | `{ input, output, reasoning, cache }` | Sum of assistant message `.tokens` |
| Per-model breakdown  | `Map<modelID, { cost, tokens }>`      | Future: group by `msg.modelID`     |

### Where to Store — In-Memory Computation

**Do NOT add DB columns.** Cost lives on messages, session-level cost is derived.

Rationale:

1. No redundancy or sync bugs
2. Subagent footer already proves the pattern
3. No migration required
4. Always consistent
5. Cheap to compute

## 5. Implementation — Single File Change

### File: `src/cli/cmd/tui/routes/session/footer.tsx`

```tsx
// New imports
import { useRoute } from "../../context/route"

// Inside Footer():
const route = useRoute()

const messages = createMemo(() => {
  if (route.data.type !== "session") return []
  return sync.data.message[route.data.sessionID] ?? []
})

const usage = createMemo(() => {
  const msgs = messages()
  if (!msgs.length) return undefined

  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0

  for (const msg of msgs) {
    if (msg.role !== "assistant") continue
    cost += msg.cost
    input += msg.tokens.input
    output += msg.tokens.output
    reasoning += msg.tokens.reasoning
    cacheRead += msg.tokens.cache.read
    cacheWrite += msg.tokens.cache.write
  }

  const total = input + output + reasoning + cacheRead + cacheWrite
  if (total <= 0) return undefined
  return { cost, total }
})

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})
```

In JSX, after existing `/status` text:

```tsx
<Show when={usage()}>
  {(item) => (
    <text fg={theme.textMuted}>
      {formatTokens(item().total)} tokens
      {item().cost > 0 ? ` · ${money.format(item().cost)}` : ""}
    </text>
  )}
</Show>
```

## 6. TUI Mockup

### Current Footer

```
~/projects/myapp                    • 2 LSP  ⊙ 3 MCP  /status
```

### New Footer (with cost)

```
~/projects/myapp         45.2K tokens · $0.42  • 2 LSP  ⊙ 3 MCP  /status
```

### During Streaming

```
~/projects/myapp         12.1K tokens · $0.08  • 2 LSP  ⊙ 3 MCP  /status
```

### Free Models (cost = 0)

```
~/projects/myapp                  8.3K tokens  • 1 LSP  ⊙ 1 MCP  /status
```

### No Session Active

```
~/projects/myapp                                • 2 LSP  ⊙ 3 MCP  /status
```

## 7. Files to Modify

| File                                        | Change                                 | Scope         |
| ------------------------------------------- | -------------------------------------- | ------------- |
| `src/cli/cmd/tui/routes/session/footer.tsx` | Add cost/token aggregation and display | **Only file** |

No DB migration. No schema changes. No new sync events. Single file change.

## 8. Edge Cases

| Edge Case                   | Handling                                                  |
| --------------------------- | --------------------------------------------------------- |
| Free models (cost=0)        | Show tokens only, hide cost portion                       |
| No messages                 | `usage()` returns `undefined`, nothing shown              |
| Compacted sessions          | Historical assistant messages with cost preserved         |
| Subagent sessions           | Already handled by `subagent-footer.tsx`                  |
| Models without pricing      | `cost.input/output` default to 0                          |
| NaN/Infinity                | `Session.getUsage()` already guards with `safe()`         |
| Model switching mid-session | Each message has its own model; costs aggregate correctly |
| Streaming in progress       | Updates after each `finish-step` — partial cost visible   |

## 9. Testing

### Unit Test

```ts
test("session cost aggregation", () => {
  const messages = [
    { role: "user" },
    {
      role: "assistant",
      cost: 0.05,
      tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 200, write: 100 } },
    },
    { role: "user" },
    {
      role: "assistant",
      cost: 0.12,
      tokens: { input: 2000, output: 800, reasoning: 300, cache: { read: 500, write: 0 } },
    },
  ]
  // Expected: cost = 0.17, total tokens = 5400
})
```

### Manual TUI Verification

1. Send a prompt → verify footer shows tokens and cost
2. Multiple turns → verify cost accumulates
3. Free model → verify tokens shown, no cost
4. New session → verify reset
5. During streaming → verify live updates

## 10. Summary

**Implementation effort: ~30 minutes.** The entire data pipeline exists. We just display it.

## 11. Implementation Status

| Location                                                            | Status                     | Notes                                  |
| ------------------------------------------------------------------- | -------------------------- | -------------------------------------- |
| `session/processor.ts` — `Session.getUsage()` called at finish-step | ✅ Implemented             | Cost+tokens on every assistant message |
| `sidebar/context.tsx` — tokens + cost in sidebar panel              | ✅ Implemented             | Shows last-message tokens + total cost |
| `subagent-footer.tsx` — cost per subagent                           | ✅ Implemented             |                                        |
| `prompt/index.tsx` — cost in prompt area                            | ✅ Implemented             |                                        |
| `sidebar/footer.tsx` — tokens + cost in main footer bar             | ❌ **NOT YET IMPLEMENTED** | The spec's Section 5 target — pending  |

The remaining gap is adding a `{N}K tokens · $X.XX` display to `sidebar/footer.tsx`, reusing the same aggregation pattern already used in `sidebar/context.tsx`.
