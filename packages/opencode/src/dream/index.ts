import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Flock } from "../util/flock"
import { Log } from "@/util/log"
import { Engram } from "./engram"
import { Bus } from "../bus"
import { SessionStatus } from "../session/status"
import { Session } from "../session"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"

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
      const raw = await Filesystem.readText(statePath)
      return JSON.parse(raw)
    } catch {
      return { lastConsolidatedAt: 0, lastSessionCount: 0 }
    }
  }

  async function writeState(state: DreamState): Promise<void> {
    await Filesystem.write(statePath, JSON.stringify(state, null, 2))
  }

  // Closure state for throttle
  let lastCheck = 0
  const THROTTLE_MS = 10 * 60 * 1000 // 10 minutes

  // Dreaming state for TUI indicator
  let _dreaming = false
  export function dreaming() {
    return _dreaming
  }

  function countSessionsSince(since: number): number {
    const min = Flag.OPENCODE_AUTODREAM_MIN_SESSIONS
    let count = 0
    for (const session of Session.list({ roots: true })) {
      if (session.time.created > since) count++
      if (count >= min) return count
    }
    return count
  }

  async function isEnabled(): Promise<boolean> {
    try {
      const cfg = await Config.get()
      return cfg.experimental?.autodream === true || Flag.OPENCODE_EXPERIMENTAL_AUTODREAM
    } catch {
      return false
    }
  }

  // SDK client injected from TUI — all Effect-backed calls go through HTTP
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

  async function spawn(focus?: string): Promise<string> {
    if (!sdk) throw new Error("AutoDream SDK not initialized. Open a TUI session first.")

    const cfg = await Config.get()
    const model = cfg.experimental?.autodream_model
    if (!model) throw new Error("No model configured for AutoDream. Set via /dreammodel")

    const title = focus ? `Dream: ${focus}` : "AutoDream consolidation"
    const res = await sdk.session.create({ title })
    const sessionID = res.data?.id
    if (!sessionID) throw new Error("Failed to create dream session")

    const prompt = focus ? `${PROMPT}\n\n## Focus\nPrioritize observations related to: ${focus}` : PROMPT

    log.info("spawning dream session", { sessionID, model })

    await sdk.session.promptAsync({
      sessionID,
      model: { providerID: model.split("/")[0], modelID: model.split("/").slice(1).join("/") },
      agent: "dream",
      parts: [{ type: "text", text: prompt }],
    })

    return "Dream consolidation started"
  }

  /** Manual trigger from /dream command — skips time/session/throttle gates */
  export async function run(focus?: string): Promise<string> {
    const available = await Engram.ensure()
    if (!available) return "Engram not available. Install with: brew install gentleman-programming/tap/engram"

    let lock: Flock.Lease | undefined
    try {
      lock = await Flock.acquire("autodream", { timeoutMs: 100 })
    } catch {
      return "Another dream is already running"
    }

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
      await lock.release()
    }
  }

  /** Auto trigger — full gate chain, fire-and-forget, background session */
  async function execute(): Promise<void> {
    // Gate 1: Feature flag
    if (!(await isEnabled())) return

    // Gate 2: Engram available
    if (!(await Engram.ensure())) return

    // Gate 3: Time threshold
    const state = await readState()
    const minMs = Flag.OPENCODE_AUTODREAM_MIN_HOURS * 60 * 60 * 1000
    if (Date.now() - state.lastConsolidatedAt < minMs) return

    // Gate 4: Scan throttle
    if (Date.now() - lastCheck < THROTTLE_MS) return
    lastCheck = Date.now()

    // Gate 5: Session count
    const count = countSessionsSince(state.lastConsolidatedAt)
    if (count < Flag.OPENCODE_AUTODREAM_MIN_SESSIONS) return

    // Gate 6: Lock
    let lock: Flock.Lease | undefined
    try {
      lock = await Flock.acquire("autodream", { timeoutMs: 0 })
    } catch {
      return // another dream running
    }

    try {
      _dreaming = true
      log.info("autodream started", { sessions: count })
      await spawn()
      await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: count })
      log.info("autodream completed")
    } catch (err) {
      log.error("autodream failed", { error: err instanceof Error ? err.message : String(err) })
      // Don't update state on failure — allows retry next idle
    } finally {
      _dreaming = false
      await lock.release()
    }
  }

  /** Subscribe to session idle events. Call at app startup. */
  export function init(): () => void {
    return Bus.subscribe(SessionStatus.Event.Idle, () => {
      // Fire-and-forget, don't block the idle transition
      void execute().catch((err) => {
        log.error("autodream execute failed", { error: err instanceof Error ? err.message : String(err) })
      })
    })
  }
}
