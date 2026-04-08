# Design: obs-chunk-splitting-openai

## Technical Approach

OpenAI's automatic prefix caching is token-prefix identity: if the first N tokens of a request are byte-for-byte identical to a cached prefix, they are served from cache. The current non-Anthropic path emits `observationsStable` as a **single** system message. When the observer appends a new `<observation-group>` block, the entire string changes — every prior token is re-processed.

The fix is structural: emit each `<observation-group>` as its own system message. Old groups are textually unchanged → their prefix matches → automatic cache hit. Only the newest group (or a reflector-compressed version) changes. No API flags, no provider options — the split itself is the optimization.

The Anthropic path is explicitly excluded. It uses a 4-slot `cacheControl` budget where breakpoints are placed surgically; splitting there would consume breakpoint slots and break the existing strategy.

## Architecture Decisions

### Decision: split at `<observation-group>` tags, not at a text delimiter

**Choice**: Use the existing `<observation-group id="..." range="...">...</observation-group>` XML structure produced by `wrapInObservationGroup()` as the split boundary.

**Alternatives considered**:

- Split on a text delimiter like `--- message boundary (ISO8601) ---`. This was the Mastra approach on raw text concatenations. LightCode already wraps chunks in typed XML tags with identity attributes — splitting there is more precise, preserves the tag wrapper (and thus the `<observation-group range="...">` hint the model uses for recall), and requires no new delimiter.
- Split on `\n\n` paragraph boundaries. Too coarse and unstable — paragraph count changes with minor edits.

**Rationale**: The group tags are already the unit of observation identity. They carry a stable `id` and `range` for recall. Splitting on them produces chunks whose text is stable as long as the observation content is stable, which is the exact invariant needed for prefix cache hits.

---

### Decision: `splitObsChunks` lives in `system.ts`, not `groups.ts`

**Choice**: Add `splitObsChunks` as an exported function in `session/system.ts`, implemented using the existing `TAG` regex from `groups.ts` (re-import or replicate the pattern).

**Alternatives considered**:

- Add to `groups.ts` alongside `parseObservationGroups`. Reasonable, but the function operates on a `wrapObservations`-processed string (with context instructions appended), not on raw observations. Placing it in `system.ts` keeps it co-located with the wrapping logic it depends on.

**Rationale**: `system.ts` already owns `observationsStable()` and `wrapObservations()`. The split function is a post-wrap operation and belongs with its producer.

---

### Decision: indexed keys `observations_stable_0..N-1` in PromptProfile

**Choice**: Replace the single `observations_stable` layer key with `observations_stable_0`, `observations_stable_1`, … in the non-Anthropic path.

**Alternatives considered**:

- Keep a single `observations_stable` key with a combined hash. Loses per-chunk observability and makes it impossible to see which chunk changed in the debug panel.
- Use a nested structure in `PromptProfileEntry`. Would require a type change cascading to the TUI debug panel.

**Rationale**: Flat indexed keys require only a string key change and fit the existing `PromptLayerProfile[]` array without schema changes.

---

### Decision: `bpStat` matches `observations_stable` key prefix

**Choice**: Extend `bpStat` in `prompt-profile.ts` to accept a prefix string in addition to exact keys, so bp2 can match `observations_stable_0`, `observations_stable_1`, etc.

**Alternatives considered**:

- Compute a single aggregate hash of all chunks and use it as `observations_stable` in the Anthropic path only. Clean but requires maintaining two codepaths for the profile update.

**Rationale**: Minimal change — `bpStat` gains a prefix-match mode, bp2 call site passes `"observations_stable"` as a prefix, everything else is unchanged.

## Data Flow

```
LLM.stream() [non-Anthropic path]
  │
  ├─ stableObs = input.observationsStable ?? input.observations ?? "<!-- ctx -->"
  │
  ├─ chunks = SystemPrompt.splitObsChunks(stableObs)
  │   ├─ If groups found → ["<observation-group...>...</observation-group>", ...]
  │   └─ If no groups   → [stableObs]   (identical to today)
  │
  ├─ blocks = [
  │     head,
  │     rest || undefined,
  │     input.workingMemory,
  │     ...chunks,          // ← was: stableObs (single string)
  │     SystemPrompt.volatile(input.model),
  │     input.recall,
  │     input.observationsLive,
  │   ].filter(Boolean)
  │
  ├─ messages = [
  │     ...blocks.map(x => ({ role: "system", content: x })),
  │     ...input.messages,
  │   ]
  │
  └─ PromptProfile.set({
       layers: [
         promptProfile.head,
         promptProfile.rest,
         promptProfile.working_memory,
         // ← was: promptProfile.observations_stable (single layer)
         ...chunks.map((c, i) => ({
           key: `observations_stable_${i}`,
           tokens: Token.estimate(c.trim()),
           hash: createHash("sha1").update(c.trim()).digest("hex"),
         })),
         promptProfile.observations_live,
         promptProfile.semantic_recall,
         { key: "tail", tokens: ..., hash: undefined },
       ].filter(x => x.tokens > 0),
       ...
     })
```

