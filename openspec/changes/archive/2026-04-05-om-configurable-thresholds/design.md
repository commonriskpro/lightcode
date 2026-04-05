# Design: om-configurable-thresholds

## Overview

Four surgical edits across five files. No new files, no DB migrations. Each change exposes a
previously hardcoded constant through the existing `experimental` config block or removes dead
code. The `calculateDynamicThreshold` function already exists in `buffer.ts` — Change 3 just
flips the default that feeds it.

---

## Change 1 — `observer_force_tokens` config key

### 1a — config.ts: add schema key

**File:** `src/config/config.ts` — inside the `experimental` schema object (after `observer_message_tokens`)

```ts
// BEFORE — key does not exist

// AFTER — insert after observer_message_tokens block (~line 1052)
observer_force_tokens: z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Hard-force ceiling for Observer buffer (tokens). When accumulated message tokens exceed this value Observer fires immediately. Default 36_000.",
  ),
```

### 1b — buffer.ts: read from config in `OMBuf.check()`

**File:** `src/session/om/buffer.ts` — `OMBuf.check()` (~line 38)

The function already accepts `configThreshold?: number | ThresholdRange` for the soft trigger. We add a second optional param for the force ceiling.

```ts
// BEFORE
export function check(
  sid: SessionID,
  tok: number,
  obsTokens?: number,
  configThreshold?: number | ThresholdRange,
): "buffer" | "activate" | "force" | "idle" {
  const s = ensure(sid)
  s.tok += tok
  if (s.tok >= FORCE) return "force"
  ...
}

// AFTER
export function check(
  sid: SessionID,
  tok: number,
  obsTokens?: number,
  configThreshold?: number | ThresholdRange,
  forceThreshold?: number,
): "buffer" | "activate" | "force" | "idle" {
  const s = ensure(sid)
  s.tok += tok
  if (s.tok >= (forceThreshold ?? FORCE)) return "force"
  ...
}
```

**Call site — `src/session/prompt.ts` (~line 1524):**

```ts
// BEFORE
const sig = OMBuf.check(sessionID, tok, obsRec?.observation_tokens, omCfg.experimental?.observer_message_tokens)

// AFTER
const sig = OMBuf.check(
  sessionID,
  tok,
  obsRec?.observation_tokens,
  omCfg.experimental?.observer_message_tokens,
  omCfg.experimental?.observer_force_tokens,
)
```

**Why:** Operators running very large agentic pipelines need to raise (or lower) the hard ceiling
without patching source. The default `36_000` is unchanged when the key is absent.

---

## Change 2 — `observer_reflection_tokens` config key

### 2a — config.ts: add schema key

**File:** `src/config/config.ts` — inside the `experimental` schema object (after `observer_force_tokens`)

```ts
// BEFORE — key does not exist

// AFTER
observer_reflection_tokens: z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Observation-token threshold at which the Reflector runs compression. Default 40_000.",
  ),
```

### 2b — reflector.ts: read from config in `Reflector.run()`

**File:** `src/session/om/reflector.ts` (~line 11)

```ts
// BEFORE (line 11)
const THRESHOLD = 40_000

// AFTER — remove module constant; read from config inside the function
// (THRESHOLD constant deleted)
```

Inside `Reflector.run()` (wherever `THRESHOLD` is referenced):

```ts
// BEFORE
if ((obsRec?.observation_tokens ?? 0) < THRESHOLD) return

// AFTER
const cfg = await Config.get()
const threshold = cfg.experimental?.observer_reflection_tokens ?? 40_000
if ((obsRec?.observation_tokens ?? 0) < threshold) return
```

**Why:** Teams with smaller context windows or aggressive compression strategies need to lower
the reflection threshold. Teams using high-capacity models can raise it to reduce compute.
Default is unchanged.

---

## Change 3 — Adaptive default for `observer_message_tokens`

### Math

`calculateDynamicThreshold(threshold, obsTokens)` returns `Math.max(min, max - obsTokens)`.

With default `{ min: 20_000, max: 50_000 }`:

| `obsTokens` | `max − obsTokens` | `Math.max(20k, …)` | Effective trigger |
| ----------- | ----------------- | ------------------ | ----------------- |
| 0           | 50_000            | 50_000             | 50k               |
| 20_000      | 30_000            | 30_000             | 30k               |
| 30_000      | 20_000            | 20_000             | 20k               |
| 40_000      | 10_000            | 20_000             | 20k (floor)       |
| 60_000      | −10_000           | 20_000             | 20k (floor)       |

At 40k observation tokens the Reflector fires (default `observer_reflection_tokens = 40_000`),
so the message threshold has already reached its minimum. The two defaults are harmonized by
design: as the Reflector compresses observations the budget can expand again on the next turn.

### Implementation

**File:** `src/session/om/buffer.ts` — inside `OMBuf.check()`

```ts
// BEFORE (~line 49)
const base = configThreshold ?? TRIGGER

// AFTER — replace TRIGGER constant (30_000) with adaptive default range
const DEFAULT_RANGE: ThresholdRange = { min: 20_000, max: 50_000 }
const base = configThreshold ?? DEFAULT_RANGE
```

The module-level `const TRIGGER = 30_000` is deleted (or kept as dead reference — prefer delete
for cleanliness).

**Why:** The `calculateDynamicThreshold` function has been present since the Observer was
introduced, but its adaptive path was only reachable if the user explicitly set a range in
config. Changing the fallback activates adaptive behavior for all users without requiring any
config change — and is backward compatible for users who already set a plain number (plain
numbers flow through `calculateDynamicThreshold` unchanged: `typeof threshold === "number"` →
`return threshold`).

---

## Change 4 — Remove `&& false` dead guard in `system.ts`

**File:** `src/session/system.ts` (~lines 34–42)

```ts
// BEFORE
`<directories>`,
`  ${
  project.vcs === "git" && false
    ? await Ripgrep.tree({
        cwd: Instance.directory,
        limit: 50,
      })
    : ""
}`,
`</directories>`,

// AFTER
`<directories>`,
`  `,
`</directories>`,
```

**Why:** `project.vcs === "git" && false` is always `false`. The ripgrep tree call is
permanently dead. Activating it is a separate feature (with its own cost/benefit analysis around
prompt token usage). Until that change lands, the dead block adds confusion, wastes reader
attention, and may trigger TypeScript unreachable-code warnings. Delete it cleanly. The
`<directories>` section remains in the prompt as a placeholder for the future activation.

> **Note on `await` inside template literal:** The surrounding function is async. Removing the
> branch also removes the only `await` in this segment — confirm no dangling `async` markers are
> left. If `Ripgrep` import becomes unused after deletion, remove the import too.

---

## Test Plan

| Test file                        | Scenario                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `test/session/buffer.test.ts`    | `OMBuf.check` returns `"force"` at `forceThreshold` when set             |
| `test/session/buffer.test.ts`    | `OMBuf.check` returns `"force"` at `36_000` when `forceThreshold` unset  |
| `test/session/buffer.test.ts`    | Adaptive default: effective trigger is `50k` at 0 obs, `20k` at 40k obs  |
| `test/session/buffer.test.ts`    | Plain-number `configThreshold` bypasses adaptive logic                   |
| `test/session/reflector.test.ts` | `Reflector.run()` fires at custom `observer_reflection_tokens` value     |
| `test/session/reflector.test.ts` | `Reflector.run()` does not fire below default `40_000` when key is unset |
