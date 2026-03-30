# Spec: Offline tool router (prompt → tool subset)

## 1. Purpose

Define a **deterministic, offline-capable** layer that selects **which tools** (and optionally **which description tier**) to attach to each LLM request, so that **context size stays low across all turns**, not only on the first request.

Today, `initial_tool_tier: minimal` applies only while the thread has **no** assistant message; afterward the full tool set is sent, which dominates payload size (see `debug-request` logs: `toolsBytes` ≫ `promptBytes` on turn 2+).

This spec describes **what** to build and **how** it fits OpenCode; it does not mandate a single implementation algorithm.

---

## 2. Goals

| ID | Goal |
|----|------|
| G1 | Reduce **input tokens** on every model call by sending **only** tools that are plausibly needed for the current user intent. |
| G2 | Run **without** calling the same large model used for chat (fully offline, or optional small/local model). |
| G3 | Preserve **correctness**: if the selected set is insufficient, the system **recovers** (expand tools and retry, or escalate safely). |
| G4 | Be **inspectable**: log or surface which tools were selected and why (for debugging and tuning). |
| G5 | Integrate with existing agents (e.g. `sdd-orchestrator`) and permissions (`permission`, disabled tools, MCP). |

## 3. Non-goals

- Replacing the main LLM for reasoning; the router only **filters** tools.
- Proving a globally minimal tool set (NP-hard in the general case); we target **good enough** with fallbacks.
- Changing provider APIs or wire format (still `LanguageModelV3CallOptions` → HTTP as today).

---

## 4. Current behavior (baseline)

- **`applyInitialToolTier`** (`packages/opencode/src/session/initial-tool-tier.ts`): if `tier === "minimal"` and there is **no** assistant message yet, only a **small allowlist** of tools + short descriptions; otherwise **full** tools from `resolveTools`.
- **Implication:** turn 2+ always pays the **full tool-definition** cost unless something else filters tools.

The router spec **extends** this with a policy that can apply **after** the first assistant message.

---

## 5. Conceptual model

### 5.1 Inputs (minimum)

| Field | Description |
|-------|-------------|
| `user_text` | Latest user message text (and optionally prior user turns). |
| `agent` | Agent id / mode (e.g. `sdd-orchestrator`, `build`). |
| `available_tools` | Tool ids **after** permission and user toggles (same as today). |
| `conversation_phase` | Optional: e.g. `first_user_turn`, `multi_turn`, `after_compaction`. |
| `policy_config` | Feature flags, allowlists, base tools, max tools, etc. |

### 5.2 Output

| Field | Description |
|-------|-------------|
| `selected_ids` | Subset of `available_tools` to pass to the AI SDK. |
| `description_tier` | `minimal` \| `full` per tool or globally (optional optimization). |
| `reason` | Structured trace: rules fired, scores, or classifier label (for logs). |
| `confidence` | Optional `0..1` for telemetry and fallback thresholds. |

### 5.3 Invariants

- **`selected_ids` ⊆ `available_tools`** (never inject tools the session cannot use).
- **Respect permissions** and `experimental.primary_tools` (if applicable): router runs **after** the same gates as today.
- **Idempotent** for the same inputs + config version (reproducible offline runs).

---

## 6. Algorithms (pluggable)

Implementations behind one interface, e.g. `ToolRouter.decide(input) → output`.

### 6.1 Rule / keyword tier (MVP)

- Map keywords and regexes to tool groups (`edit` → `read`,`edit`,`grep`; `deploy` → `bash`,`task`, …).
- **Always include** a configurable **base set** per agent (e.g. orchestrator: `read`, `task`, `skill`).
- **Pros:** trivial to test, no ML. **Cons:** brittle.

### 6.2 Embedding similarity (offline)

- Precompute embeddings of **short tool summaries**; embed user message; pick top-`k` tools above a threshold, union base set.
- **Pros:** smoother than keywords. **Cons:** model file, threshold tuning.

### 6.3 Small local classifier

- Tiny model (e.g. quantized) maps text → label → tool group; still “offline” if bundled.
- **Pros:** better generalization. **Cons:** binary size, latency, platform support.

**Spec requirement:** the **interface** is stable; **at least one** MVP implementation (6.1) ships first.

### 6.4 Interface contract (normative for implementers)

Conceptual shape (language-agnostic):

