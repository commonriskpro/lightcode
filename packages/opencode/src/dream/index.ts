import path from "path"
import { Global } from "../global"
import { Log } from "@/util/log"
import { Engram } from "./engram"
import { Bus } from "../bus"
import { SessionStatus } from "../session/status"

import PROMPT from "./prompt.txt"

export namespace AutoDream {
  const log = Log.create({ service: "autodream" })

  interface DreamState {
    lastConsolidatedAt: number
    lastSessionCount: number
  }

  const statePath = path.join(Global.Path.state, "autodream.json")

  async function readState(): Promise<DreamState> {
    try {
      const raw = await Bun.file(statePath).text()
      return JSON.parse(raw)
    } catch {
      return { lastConsolidatedAt: 0, lastSessionCount: 0 }
    }
  }

  async function writeState(state: DreamState): Promise<void> {
    await Bun.write(statePath, JSON.stringify(state, null, 2))
  }

  // Dreaming state for TUI indicator
  let _dreaming = false
  export function dreaming() {
    return _dreaming
  }

  // SDK client injected from TUI
  interface SDKClient {
    session: {
      create: (params: Record<string, unknown>) => Promise<{ data?: { id: string } }>
      promptAsync: (params: Record<string, unknown>) => Promise<unknown>
    }
  }
  let sdk: SDKClient | undefined

  export function setSDK(client: SDKClient) {
    sdk = client
  }

  // Model injected from TUI config
  let configuredModel: string | undefined

  export function setModel(model: string | undefined) {
    configuredModel = model
  }

  async function spawn(focus?: string): Promise<string> {
    if (!sdk) throw new Error("AutoDream SDK not initialized")

    if (!configuredModel) throw new Error("No model configured. Use /dreammodel first")

    const title = focus ? `Dream: ${focus}` : "AutoDream consolidation"
    const res = await sdk.session.create({ title })
    const sessionID = res.data?.id
    if (!sessionID) throw new Error("Failed to create dream session")

    const prompt = focus ? `${PROMPT}\n\n## Focus\nPrioritize observations related to: ${focus}` : PROMPT
    const parts = configuredModel.split("/")
    const providerID = parts[0]
    const modelID = parts.slice(1).join("/")

    log.info("spawning dream session", { sessionID, providerID, modelID })

    await sdk.session.promptAsync({
      sessionID,
      model: { providerID, modelID },
      agent: "dream",
      parts: [{ type: "text", text: prompt }],
    })

    return "Dream consolidation started"
  }

  /** Manual trigger from /dream command */
  export async function run(focus?: string): Promise<string> {
    const available = await Engram.ensure()
    if (!available) return "Engram not available. Install with: brew install gentleman-programming/tap/engram"

    try {
      _dreaming = true
      log.info("dream started", { focus })
      const result = await spawn(focus)
      await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })
      log.info("dream completed")
      return result
    } catch (err) {
      log.error("dream failed", { error: err instanceof Error ? err.message : String(err) })
      return `Dream failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      _dreaming = false
    }
  }

  /** Subscribe to session idle events. Call at app startup. */
  export function init(): () => void {
    return Bus.subscribe(SessionStatus.Event.Idle, () => {
      // Auto-trigger is gated by model being configured
      if (!configuredModel) return
      void run().catch((err) => {
        log.error("autodream failed", { error: err instanceof Error ? err.message : String(err) })
      })
    })
  }
}
