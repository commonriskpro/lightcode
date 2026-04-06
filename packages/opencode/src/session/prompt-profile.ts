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

export type CacheAlignment = {
  /** Total breakpoints placed (Anthropic limit: 4) */
  total: number
  limit: number
  /** false = over the limit, provider will silently ignore extras */
  ok: boolean
  /** system[i] indices that have a breakpoint */
  systemBP: number[]
  /** messages with breakpoints: index + role */
  messageBP: { i: number; role: string }[]
  /** tool names with breakpoints */
  toolBP: string[]
}

export type ToolProfile = {
  count: number
  names: string[]
  tokens: number
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
    /** Non-cached input tokens (adjusted = total_input - read - write) */
    input: number
  }
  tools?: ToolProfile
  /** Breakpoint placement audit — only set for Anthropic-like providers */
  alignment?: CacheAlignment
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

  export function updateCache(sessionID: string, read: number, write: number, input: number) {
    const entry = store.get(sessionID)
    if (!entry) return
    store.set(sessionID, { ...entry, cache: { read, write, input } })
  }

  export function updateAlignment(sessionID: string, alignment: CacheAlignment) {
    const entry = store.get(sessionID)
    if (!entry) return
    store.set(sessionID, { ...entry, alignment })
  }

  export function updateTools(sessionID: string, tools: ToolProfile) {
    const entry = store.get(sessionID)
    if (!entry) return
    const layers = entry.layers.filter((x) => x.key !== "tools")
    store.set(sessionID, {
      ...entry,
      tools,
      layers: tools.tokens > 0 ? [...layers, { key: "tools", tokens: tools.tokens, hash: undefined }] : layers,
    })
  }
}
