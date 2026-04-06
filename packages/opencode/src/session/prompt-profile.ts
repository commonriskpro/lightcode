/**
 * prompt-profile.ts
 *
 * In-memory store for the most recent prompt profile per session.
 * Populated by LLM.stream() after each request is assembled.
 * Read by the debug endpoint and TUI cache-debug command.
 *
 * No persistence — this resets on process restart by design.
 */

export type PromptLayerProfile = {
  key: string
  tokens: number
  hash: string | undefined
}

export type PromptProfileEntry = {
  sessionID: string
  requestAt: number
  /** Whether recall was reused from previous turn (T-5 signal) */
  recallReused: boolean
  layers: PromptLayerProfile[]
  /** Provider cache counters from the last completed step */
  cache: {
    read: number
    write: number
  }
}

const store = new Map<string, PromptProfileEntry>()

export namespace PromptProfile {
  export function set(entry: PromptProfileEntry) {
    store.set(entry.sessionID, entry)
  }

  export function get(sessionID: string): PromptProfileEntry | undefined {
    return store.get(sessionID)
  }

  export function all(): PromptProfileEntry[] {
    return [...store.values()].sort((a, b) => b.requestAt - a.requestAt)
  }

  export function updateCache(sessionID: string, read: number, write: number) {
    const entry = store.get(sessionID)
    if (!entry) return
    store.set(sessionID, { ...entry, cache: { read, write } })
  }
}
