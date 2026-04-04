import path from "path"
import { Global } from "../global"
import { Log } from "@/util/log"
import { Engram } from "./engram"
import { Bus } from "../bus"
import { SessionStatus } from "../session/status"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Token } from "../util/token"
import { OM } from "../session/om"
import type { SessionID } from "../session/schema"

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
      status: (params?: Record<string, unknown>) => Promise<{ data?: Record<string, { type: string }> }>
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

  function isText(p: MessageV2.Part): p is MessageV2.TextPart {
    return p.type === "text"
  }

  export async function summaries(sid: string): Promise<string> {
    // Priority 1: local observations from ObservationTable (dense, high-quality)
    const rec = OM.get(sid as SessionID)
    if (rec?.observations) {
      const est = Token.estimate(rec.observations)
      if (est <= 4000) return rec.observations
      return rec.observations.slice(0, 4000 * 4)
    }

    const msgs = await Session.messages({ sessionID: sid as any })
    const acc: string[] = []
    let cap = 0
    const sum = msgs
      .filter((x) => x.info.role === "assistant" && x.info.summary)
      .flatMap((x) => x.parts)
      .filter(isText)
      .map((x) => x.text)
    if (sum.length > 0) {
      for (const txt of sum) {
        const est = Token.estimate(txt)
        if (cap + est > 4000) break
        acc.push(txt)
        cap += est
      }
      return acc.join("\n---\n")
    }

    const back = msgs
      .filter((x) => x.info.role === "user" || x.info.role === "assistant")
      .flatMap((x) => x.parts)
      .filter(isText)
      .map((x) => x.text)
      .slice(-10)
    cap = 0
    for (const txt of back) {
      const est = Token.estimate(txt)
      if (cap + est > 2000) break
      acc.push(txt)
      cap += est
    }
    return acc.join("\n---\n")
  }

  export function buildSpawnPrompt(base: string, focus?: string, obs?: string): string {
    let prompt = focus ? `${base}\n\n## Focus\nPrioritize observations related to: ${focus}` : base
    if (obs && Token.estimate(obs) > 0) prompt = `${prompt}\n\n## Session Observations\n${obs}`
    return prompt
  }

  async function spawn(focus?: string, obs?: string): Promise<string> {
    if (!sdk) throw new Error("AutoDream SDK not initialized")

    if (!configuredModel) throw new Error("No model configured. Use /dreammodel first")

    const title = focus ? `Dream: ${focus}` : "AutoDream consolidation"
    const res = await sdk.session.create({ title })
    const sessionID = res.data?.id
    if (!sessionID) throw new Error("Failed to create dream session")

    const prompt = buildSpawnPrompt(PROMPT, focus, obs)
    const parts = configuredModel.split("/")
    const providerID = parts[0]
    const modelID = parts.slice(1).join("/")

    log.info("spawning dream session", { sessionID, providerID, modelID })

    // Fire the prompt (returns immediately)
    await sdk.session.promptAsync({
      sessionID,
      model: { providerID, modelID },
      agent: "dream",
      parts: [{ type: "text", text: prompt }],
    })

    // Poll session status until dream finishes
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const res = await sdk.session.status()
        const status = res.data?.[sessionID]
        if (!status || status.type === "idle") {
          log.info("dream session completed", { sessionID })
          return "Dream consolidation completed"
        }
      } catch {
        // status check failed, keep polling
      }
    }

    log.warn("dream session timed out", { sessionID })
    return "Dream consolidation timed out (10 min)"
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

  async function idle(sid: string): Promise<void> {
    const available = await Engram.ensure()
    if (!available) return
    if (!configuredModel) return
    try {
      _dreaming = true
      log.info("idle dream started", { sid })
      const obs = await summaries(sid)
      await spawn(undefined, obs)
      await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })
      log.info("idle dream completed")
    } catch (err) {
      log.error("idle dream failed", { error: err instanceof Error ? err.message : String(err) })
    } finally {
      _dreaming = false
    }
  }

  /** Subscribe to session idle events. Call at app startup. */
  export function init(): () => void {
    return Bus.subscribe(SessionStatus.Event.Idle, (event) => {
      void idle(event.properties.sessionID).catch((err) => {
        log.error("autodream failed", { error: err instanceof Error ? err.message : String(err) })
      })
    })
  }
}