## File Changes

| File                                              | Action   | Description                                                                                                      |
| ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/system.ts`         | Modified | Add `splitObsChunks(text: string): string[]`                                                                     |
| `packages/opencode/src/session/llm.ts`            | Modified | Non-Anthropic `blocks` array: spread `chunks` instead of scalar `stableObs`; update `PromptProfile.set()` layers |
| `packages/opencode/src/session/prompt-profile.ts` | Modified | `bpStat` gains prefix-match support; bp2 call site updated                                                       |

## Interfaces / Contracts

### `SystemPrompt.splitObsChunks` (new, `system.ts`)

```ts
/**
 * Split a rendered observationsStable string into per-group chunks.
 *
 * Each <observation-group> element becomes its own element in the result.
 * When no groups are present, returns [text] — single-block fallback.
 *
 * The returned strings include the full <observation-group>...</observation-group>
 * wrapper so the model retains recall range metadata inside each system message.
 */
export function splitObsChunks(text: string): string[] {
  const TAG = /<observation-group\s[^>]*>[\s\S]*?<\/observation-group>/g
  const chunks = text.match(TAG)
  return chunks ?? [text]
}
```

### `blocks` array mutation (`llm.ts`, non-Anthropic branch)

```ts
// Before
const blocks = anthropic
  ? [ ... ]
  : [
      head,
      rest || undefined,
      input.workingMemory,
      stableObs,                              // ← single string
      SystemPrompt.volatile(input.model),
      input.recall,
      input.observationsLive,
    ].filter((x): x is string => Boolean(x))

// After
const obsChunks = SystemPrompt.splitObsChunks(stableObs)

const blocks = anthropic
  ? [ ... ]                                   // ← unchanged
  : [
      head,
      rest || undefined,
      input.workingMemory,
      ...obsChunks,                           // ← N strings instead of 1
      SystemPrompt.volatile(input.model),
      input.recall,
      input.observationsLive,
    ].filter((x): x is string => Boolean(x))
```

### `PromptProfile.set()` layers update (`llm.ts`)

```ts
// Before
PromptProfile.set({
  sessionID: input.sessionID,
  requestAt: Date.now(),
  recallReused: input.recallReused ?? false,
  layers: [
    promptProfile.head,
    promptProfile.rest,
    promptProfile.working_memory,
    promptProfile.observations_stable, // ← single layer
    promptProfile.observations_live,
    promptProfile.semantic_recall,
    { key: "tail", tokens: promptProfile.tail.tokens, hash: undefined },
  ].filter((x) => x.tokens > 0),
  cache: { read: 0, write: 0, input: 0 },
})

// After
const chunkLayers = obsChunks.map((c, i) => ({
  key: `observations_stable_${i}`,
  tokens: Token.estimate(c.trim()),
  hash: createHash("sha1").update(c.trim()).digest("hex"),
}))

PromptProfile.set({
  sessionID: input.sessionID,
  requestAt: Date.now(),
  recallReused: input.recallReused ?? false,
  layers: [
    promptProfile.head,
    promptProfile.rest,
    promptProfile.working_memory,
    ...chunkLayers, // ← N layers instead of 1
    promptProfile.observations_live,
    promptProfile.semantic_recall,
    { key: "tail", tokens: promptProfile.tail.tokens, hash: undefined },
  ].filter((x) => x.tokens > 0),
  cache: { read: 0, write: 0, input: 0 },
})
```

### `bpStat` prefix-match update (`prompt-profile.ts`)

```ts
// Before
function bpStat(keys: string[]): BPStatus {
  if (!prevHashes) return "new"
  const changed = keys.some((k) => cur[k] && prevHashes[k] && cur[k] !== prevHashes[k])
  if (changed) return "broke"
  const anyPresent = keys.some((k) => cur[k] && prevHashes[k])
  return anyPresent ? "stable" : "new"
}

const bpStatus: BreakpointStatus | undefined = prevHashes
  ? {
      bp1: bpStat(["head", "rest"]),
      bp2: bpStat(["working_memory", "observations_stable"]), // ← exact key
      bp3: "always",
      bp4: bpStat(["tools"]),
    }
  : undefined

