import path from "path"
import fs from "fs"
import { spawn } from "node:child_process"
import { Global } from "../global"
import { Hash } from "../util/hash"
import { Log } from "@/util/log"

const log = Log.create({ service: "dream-ensure" })

function slug(dir: string) {
  return Hash.fast(dir).slice(0, 16)
}

export function paths(dir: string) {
  const base = path.join(Global.Path.state, `dream-${slug(dir)}`)
  return { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` }
}

function daemonEntry() {
  const dir = path.dirname(process.execPath)
  const names =
    process.platform === "win32" ? ["lightcode-dream-daemon.exe", "lightcode-dream-daemon"] : ["lightcode-dream-daemon"]
  const hit = names.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file))
  if (!hit) {
    throw new Error(`dream daemon binary not found next to host binary: ${dir}`)
  }
  return hit
}

async function isAlive(pid: number, sock: string): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 500)
    // @ts-ignore — Bun-native unix socket fetch option
    const res = await fetch("http://localhost/ping", { unix: sock, signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

async function spawnDaemon(dir: string, p: ReturnType<typeof paths>) {
  const logFd = fs.openSync(p.log, "a")
  const proc = spawn(daemonEntry(), [], {
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      LIGHTCODE_PROJECT_DIR: dir,
      LIGHTCODE_SOCK_PATH: p.sock,
      LIGHTCODE_PID_PATH: p.pid,
      LIGHTCODE_SERVER_URL: process.env.LIGHTCODE_SERVER_URL ?? "",
    },
  })
  fs.closeSync(logFd)
  proc.unref()
  if (proc.pid) await Bun.write(p.pid, String(proc.pid))
  log.info("spawned dream daemon", { pid: proc.pid, sock: p.sock })
}

export async function ensureDaemon(dir: string): Promise<string> {
  const p = paths(dir)
  const raw = await Bun.file(p.pid)
    .text()
    .catch(() => "0")
  const pid = Number(raw.trim())
  if (pid > 0 && (await isAlive(pid, p.sock))) return p.sock

  // Stale — clean up
  try {
    fs.unlinkSync(p.sock)
  } catch {}
  try {
    fs.unlinkSync(p.pid)
  } catch {}

  await spawnDaemon(dir, p)

  // Poll until ready (100ms × 100 = 10s)
  for (let i = 0; i < 100; i++) {
    await Bun.sleep(100)
    // @ts-ignore — Bun-native unix socket fetch option
    const res = await fetch("http://localhost/ping", { unix: p.sock }).catch(() => null)
    if (res?.ok) return p.sock
  }

  throw new Error("daemon ready timeout")
}
