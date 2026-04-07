import path from "path"
import { Global } from "../global"
import { Log } from "@/util/log"
import { Token } from "../util/token"
import { OM } from "../session/om"
import type { SessionID } from "../session/schema"
import { Instance } from "../project/instance"
import { ensureDaemon, paths as daemonPaths } from "./ensure"
import { Server } from "../server/server"
import { Memory } from "../memory"
import { Flag } from "../flag/flag"

import PROMPT from "./prompt.txt"

export namespace AutoDream {
  const log = Log.create({ service: "autodream" })

  interface DreamState {
    lastConsolidatedAt: number
    lastSessionCount: number
  }

  const statePath = path.join(Global.Path.state, "autodream.json")

  export async function writeState(state: DreamState): Promise<void> {
    await Bun.write(statePath, JSON.stringify(state, null, 2))
  }

  // Dreaming state for TUI indicator
  let _dreaming = false
  export function dreaming() {
    return _dreaming
  }

  export async function status(dir?: string): Promise<{
    dreaming: boolean
    lastCompleted?: number
    lastError?: string
  }> {
    if (!dir) return { dreaming: false }
    const root = dir
    const p = daemonPaths(root)
    const pid = Number(
      await Bun.file(p.pid)
        .text()
        .catch(() => "0"),
    )
    if (!pid) return { dreaming: false }
    try {
      process.kill(pid, 0)
    } catch {
      return { dreaming: false }
    }
    try {
      // @ts-ignore Bun unix socket fetch
      const res = await fetch("http://localhost/status", { unix: p.sock })
      if (!res.ok) return { dreaming: false }
      return (await res.json()) as { dreaming: boolean; lastCompleted?: number; lastError?: string }
    } catch {
      return { dreaming: false }
    }
  }

  export async function summaries(sid: string): Promise<string> {
    const rec = OM.get(sid as SessionID)
    const acc: string[] = []
    if (rec?.current_task) acc.push(`<current-task>\n${rec.current_task}\n</current-task>`)
    if (rec?.reflections) acc.push(`<reflections>\n${rec.reflections}\n</reflections>`)
    if (rec?.observations) acc.push(`<observations>\n${rec.observations}\n</observations>`)
    const txt = acc.join("\n\n")
    if (!txt) return ""
    const est = Token.estimate(txt)
    if (est <= 4000) return txt
    return txt.slice(0, 4000 * 4)
  }

  export function buildSpawnPrompt(base: string, focus?: string, obs?: string): string {
    let prompt = focus ? `${base}\n\n## Focus\nPrioritize observations related to: ${focus}` : base
    if (obs && Token.estimate(obs) > 0) prompt = `${prompt}\n\n## Session Observations\n${obs}`
    return prompt
  }

  /** Manual trigger from /dream command */
  export async function run(focus?: string, dir?: string, serverURL?: string): Promise<string> {
    // Manual dream trigger uses the native daemon path only.
    _dreaming = true
    try {
      const { Config } = await import("../config/config")
      if (!dir) throw new Error("Dream requires an active project directory")
      const cfg = await Instance.provide({
        directory: dir,
        fn: () => Config.get(),
      })
      const model = cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"
      const root = dir
      const url = serverURL ?? Server.url?.toString() ?? process.env.LIGHTCODE_SERVER_URL
      if (!url) throw new Error("Dream requires a running LightCode server URL")
      process.env.LIGHTCODE_SERVER_URL = url
      const sock = await ensureDaemon(root)
      // @ts-ignore — Bun-native unix socket fetch option
      const res = await fetch("http://localhost/trigger", {
        unix: sock,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus, model }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) throw new Error(data.error ?? "Dream trigger failed")
      return "Dream started"
    } catch (err) {
      log.error("dream failed", { error: err instanceof Error ? err.message : String(err) })
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      _dreaming = false
    }
  }

  /**
   * Start the dream daemon for the current project directory.
   * The daemon runs 24/7 with its own internal scheduler (~1h interval).
   * Call at app startup — replaces the old Session.Idle subscriber approach.
   */
  export function startDaemon(): void {
    const dir = Instance.directory
    if (!dir) return
    ensureDaemon(dir).catch((err) => {
      log.warn("failed to start dream daemon at boot", { error: err instanceof Error ? err.message : String(err) })
    })
  }

  /**
   * Write a consolidated observation text to the native LightCode Memory Core.
   *
   * Called after the dream agent completes to persist cross-session memory
   * natively (without Engram MCP) when OPENCODE_DREAM_USE_NATIVE_MEMORY=true.
   *
   * Falls back silently on error — dream consolidation is best-effort.
   */
  export function persistConsolidation(projectId: string, title: string, content: string, topicKey?: string): void {
    if (!Flag.OPENCODE_DREAM_USE_NATIVE_MEMORY) return
    try {
      Memory.indexArtifact({
        scope_type: "project",
        scope_id: projectId,
        type: "observation",
        title,
        content,
        topic_key: topicKey ?? null,
        normalized_hash: null,
        revision_count: 1,
        duplicate_count: 1,
        last_seen_at: null,
        deleted_at: null,
      })
      log.info("dream consolidation persisted to native memory", { projectId, title })
    } catch (err) {
      log.warn("dream consolidation native write failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
