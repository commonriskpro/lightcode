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
      await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })
      log.info("dream completed")
      return "Dream consolidation triggered"
    } catch (err) {
      log.error("dream failed", { error: err instanceof Error ? err.message : String(err) })
      return `Dream failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      _dreaming = false
      await lock.release()
    }
  }

  /** Auto trigger — full gate chain, fire-and-forget */
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
      await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: count })
      log.info("autodream completed")
    } catch (err) {
      log.error("autodream failed", { error: err instanceof Error ? err.message : String(err) })
    } finally {
      _dreaming = false
      await lock.release()
    }
  }

  /** Subscribe to session idle events. Call at app startup. */
  export function init(): () => void {
    return Bus.subscribe(SessionStatus.Event.Idle, (event) => {
      // Fire-and-forget, don't block the idle transition
      void execute().catch((err) => {
        log.error("autodream execute failed", { error: err instanceof Error ? err.message : String(err) })
      })
    })
  }
}
