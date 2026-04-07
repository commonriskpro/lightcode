import type { SessionID } from "../schema"

// lastInterval tracks the token count at the last "buffer" signal
// so we only fire "buffer" once per INTERVAL, not on every turn after crossing 6k
type State = { tok: number; pending: boolean; lastInterval: number }

const state = new Map<SessionID, State>()
const inFlight = new Map<SessionID, Promise<void>>()

// Observable status for TUI feedback — polled by sidebar footer
let _observing = false
let _reflecting = false

export type ThresholdRange = { min: number; max: number }

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

  export function reset(sid: SessionID): void {
    state.delete(sid)
    inFlight.delete(sid)
    // state.delete removes the entry entirely — lastInterval resets on next ensure()
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

  // Status flags for TUI feedback
  export function observing(): boolean {
    return _observing
  }
  export function reflecting(): boolean {
    return _reflecting
  }
  export function setObserving(v: boolean): void {
    _observing = v
  }
  export function setReflecting(v: boolean): void {
    _reflecting = v
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
