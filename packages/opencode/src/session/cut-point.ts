import type { MessageV2 } from "./message-v2"

const DEFAULT_KEEP = 20_000

export namespace CutPoint {
  export interface Result {
    type: "cut" | "full"
    cutIndex?: number
    summarize: MessageV2.WithParts[]
    keep: MessageV2.WithParts[]
  }

  export function find(msgs: MessageV2.WithParts[], keepTokens = DEFAULT_KEEP): Result {
    let accumulated = 0
    let cutIndex = -1

    for (let i = msgs.length - 1; i >= 0; i--) {
      accumulated += estimate(msgs[i])
      if (accumulated >= keepTokens) {
        cutIndex = validCut(msgs, i)
        break
      }
    }

    if (cutIndex < 0 || cutIndex <= 1 || cutIndex >= msgs.length - 1) return { type: "full", summarize: msgs, keep: [] }

    return {
      type: "cut",
      cutIndex,
      summarize: msgs.slice(0, cutIndex),
      keep: msgs.slice(cutIndex),
    }
  }

  // Walk forward from start to the nearest valid cut boundary.
  // Valid: a user message (not compaction), or the position after
  // a finished assistant message that isn't followed by an orphaned tool result.
  function validCut(msgs: MessageV2.WithParts[], start: number): number {
    for (let i = start; i < msgs.length; i++) {
      const msg = msgs[i]
      if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) return i
      if (msg.info.role === "assistant" && msg.info.finish) {
        const next = msgs[i + 1]
        if (!next || next.info.role === "user") return i + 1
      }
    }
    return -1
  }

  function estimate(msg: MessageV2.WithParts): number {
    let chars = 0
    for (const part of msg.parts) {
      if (part.type === "text") chars += part.text.length
      if (part.type === "tool" && part.state.status === "completed")
        chars += (JSON.stringify(part.state.input)?.length ?? 0) + (part.state.output?.length ?? 0)
      if (part.type === "reasoning") chars += part.text.length
    }
    return Math.ceil(chars / 4)
  }
}
