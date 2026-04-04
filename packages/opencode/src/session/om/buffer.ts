import type { SessionID } from "../schema"

// lastInterval tracks the token count at the last "buffer" signal
// so we only fire "buffer" once per INTERVAL, not on every turn after crossing 6k
type State = { tok: number; pending: boolean; lastInterval: number }

const state = new Map<SessionID, State>()

// Observable status for TUI feedback — polled by sidebar footer
let _observing = false
let _reflecting = false

export namespace OMBuf {
  const TRIGGER = 30_000
  const INTERVAL = 6_000
  const FORCE = 36_000

  function ensure(sid: SessionID): State {
    const s = state.get(sid)
    if (s) return s
    const next: State = { tok: 0, pending: false, lastInterval: 0 }
    state.set(sid, next)
    return next
  }

  export function check(sid: SessionID, tok: number): "buffer" | "activate" | "force" | "idle" {
    const s = ensure(sid)
    s.tok += tok
    if (s.tok >= FORCE) return "force"
    if (s.tok >= TRIGGER) return "activate"
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
    // state.delete removes the entry entirely — lastInterval resets on next ensure()
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
}
