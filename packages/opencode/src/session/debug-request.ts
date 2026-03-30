import type { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

const log = Log.create({ service: "debug-request" })

export namespace DebugRequest {
  export function enabled(cfg: Config.Info | undefined) {
    return Flag.OPENCODE_DEBUG_REQUEST || cfg?.experimental?.debug_request === true
  }

  export function wire(input: {
    sessionID: string
    assistantID?: string
    userID?: string
    providerID: string
    modelID: string
    agent: string
    small?: boolean
    toolsBytes: number
    promptBytes: number
    systemBytes: number
    /** Effective tier (env or config); minimal only shrinks tools + defers instructions when thread_has_assistant is false. */
    initial_tool_tier?: "minimal" | "full"
    /** True when this request’s message history already includes an assistant turn (minimal tier inactive for tools/instructions). */
    thread_has_assistant?: boolean
    /** Whether offline tool router is enabled (env or config). */
    tool_router?: boolean
  }) {
    log.info("debug_request", { phase: "wire", ...input })
  }

  export function usage(input: {
    sessionID: string
    assistantID: string
    finish: string
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    cost: number
  }) {
    log.info("debug_request", { phase: "usage", ...input })
  }
}
