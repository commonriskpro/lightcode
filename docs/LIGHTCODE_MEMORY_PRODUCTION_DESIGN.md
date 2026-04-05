# LightCode Memory Production Technical Design

## D1 — Fix WM precedence dedup key

**File:** `packages/opencode/src/memory/working-memory.ts` (line 63)

- **Change:** Update the deduplication key from `const k = \`${r.scope_type}:${r.key}\``to`const k = r.key`.
- **Effect:** This ensures that if multiple scopes have the same key (e.g., "goals"), they will hash to the same deduplication key. Since the scopes are processed in order of specificity (thread first, then project), the most specific one will be retained, and broader ones will be skipped.
- **Test:** Insert records with the same key in `thread`, `project`, and `user` scopes. Verify that only the `thread` record is returned.

## D2 — Improve FTS5 query quality

**File:** `packages/opencode/src/memory/semantic-recall.ts`

- **Changes:**
  1. **`sanitizeFTS()`:** Update to use prefix-matching for the last token while quoting previous tokens.
     _Rationale:_ "auth JWT" becomes `"auth" JWT*`, which matches "authentication" and "JWT".
  2. **Add OR-mode fallback:** If the strict AND-mode returns 0 results, retry the search using an OR-mode.
  3. **OR mode (`sanitizeFTSPrefix`):** Each token becomes a prefix match (`token*`) without quotes, joined by `OR`.

- **Implementation:**

```typescript
function sanitizeFTS(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return ""
  // Exact-AND match: all tokens quoted (high precision)
  return tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" ")
}

function sanitizeFTSPrefix(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return ""
  // Prefix-OR match: each token gets prefix wildcard (higher recall)
  return tokens.map((t) => `${t.replace(/['"]/g, "")}*`).join(" OR ")
}
```

_Update `SemanticRecall.search()` to execute the query using `sanitizeFTS` first. If results are empty, re-execute using `sanitizeFTSPrefix`._

## D3 — Add FTS5 fallback to Memory.buildContext()

**File:** `packages/opencode/src/memory/provider.ts` (lines 66-68)

- **Change:** After attempting an FTS search, check if the results array is empty. If it is, call `SemanticRecall.recent(scopes, 5)` to provide recent memory context as a fallback.
- **Effect:** This mirrors the behavior previously intended in the dead `recallNative()` function, ensuring the context is always populated with useful information if any historical artifacts exist, preventing AI blindspots.

## D4 — Add agent scope to hot path (minimal)

**File:** `packages/opencode/src/session/prompt.ts` (lines 1806-1814)

- **Change:** Inject `{ type: "agent", id: lastUser.agent }` as an ancestor scope alongside the `project` scope when building memory context.
- **Change:** Update the `UpdateWorkingMemoryTool` schema and parameters to expose `"agent"` as a valid scope choice for the AI.

## D5 — runLoop OM coordination boundary cleanup

**File:** `packages/opencode/src/session/prompt.ts`

- **Change:** Do a low-risk structural cleanup inside `prompt.ts` rather than a deep extraction in this initiative.
- **Implementation:**
  - add explicit section ownership comments (`OM Coordinator`, `Memory Assembler`)
  - keep the existing live logic in place to avoid destabilizing the runtime hot path late in the initiative
  - defer a true helper extraction until there is broader session-runtime refactor capacity

- **Effect:** clarifies ownership and production maintainability without taking on the risk of a large behavioral refactor inside the already-sensitive `runLoop`.

## D6 — Clean up OPENCODE_MEMORY_USE_ENGRAM flag

**Files:** `packages/opencode/src/flag/flag.ts` and `packages/opencode/src/session/system.ts`

- **Change:**
  - Remove `OPENCODE_MEMORY_USE_ENGRAM` entirely from `flag.ts`.
  - Delete `recallEngram()`, `callEngramTool()`, and `recallNative()` from `system.ts` as they have no callers and add unnecessary complexity.
- **Change:** Document these removals in a `SUPERSEDED.md` file at the root or docs folder to ensure team awareness.

## D7 — Document scope dormancy clearly

**File:** `packages/opencode/src/memory/contracts.ts`

- **Change:** Add explicit inline comments noting that `user` and `global_pattern` scopes are reserved and dormant in the V1 runtime.
- **Change:** Add a comment explaining that the `agent` scope is fully operational via the hot path and tool usage.
