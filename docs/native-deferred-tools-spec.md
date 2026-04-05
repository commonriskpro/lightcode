# Technical Spec: Native Deferred Tools (Phase 2)

## Goal

Send `defer_loading: true` to providers that support it natively (Anthropic, OpenAI),
while keeping hybrid mode as fallback for all other providers. The mode is selected
automatically based on the model.

## Key Discovery

**No AI SDK changes needed.** Both `@ai-sdk/anthropic` and `@ai-sdk/openai` already:

1. Read `tool.providerOptions.{anthropic|openai}.deferLoading`
2. Emit `{ defer_loading: true }` on the wire format
3. Parse `tool_reference` (Anthropic) and `tool_search_call/output` (OpenAI) responses

We inject `deferLoading` via the existing `transformParams` middleware in `llm.ts`.

## Mode Selection

```
Model detected → supportsNativeDeferred(model)
                      │
            ┌─────────┼──────────┐
            │         │          │
         "anthropic" "openai"   false
            │         │          │
            ▼         ▼          ▼
        NATIVE MODE         HYBRID MODE
   (all tools sent,       (tools partitioned,
    defer_loading=true,    client-side tool_search,
    provider handles       prepareStep for dynamic
    search natively)       activeTools)
```

## Detection

```typescript
// src/provider/transform.ts
export function supportsNativeDeferred(model: Provider.Model): false | "anthropic" | "openai" {
  const npm = model.api.npm
  const id = model.api.id

  // Anthropic: sonnet-4+, opus-4+
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    if (["sonnet-4", "opus-4"].some((v) => id.includes(v))) return "anthropic"
  }

  // OpenAI: gpt-5+, o3+, o4+
  if (npm === "@ai-sdk/openai") {
    if (["gpt-5", "o3", "o4"].some((v) => id.includes(v))) return "openai"
  }

  return false
}
```

## Architecture Difference: Native vs Hybrid

| Aspect             | Hybrid (current)                | Native (new)                          |
| ------------------ | ------------------------------- | ------------------------------------- |
| Tools sent to LLM  | Only core tools                 | ALL tools (deferred ones marked)      |
| Deferred tools     | Removed from dict, indexed      | Stay in dict with `_shouldDefer` flag |
| Search mechanism   | Client-side `tool_search` tool  | Provider-side `defer_loading`         |
| Who handles search | Our code (ToolSearch.search)    | Provider API (built-in search)        |
| Response handling  | We parse tool_search output     | SDK adapters already parse natively   |
| Works with         | Any model with function calling | Only Anthropic 4+, OpenAI gpt-5+      |
| `tool_search` tool | Required (in tools dict)        | Not needed (removed)                  |

## Implementation

### File 1: `src/provider/transform.ts` — Add detection function

Add `supportsNativeDeferred()` function. Checks `model.api.npm` and `model.api.id`.

### File 2: `src/session/prompt.ts` — Two-path partitioning

In `resolveTools`, BEFORE the existing hybrid block:

```typescript
const native = ProviderTransform.supportsNativeDeferred(model)

if (deferEnabled && native) {
  // NATIVE MODE: keep all tools, mark deferred via _shouldDefer
  // Provider will handle defer_loading natively
  // Remove client-side tool_search — provider has its own
  delete tools["tool_search"]

  // Build index for system prompt (still useful as context)
  const index: ToolSearch.Entry[] = []
  for (const [key, t] of Object.entries(tools)) {
    if ((t as any)._shouldDefer === true || (t as any)._deferred === true) {
      index.push({
        id: key,
        hint: (t as any)._hint || (t.description ? t.description.slice(0, 80) : key),
        description: t.description || "",
      })
    }
  }

  return { tools, deferredIndex: index }
}

// HYBRID MODE: existing code (partition, client-side tool_search)
if (deferEnabled) {
  // ... existing hybrid block unchanged ...
}
```

### File 3: `src/session/llm.ts` — Middleware injection

Extend the existing `transformParams` middleware:

```typescript
async transformParams(args) {
  if (args.type === "stream") {
    args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
  }

  // Native deferred: inject providerOptions.{provider}.deferLoading
  const native = ProviderTransform.supportsNativeDeferred(input.model)
  if (native && args.params.tools) {
    for (const t of args.params.tools) {
      if (t.type !== "function") continue
      const src = input.tools[t.name]
      if (!src) continue
      if ((src as any)._shouldDefer || (src as any)._deferred) {
        t.providerOptions = {
          ...t.providerOptions,
          [native]: {
            ...(t.providerOptions as any)?.[native],
            deferLoading: true,
          },
        }
      }
    }
  }

  return args.params
}
```

### File 4: `src/session/llm.ts` — Pass model to StreamInput

The `stream()` function needs access to the model to call `supportsNativeDeferred()`.
Already available via `input.model`.

## Why Native Mode Doesn't Need tool_search

In native mode:

1. ALL tools are sent on the wire (with `defer_loading: true` on deferred ones)
2. The model sees tool names + descriptions but NOT full schemas for deferred tools
3. When the model needs a deferred tool, the **provider API** handles loading it
4. Anthropic: model emits `tool_reference` → SDK parses → tool becomes available
5. OpenAI: model emits `tool_search_call` → SDK parses → tools loaded

The model never needs to call our client-side `tool_search` — the provider does it transparently.

## Why We Still Keep tool_search in Hybrid

Hybrid mode is for models/providers that DON'T support `defer_loading`. There, we need
our client-side `tool_search` because the provider has no concept of deferred tools.

## Response Handling — Already Done

Both SDK adapters already handle native deferred responses:

**Anthropic** (`@ai-sdk/anthropic` v3.0.64, lines 3645-3686):

- `tool_search_tool_result` → parsed into `tool-result` content parts
- `tool_reference` blocks → mapped to tool references

**OpenAI** (`@ai-sdk/openai` v3.0.48, lines 5029-5057):

- `tool_search_call` → mapped to `tool-call`
- `tool_search_output` → mapped to `tool-result` with tools array

No additional code needed in LightCode.

## Files Modified

| File                        | Change                                           | Lines     |
| --------------------------- | ------------------------------------------------ | --------- |
| `src/provider/transform.ts` | `supportsNativeDeferred()` function              | 963-973   |
| `src/session/prompt.ts`     | Native-mode branch before hybrid (line 603)      | ~20 lines |
| `src/session/llm.ts`        | `transformParams` middleware injection (371-382) | ~15 lines |

## Implementation Status

✅ **IMPLEMENTED** — all three files changed.

### Exact `supportsNativeDeferred()` implementation (`transform.ts:963`)

```ts
export function supportsNativeDeferred(model: Provider.Model): false | "anthropic" | "openai" {
  const npm = model.api.npm
  const id = model.api.id
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    if (["sonnet-4", "opus-4"].some((v) => id.includes(v))) return "anthropic"
  }
  if (npm === "@ai-sdk/openai") {
    if (["gpt-5", "o3", "o4"].some((v) => id.includes(v))) return "openai"
  }
  return false
}
```

> **Note**: The Detection section above (spec phase) listed `@ai-sdk/google-vertex/anthropic` as a separate case — the implementation correctly includes it under the Anthropic branch.

## Risk Assessment

| Risk                                     | Mitigation                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Provider rejects defer_loading           | Detection function only enables for known-supported models              |
| Model ignores defer_loading              | Falls through normally — tools still callable, just not optimized       |
| SDK adapter doesn't parse response       | Already verified in source — both adapters handle it                    |
| Tool execution fails after native search | All tools stay in dict with execute functions — no dict mutation needed |