// After — bpStat accepts exact keys OR a single prefix string
function bpStat(keys: string[], prefix?: string): BPStatus {
  if (!prevHashes) return "new"
  const all = prefix ? [...keys, ...Object.keys(cur).filter((k) => k.startsWith(prefix))] : keys
  const changed = all.some((k) => cur[k] && prevHashes[k] && cur[k] !== prevHashes[k])
  if (changed) return "broke"
  const anyPresent = all.some((k) => cur[k] && prevHashes[k])
  return anyPresent ? "stable" : "new"
}

const bpStatus: BreakpointStatus | undefined = prevHashes
  ? {
      bp1: bpStat(["head", "rest"]),
      bp2: bpStat(["working_memory"], "observations_stable"), // ← prefix match
      bp3: "always",
      bp4: bpStat(["tools"]),
    }
  : undefined
```

## Testing Strategy

### Unit — `splitObsChunks`

```ts
// system.test.ts (or inline unit)
import { SystemPrompt } from "../system"

it("splits two groups into two chunks", () => {
  const text = [
    `<observation-group id="a1" range="m1:m5">\nfoo\n</observation-group>`,
    `<observation-group id="b2" range="m6:m10">\nbar\n</observation-group>`,
  ].join("\n\n")
  const chunks = SystemPrompt.splitObsChunks(text)
  expect(chunks).toHaveLength(2)
  expect(chunks[0]).toContain("foo")
  expect(chunks[1]).toContain("bar")
})

it("returns [text] when no groups", () => {
  const text = "plain observations"
  expect(SystemPrompt.splitObsChunks(text)).toEqual(["plain observations"])
})
```

### Unit — `PromptProfile` bp2 with prefix

```ts
// prompt-profile.test.ts
it("bp2 is stable when all obs_stable chunks unchanged", () => {
  // first turn
  PromptProfile.set({ sessionID: "s1", layers: [
    { key: "observations_stable_0", tokens: 10, hash: "aaa" },
    { key: "observations_stable_1", tokens: 10, hash: "bbb" },
  ], ... })
  // second turn — identical chunks
  PromptProfile.set({ sessionID: "s1", layers: [
    { key: "observations_stable_0", tokens: 10, hash: "aaa" },
    { key: "observations_stable_1", tokens: 10, hash: "bbb" },
  ], ... })
  expect(PromptProfile.get("s1")?.bpStatus?.bp2).toBe("stable")
})

it("bp2 is broke when a chunk hash changes", () => {
  PromptProfile.set({ sessionID: "s2", layers: [
    { key: "observations_stable_0", tokens: 10, hash: "aaa" },
  ], ... })
  PromptProfile.set({ sessionID: "s2", layers: [
    { key: "observations_stable_0", tokens: 10, hash: "zzz" },  // changed
  ], ... })
  expect(PromptProfile.get("s2")?.bpStatus?.bp2).toBe("broke")
})
```

### Integration — Anthropic path regression

```ts
it("Anthropic blocks array is unchanged after chunk-split change", () => {
  // mock anthropic === true, assert blocks array === pre-change shape
  // observationsStable with 2 groups → still 1 entry in the Anthropic blocks array
})
```

### Manual verification

After landing: inspect the TUI cache debug panel on a 3-turn session. The `observations_stable_0` … `N` layer list should show stable hashes across turns 2 and 3 for all chunks except the newest one.

## Open Questions

1. **Does `wrapObservations` suffix (OBSERVATION_CONTEXT_INSTRUCTIONS) get appended once or per chunk?**  
   Current: `observationsStable()` in `system.ts` appends `OBSERVATION_CONTEXT_INSTRUCTIONS` after the entire `<local-observations>` block. After splitting, `splitObsChunks` operates on this fully-rendered string — so the instructions appear only after the last chunk, not after each. This is the desired behaviour (the model reads it once). Confirm this is intentional before implementation.

2. **Should `OBSERVATION_RETRIEVAL_INSTRUCTIONS` be duplicated into the last chunk?**  
   It currently appears only when `parseObservationGroups(body).length > 0`. After splitting, it may make sense to keep it attached to the last chunk only — the model sees it last and can use it for recall. No change needed unless testing reveals recall degradation.

3. **PromptProfile display in TUI cache-debug**: the existing panel renders layers by key. With N indexed keys, the panel may look cluttered for long sessions. A grouping/folding UI improvement is desirable but explicitly out of scope for this change.
