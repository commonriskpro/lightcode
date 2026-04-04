import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Flock } from "../util/flock"
import { Log } from "@/util/log"
import { Engram } from "./engram"

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
      log.info("dream started", { focus })
      await writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })
      log.info("dream completed")
      return "Dream consolidation triggered"
    } catch (err) {
      log.error("dream failed", { error: err instanceof Error ? err.message : String(err) })
      return `Dream failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      await lock.release()
    }
  }
}