```ts
type ToolRouterInput = {
  user_text: string
  agent_id: string
  available_tool_ids: string[] // sorted unique, post-permission
  has_assistant_message: boolean
  step: number // prompt loop step, optional
  config: ToolRouterConfig
}

type ToolRouterOutput = {
  selected_ids: string[]
  reason: { source: "rules" | "embeddings" | "passthrough"; detail?: string }
  description_tier?: "minimal" | "full"
}

// Router returns selected_ids ⊆ available_tool_ids; if router disabled, passthrough = copy input.
```

- **Passthrough:** when `tool_router.enabled === false`, `selected_ids === available_tool_ids` (no filtering).
- **Sanitization:** after `decide`, intersect again with `available_tool_ids` in case of bugs.

---

## 6bis. Pipeline order (merge with `initial_tool_tier`)

To avoid double-filtering or contradictions, apply **in this order**:

1. Build full tool map from `resolveTools` (agent, session, permissions, user tool toggles, structured-output tools, etc.).
2. **`applyInitialToolTier`** (unchanged): if `initial_tool_tier === "minimal"` **and** `has_assistant_message === false`, restrict to minimal allowlist + slim descriptions → call this map `tools_after_tier`.
3. **`ToolRouter.decide`** (this spec): if `tool_router.enabled` and policy says run on this turn (`apply_after_first_assistant` or equivalent), filter `tools_after_tier` to `selected_ids`; drop keys not in `selected_ids`. If router is off, skip step 3.
4. Pass result to `LLM.stream`.

**Turn 1 with both minimal tier and router:** router input sees **already-minimal** tools; router may **further** narrow (optional) or **no-op** if config says “router only after first assistant”. Product default: **either** minimal tier **or** router on turn 1, not two independent aggressive cuts—recommend `router.apply_after_first_assistant: true` so turn 1 stays exactly today’s minimal tier.

**Turn 2+:** tier no longer applies → full map from step 1; router is the main savings.

---

## 7. Fallback strategy (required)

Without recovery, a wrong subset blocks the user (**G3**).

### 7.1 Triggers for expansion (any one may fire; configurable)

| Trigger | Example |
|---------|---------|
| **T1** Model emits a tool call whose **name** ∉ `selected_ids` (should not happen if schema omits tool—prefer omit vs describe-only). |
| **T2** Runtime error from tool layer: “unknown tool” / permission after filter mismatch. |
| **T3** **Optional:** model produces **natural language** that indicates need (fragile; low priority). |
| **T4** **Optional:** explicit future tool `request_capabilities` with list of tool names. |

MVP should implement **T2** safely; **T1** if the stack surfaces invalid tool calls clearly.

### 7.2 Expansion steps

1. On trigger, **replace** `selected_ids` with **`expand_to`** target from config (typically **full** `available_tool_ids` for that request).
2. **Retry** the same model step **at most** `fallback.max_expansions_per_turn` (default `1`) for the **same user message** (same `user_text` / same turn id).
3. **Log** `router.fallback` with: `from_ids`, `to_ids`, `trigger`, `session_id`, `message_id`.
4. If still failing after max expansions, **surface error to user** (do not loop silently).

### 7.3 Scope

- “**Per user turn**” = one logical user message in the prompt loop, not one HTTP request (tool loops may issue multiple model calls; expansion should not reset between tool rounds unless specified—default: **one expansion budget per user turn** across inner steps).

### 7.4 Future

- Meta-tool **`request_tools`** or structured “need: [`write`,`bash`]” from the model before acting (requires prompt + schema work).

---

## 8. Configuration (proposed)

Under `experimental` or top-level (to be decided in implementation):

```jsonc
{
  "experimental": {
    "tool_router": {
      "enabled": true,
      "mode": "rules",           // "rules" | "embeddings" | "disabled"
      "apply_after_first_assistant": true,
      "base_tools": ["read", "task", "skill"],
      "max_tools": 12,
      "fallback": { "max_expansions_per_turn": 1, "expand_to": "full" }
    }
  }
}
```

- **`apply_after_first_assistant`:** when `true`, router runs on turn 2+; when `false`, preserve current behavior unless `enabled` is only for first turn (product choice).
- Env override optional: `OPENCODE_TOOL_ROUTER=1` mirroring other flags.

---

## 9. Integration points (OpenCode)

1. **`resolveTools` pipeline** (`session/prompt.ts` and related): after building the full tool map, call `ToolRouter.decide(...)` to **filter** keys before `processor.process` / `LLM.stream`.
2. **`applyInitialToolTier`:** either **compose** (tier minimal for turn 1, router for later) or **replace** with a single “tool policy” module to avoid conflicting rules. Spec recommends **one** `ToolPolicy` that combines: `initial_tier` + `router` + permissions.
3. **Logging:** reuse `debug_request` / `service=debug-request` or add `service=tool-router` lines: `selected_ids`, `reason`, `fallback`.

