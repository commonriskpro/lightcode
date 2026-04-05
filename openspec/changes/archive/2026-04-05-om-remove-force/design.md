# Design: om-remove-force

## Problem

The current OM runtime has two competing paths:

1. **Async path** — `buffer` and `activate`
2. **Sync path** — `force`

Current logic in `buffer.ts`:

```ts
const FORCE = 36_000
...
if (s.tok >= (forceThreshold ?? FORCE)) return "force"
...
if (s.tok >= trigger) return "activate"
```

With the current adaptive default, `trigger` can be `50_000`, so `force` fires first. That makes the blocking path the normal path.

---

## Target Architecture (Mastra-aligned)

### One pipeline only

```text
idle -> buffer (async)
     -> activate (async)
     -> blockAfter (wait for async OM to finish)
```

No second observer path. No synchronous `Observer.run()` in the main loop.

---

## Change 1 — `OMBuf.check()` returns no `force`

### Before

```ts
export function check(...): "buffer" | "activate" | "force" | "idle"
```

### After

```ts
export function check(...): "buffer" | "activate" | "block" | "idle"
```

`block` means: accumulated tokens have exceeded `blockAfter`; do not run a synchronous observer. Instead, wait for in-flight OM work or trigger activation in the normal path.

### Config

- Remove `observer_force_tokens`
- Add `observer_block_after`

Default resolution:

```ts
const blockAfter = configBlockAfter ?? Math.round(trigger * 1.2)
if (s.tok >= blockAfter) return "block"
```

---

## Change 2 — Delete duplicate force logic from `prompt.ts`

### Before

`prompt.ts` has three branches:

- `sig === "buffer"`
- `sig === "activate"`
- `sig === "force"`

The `force` branch recomputes `unobserved`, calls `Observer.run()`, `OM.upsert()`, `OM.trackObserved()`, and possibly `Reflector.run()` synchronously.

### After

Delete the entire `sig === "force"` branch.

Add a `sig === "block"` branch:

```ts
if (sig === "block") {
  yield *
    Effect.promise(async () => {
      await OMBuf.awaitInFlight(sessionID)
      await OM.activate(sessionID)
      const fresh = OM.get(sessionID)
      if (fresh && (fresh.observation_tokens ?? 0) > Reflector.threshold) {
        OMBuf.setReflecting(true)
        try {
          await Reflector.run(sessionID)
        } finally {
          OMBuf.setReflecting(false)
        }
      }
      freshObsRec = OM.get(sessionID)
    }).pipe(Effect.ignore)
}
```

This still blocks, but it blocks by letting the **existing async-first pipeline catch up**. No duplicate observer code.

---

## Change 3 — UI/config cleanup

### Remove

- `observer_force_tokens` from `config.ts`
- force threshold control from `dialog-observer-thresholds.tsx`
- docs/tests/spec references to `36k force`

### Add

- `observer_block_after` to `config.ts`
- blockAfter control in `/features`

---

## Change 4 — Test strategy

### Replace force tests with blockAfter tests

- `OMBuf.check(... )` returns `"block"` above `blockAfter`
- no `"force"` signal exists
- prompt loop no longer contains `sig === "force"`
- backpressure waits for in-flight work instead of calling `Observer.run()` directly

---

## Why this is better

1. **No duplicate logic** — one observation pipeline
2. **No dead config** — remove `observer_force_tokens`
3. **Mastra-aligned** — async-first + backpressure
4. **Bug fixed** — blocking path no longer preempts activation
