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

export type BPStatus = "stable" | "broke" | "new"

export type BreakpointStatus = {
  /** BP1: system[0] = head + rest (1h TTL) */
  bp1: BPStatus
  /** BP2: memory core = working_memory + observations_stable */
  bp2: BPStatus
  /** BP3: conversation penultimate message — always breaks (grows each turn) */
  bp3: "always"
  /** BP4: last tool definition */
  bp4: BPStatus
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
  /** Hashes from the previous turn — used to detect cache breaks per layer */
  prevHashes?: Record<string, string>
  /** Per-breakpoint stability status — only set when prevHashes exists */
  bpStatus?: BreakpointStatus
}

const store = new Map<string, PromptProfileEntry>()

export namespace PromptProfile {
  export function set(entry: PromptProfileEntry) {
    const prev = store.get(entry.sessionID)
    const prevHashes = prev
      ? Object.fromEntries(prev.layers.filter((l) => l.hash).map((l) => [l.key, l.hash!]))
      : undefined

    const cur = Object.fromEntries(entry.layers.filter((l) => l.hash).map((l) => [l.key, l.hash!]))

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
          bp2: bpStat(["working_memory"], "observations_stable"),
          bp3: "always",
          bp4: bpStat(["tools"]),
        }
      : undefined

    store.set(entry.sessionID, { ...entry, prevHashes, bpStatus })
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
