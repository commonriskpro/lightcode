import type { SessionID } from "../schema"

type State = { tok: number; pending: boolean }

const state = new Map<SessionID, State>()

export namespace Buffer {
  const TRIGGER = 30_000
  const INTERVAL = 6_000
  const FORCE = 36_000

  function ensure(sid: SessionID): State {
    const s = state.get(sid)
    if (s) return s
    const next: State = { tok: 0, pending: false }
    state.set(sid, next)
    return next
  }

  export function check(sid: SessionID, tok: number): "buffer" | "activate" | "force" | "idle" {
    const s = ensure(sid)
    s.tok += tok
    if (s.tok >= FORCE) return "force"
    if (s.tok >= TRIGGER) return "activate"
    if (s.tok >= INTERVAL) return "buffer"
    return "idle"
  }

  export function reset(sid: SessionID): void {
    state.delete(sid)
  }

  export function tokens(sid: SessionID): number {
    return state.get(sid)?.tok ?? 0
  }

  export function add(sid: SessionID, tok: number): void {
    ensure(sid).tok += tok
  }
}
