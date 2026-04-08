import type { SessionID } from "../schema"

// lastInterval tracks the token count at the last "buffer" signal
// so we only fire "buffer" once per INTERVAL, not on every turn after crossing 6k
type State = { tok: number; pending: boolean; lastInterval: number }

const state = new Map<SessionID, State>()
const inFlight = new Map<SessionID, Promise<void>>()

// Per-session mutex — serializes activate() and reflect() cycles so two concurrent
// turns cannot both read isObserving=false and fire duplicate LLM calls.
// Matches Mastra's withLock pattern. Works within a single process (no distributed locking).
const locks = new Map<SessionID, Promise<void>>()

export async function withSessionLock<T>(sid: SessionID, fn: () => Promise<T>): Promise<T> {
  const existing = locks.get(sid)
  if (existing) await existing.catch(() => {})

  let release!: () => void
  const lock = new Promise<void>((r) => (release = r))
  locks.set(sid, lock)

  try {
    return await fn()
  } finally {
    release()
    if (locks.get(sid) === lock) locks.delete(sid)
  }
}

// Per-session observing/reflecting status for TUI feedback.
// Using Maps instead of globals so concurrent sessions don't bleed state.
const observingSet = new Set<SessionID>()
const reflectingSet = new Set<SessionID>()

export type ThresholdRange = { min: number; max: number }

// Fraction of the observed window to keep visible in the message tail after activation.
// Matches Mastra's bufferActivation=0.8 → retain 20% (1 - 0.8) of the window.
// Prevents "cold start" after activation where the LLM had no recent messages to anchor on.
export const RETENTION_FLOOR = 0.2

// Calculate the timestamp boundary that retains RETENTION_FLOOR of the observed window.
// endsAt: timestamp of the last observed message
// windowMs: duration of the observed window (endsAt - startsAt)
// Returns: timestamp such that messages after this point are kept in the LLM context
export function retentionFloorAt(endsAt: number, windowMs: number): number {
  return Math.floor(endsAt - windowMs * RETENTION_FLOOR)
}

// Calculate dynamic TRIGGER threshold — shrinks as observations grow.
// When threshold is a plain number, returns it unchanged (no adaptive behavior).
// When a ThresholdRange, returns max(min, max - obsTokens) so total budget
// (messages + observations) stays within max.
export function calculateDynamicThreshold(threshold: number | ThresholdRange, obsTokens: number): number {
  if (typeof threshold === "number") return threshold
  return Math.max(threshold.min, threshold.max - obsTokens)
}

const DEFAULT_RANGE: ThresholdRange = { min: 80_000, max: 140_000 }

// Multiplier for computing the default blockAfter ceiling from the trigger.
// Matches Mastra's blockAfter=1.2x — when no explicit blockAfter is configured,
// backpressure kicks in at 1.2× the effective trigger threshold.
export const BLOCK_AFTER_MULTIPLIER = 1.2

export namespace OMBuf {
  const INTERVAL = 6_000

  function ensure(sid: SessionID): State {
    const s = state.get(sid)
    if (s) return s
    const next: State = { tok: 0, pending: false, lastInterval: 0 }
    state.set(sid, next)
    return next
  }

  export function check(
    sid: SessionID,
    tok: number,
    obsTokens?: number,
    configThreshold?: number | ThresholdRange,
    blockAfter?: number,
  ): "buffer" | "activate" | "block" | "idle" {
    const s = ensure(sid)
    s.tok += tok
    // Resolve trigger: use config threshold when provided, else adaptive DEFAULT_RANGE.
    // When obsTokens is known, apply adaptive shrink so total budget stays within max.
    const base = configThreshold ?? DEFAULT_RANGE
    const trigger =
      obsTokens !== undefined ? calculateDynamicThreshold(base, obsTokens) : typeof base === "number" ? base : base.max
    // blockAfter: use explicit config if provided, otherwise 1.2× the effective trigger
    // (matches Mastra's blockAfter=1.2x ratio — backpressure just above the activation point).
    const limit = blockAfter ?? Math.ceil(trigger * BLOCK_AFTER_MULTIPLIER)
    if (s.tok >= limit) return "block"
    if (s.tok >= trigger) return "activate"
    // Fire "buffer" only when crossing a new INTERVAL boundary, not every turn
    const intervals = Math.floor(s.tok / INTERVAL)
    const lastIntervals = Math.floor(s.lastInterval / INTERVAL)
    if (intervals > lastIntervals) {
      s.lastInterval = s.tok
      return "buffer"
    }
    return "idle"
  }

  // Reset tok and lastInterval after activate() so each observation cycle
  // starts fresh. Without this, s.tok grows unbounded and the system stays
  // permanently in "activate" or "block" after the first condensation.
  export function resetCycle(sid: SessionID): void {
    const s = state.get(sid)
    if (!s) return
    s.tok = 0
    s.lastInterval = 0
  }

  // Full reset — called when a session is fully closed (onIdle) to free memory.
  export function reset(sid: SessionID): void {
    state.delete(sid)
    inFlight.delete(sid)
    seals.delete(sid)
    observingSet.delete(sid)
    reflectingSet.delete(sid)
  }

  export function setInFlight(sid: SessionID, p: Promise<void>): void {
    inFlight.set(sid, p)
  }

  export function getInFlight(sid: SessionID): Promise<void> | undefined {
    return inFlight.get(sid)
  }

  export function clearInFlight(sid: SessionID): void {
    inFlight.delete(sid)
  }

  export async function awaitInFlight(sid: SessionID): Promise<void> {
    const p = inFlight.get(sid)
    if (!p) return
    await p
    inFlight.delete(sid)
  }

  export function tokens(sid: SessionID): number {
    return state.get(sid)?.tok ?? 0
  }

  export function add(sid: SessionID, tok: number): void {
    ensure(sid).tok += tok
  }

  // Per-session status flags for TUI feedback.
  // observing()/reflecting() return true if ANY session is currently active.
  export function observing(): boolean {
    return observingSet.size > 0
  }
  export function reflecting(): boolean {
    return reflectingSet.size > 0
  }
  export function setObserving(sid: SessionID, v: boolean): void {
    if (v) observingSet.add(sid)
    else observingSet.delete(sid)
  }
  export function setReflecting(sid: SessionID, v: boolean): void {
    if (v) reflectingSet.add(sid)
    else reflectingSet.delete(sid)
  }

  // In-memory seal map: session → sealed_at timestamp
  // Prevents the mega-message bug: excludes messages at/before the Observer snapshot boundary.
  const seals = new Map<string, number>()

  export function seal(sid: string, at: number): void {
    const existing = seals.get(sid)
    if (!existing || at > existing) seals.set(sid, at)
  }

  export function sealedAt(sid: string): number {
    return seals.get(sid) ?? 0
  }
}