---

## 10. Observability

- **Structured log** per request: `router.mode`, `selected_ids`, `available_count`, `bytes_saved_estimate` (optional: diff of `JSON.stringify(tools)` before/after).
- **Metrics** (optional): count of fallbacks per session, expansion rate.

---

## 11. Security & abuse

- Router must **not** bypass permission checks; it only **narrows** an already authorized set.
- **No** user-controlled tool list from untrusted content without validation against `available_tools`.

---

## 12. Testing

- **Unit:** rule engine with fixed prompts → expected `selected_ids`.
- **Integration:** session with mocked tools; assert tool count in `LLM.stream` input or debug log.
- **Regression:** orchestrator agent still receives `task` when prompt implies delegation (tune rules or base set).

---

## 13. Phased delivery

| Phase | Deliverable |
|-------|-------------|
| P0 | Config flags + **rules-based** router + fallback to full + logs. |
| P1 | Per-agent presets (`sdd-orchestrator` base tools, etc.). |
| P2 | Embeddings or second implementation behind `mode`. |
| P3 | Optional collaboration with **compaction** (router sees summarized history). |

---

## 14. Open questions

| # | Question | Default bias |
|---|----------|----------------|
| Q1 | Should **MCP tools** use the same router or always be **opt-in** / always-on? | Start: **exclude MCP from automatic routing** unless listed in `base_tools`; MCP names are dynamic. |
| Q2 | **Structured output / JSON schema** modes that require `StructuredOutput` or fixed tools? | **Bypass router** for that turn (force-include required tools). |
| Q3 | **`title`** / **`small`** streams (e.g. gpt-5-nano title)? | **Skip router** (already tiny); `tool_router.skip_small: true`. |
| Q4 | Router on **compaction** / **replay** internal prompts? | **Skip** or use `task`-only set; avoid shrinking internal system prompts. |
| Q5 | **Concurrency:** two user messages queued? | Router runs on **latest** user text for that step; document if batching changes. |

---

## 15. Examples (rules MVP, illustrative)

**Agent:** `sdd-orchestrator`. **Base:** `read`, `task`, `skill`. **Max:** 8 tools.

| User message (excerpt) | Extra tools beyond base (example) |
|------------------------|-------------------------------------|
| “List files in src” | `glob`, `grep` |
| “Edit README to add X” | `read`, `edit`, `grep` |
| “Run tests” | `bash` |
| “Search the web for Y” | `websearch`, `webfetch` |

If no keyword matches, **only base** (3 tools) + log `reason: default_base`.

---

## 16. Edge cases

| Case | Behavior |
|------|----------|
| `selected_ids` empty after router | **Invalid**—implementation must fall back to `base_tools` minimum or full set; never call model with zero tools if tools were available unless `toolChoice: none`. |
| `available_tool_ids` already small | Router is **no-op** or identity; no error. |
| User disables a tool in UI | Still removed **before** router; router never re-enables. |
| Router selects more than `max_tools` | **Truncate** after priority order: base first, then ranked matches, then drop lowest priority (log warning). |

---

## 17. Risks & limitations

- **Recall vs precision:** aggressive routing **misses** needed tools → user-visible failure unless fallback works.
- **Latency:** embeddings/classifier add CPU; budget e.g. &lt; 50ms for rules MVP on laptop.
- **Maintenance:** keyword lists **rot** as product adds tools; per-agent presets need updates.
- **Security:** router is **not** a sandbox; permissions remain authoritative.

---

## 18. References (code)

- `packages/opencode/src/session/initial-tool-tier.ts` — current minimal tier.
- `packages/opencode/src/session/prompt.ts` — `resolveTools`, prompt loop.
- `packages/opencode/src/session/tool-router.ts` — rules-based router.
- `packages/opencode/docs/debug-request.md` — measuring wire payload sizes (optional).

**Implementation status (this fork):** see [`offline-tool-router-implementation.md`](./offline-tool-router-implementation.md) for what is shipped, configuration, and code paths.

---

## Document control

| | |
|--|--|
| Status | Design spec — pipeline, interface, fallback detail, examples, edge cases; P0 rules router implemented in fork (see implementation doc for gaps) |
| Format | Markdown, repo path `packages/opencode/docs/spec-offline-tool-router.md` |
| Companion | [`offline-tool-router-implementation.md`](./offline-tool-router-implementation.md) — professional documentation of the fork delta vs upstream OpenCode |
