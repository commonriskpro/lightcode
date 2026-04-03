import { accessSync, constants as fsConstants, existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Log } from "../util/log"
import type { IntentPrototype } from "./router-embed-impl"
import { emitRouterEmbedStatus } from "./router-embed-status"

const log = Log.create({ service: "router-embed" })

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void }

let nextId = 1
const pending = new Map<number, Pending>()
let buf = ""
let child: ChildProcess | null = null
let tail: Promise<void> = Promise.resolve()
let firstRpc = true
let lastSpawnErr: string | undefined

function modelFromPayload(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "model" in payload) {
    const m = (payload as { model: unknown }).model
    if (typeof m === "string") return m
  }
}

function pkgRoot() {
  return path.join(fileURLToPath(new URL(".", import.meta.url)), "../..")
}

function pkgCandidates() {
  const out = [pkgRoot()]
  const env = process.env.OPENCODE_REPO_ROOT?.trim()
  if (env) {
    out.push(path.join(env, "packages/opencode"))
    out.push(env)
  }
  out.push(path.join(process.cwd(), "packages/opencode"))
  out.push(process.cwd())
  return [...new Set(out.map((x) => path.resolve(x)))]
}

function workerTarget() {
  for (const root of pkgCandidates()) {
    const worker = path.join(root, "script/router-embed-worker.ts")
    if (existsSync(worker)) return { root, worker }
  }
  const root = pkgRoot()
  return { root, worker: path.join(root, "script/router-embed-worker.ts") }
}

function okExecutable(p: string) {
  if (!existsSync(p)) return false
  if (process.platform === "win32") return true
  try {
    accessSync(p, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveExecutable(p: string) {
  if (!okExecutable(p)) return
  try {
    const canon = realpathSync(p)
    // realpath() turns Home Manager / nix-profile symlinks into /nix/store/<hash>/... — that hash can be GC'd later.
    // Keep the profile path so execve resolves the symlink at spawn time (same as `node` in a shell).
    if (canon.startsWith("/nix/store/") && !p.startsWith("/nix/store/")) {
      return p
    }
    return canon
  } catch {
    return p
  }
}

function homeSafe() {
  const env = process.env.HOME?.trim()
  if (env && path.isAbsolute(env) && existsSync(env)) return env
  const dir = homedir()
  if (dir && path.isAbsolute(dir) && existsSync(dir)) return dir
  return dir || env || ""
}

function stateSafe(home: string) {
  const env = process.env.XDG_STATE_HOME?.trim()
  if (env && path.isAbsolute(env) && existsSync(env)) return env
  return path.join(home, ".local/state")
}

/** Inherited env (IDE, shell) may pin a dead /nix/store hash — strip so nodeBinary() resolves a stable path. */
;(function stripBrittleEmbedNodeEnv() {
  const v = process.env.OPENCODE_ROUTER_EMBED_NODE?.trim()
  if (!v) return
  if (!okExecutable(v) || v.startsWith("/nix/store/")) {
    delete process.env.OPENCODE_ROUTER_EMBED_NODE
  }
})()

/** `command -v node` with current env (respects PATH from nix-shell, direnv, etc.). */
function nodeFromPathLookup() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where.exe", ["node"], {
        encoding: "utf8",
        timeout: 4000,
        env: process.env,
      })
      const line = out.trim().split(/\r?\n/)[0]
      if (line) return resolveExecutable(line)
      return
    }
    const out = execFileSync("/bin/sh", ["-c", "command -v node"], {
      encoding: "utf8",
      timeout: 4000,
      env: process.env,
    })
    const line = out.trim().split("\n")[0]
    if (line) return resolveExecutable(line)
  } catch {
    return
  }
}

/** Login shell profile (e.g. Home Manager PATH) when non-interactive env is empty. */
function nodeFromLoginShell() {
  if (process.platform === "win32") return
  try {
    const out = execFileSync("/bin/sh", ["-lc", "command -v node"], {
      encoding: "utf8",
      timeout: 6000,
      env: process.env,
    })
    const line = out.trim().split("\n")[0]
    if (line) return resolveExecutable(line)
  } catch {
    return
  }
}

/** IPC worker must run under Node (onnxruntime-node). */
function nodeBinary() {
  const home = homeSafe()
  const fromEnv = process.env.OPENCODE_ROUTER_EMBED_NODE?.trim()
  if (fromEnv) {
    const r = resolveExecutable(fromEnv)
    if (r) return r
    log.warn("router_embed_node_missing", { path: fromEnv })
    delete process.env.OPENCODE_ROUTER_EMBED_NODE
  }
  const state = stateSafe(home)
  for (const raw of [
    path.join(state, "nix/profiles/home-manager/home-path/bin/node"),
    path.join(home, ".nix-profile/bin/node"),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ]) {
    const r = resolveExecutable(raw)
    if (r) return r
  }
  const w = nodeFromPathLookup()
  if (w) return w
  const l = nodeFromLoginShell()
  if (l) return l
  log.warn("router_embed_node_fallback", { message: "using bare node from PATH" })
  return "node"
}

function spawnEnvForNode(resolved: string) {
  const env = { ...process.env }
  const prior = process.env.OPENCODE_ROUTER_EMBED_NODE?.trim()
  if (prior && !resolveExecutable(prior)) {
    delete env.OPENCODE_ROUTER_EMBED_NODE
  }
  if (path.isAbsolute(resolved) && !resolved.startsWith("/nix/store/")) {
    env.OPENCODE_ROUTER_EMBED_NODE = resolved
  }
  return env
}

function ensureChild(): ChildProcess | null {
  if (child && child.exitCode === null && !child.killed) return child

  const target = workerTarget()
  if (!existsSync(target.root)) {
    const err = new Error(`router_embed_root_missing:${target.root}`)
    lastSpawnErr = String(err)
    log.warn("router_embed_ipc_spawn", { message: String(err) })
    for (const [, q] of pending) q.reject(err)
    pending.clear()
    return null
  }
  if (!existsSync(target.worker)) {
    const err = new Error(`router_embed_worker_missing:${target.worker}`)
    lastSpawnErr = String(err)
    log.warn("router_embed_ipc_spawn", { message: String(err) })
    for (const [, q] of pending) q.reject(err)
    pending.clear()
    return null
  }
  const node = nodeBinary()

  const c = spawn(node, ["--import", "tsx", target.worker], {
    cwd: target.root,
    stdio: ["pipe", "pipe", "pipe"],
    env: spawnEnvForNode(node),
  })

  buf = ""
  c.stdout?.on("data", (data: Buffer) => {
    buf += data.toString()
    let idx = 0
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string }
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (!p) continue
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error ?? "router_embed_ipc"))
    }
  })

  c.stderr?.on("data", (d: Buffer) => {
    log.info("router_embed_ipc_stderr", { chunk: d.toString().slice(0, 500) })
  })

  c.on("error", (e) => {
    log.warn("router_embed_ipc_spawn", { message: String(e) })
    lastSpawnErr = String(e)
    child = null
    for (const [, q] of pending) q.reject(e)
    pending.clear()
  })

  c.on("exit", (code, signal) => {
    log.info("router_embed_ipc_exit", { code, signal })
    lastSpawnErr = `router_embed_ipc_exit:${code}`
    child = null
    const err = new Error(`router_embed_ipc_exit:${code}`)
    for (const [, q] of pending) q.reject(err)
    pending.clear()
  })

  lastSpawnErr = undefined
  child = c
  return c
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = tail.then(() => fn())
  tail = next.then(
    () => {},
    () => {},
  )
  return next
}

async function rpc(method: string, payload: unknown): Promise<unknown> {
  const m = modelFromPayload(payload)
  return enqueue(async () => {
    const start = performance.now()
    if (firstRpc) emitRouterEmbedStatus({ phase: "loading", model: m })
    const c = ensureChild()
    if (!c?.stdin) {
      const msg = lastSpawnErr || "router_embed_ipc_no_child"
      log.warn("router_embed_ipc_no_child", { message: msg })
      emitRouterEmbedStatus({ phase: "error", model: m, message: msg })
      throw new Error(msg)
    }
    const id = nextId++
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        c.stdin!.write(JSON.stringify({ id, method, payload }) + "\n")
      })
      if (firstRpc) {
        firstRpc = false
        emitRouterEmbedStatus({ phase: "ready", model: m })
      }
      log.info("router_embed_ipc_rpc", {
        method,
        model: m,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      })
      return result
    } catch (e) {
      log.warn("router_embed_ipc_rpc_failed", {
        method,
        model: m,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
        message: String(e),
      })
      emitRouterEmbedStatus({ phase: "error", model: m, message: String(e) })
      firstRpc = true
      throw e
    }
  })
}

function killChild() {
  if (child && !child.killed) child.kill("SIGTERM")
  child = null
}

process.on("exit", killChild)
process.on("SIGINT", () => {
  killChild()
  process.exit(130)
})
process.on("SIGTERM", () => {
  killChild()
  process.exit(143)
})

export function shutdownRouterEmbedIpc() {
  killChild()
}

export async function classifyIntentEmbed(input: {
  userText: string
  model: string
  minScore: number
  prototypes: IntentPrototype[]
}) {
  try {
    const raw = (await rpc("classifyIntentEmbed", {
      userText: input.userText,
      model: input.model,
      minScore: input.minScore,
      prototypes: input.prototypes,
    })) as { label: string; score: number; added: string[] } | null
    if (raw === null) return undefined
    return raw
  } catch (e) {
    log.warn("router_intent_embed_failed", { message: String(e) })
    return undefined
  }
}

export async function classifyIntentEmbedMerged(input: {
  userText: string
  model: string
  minScore: number
  prototypes: IntentPrototype[]
  margin?: number
  maxIntents?: number
  conversationGap?: number
}) {
  try {
    const raw = (await rpc("classifyIntentEmbedMerged", {
      userText: input.userText,
      model: input.model,
      minScore: input.minScore,
      prototypes: input.prototypes,
      margin: input.margin,
      maxIntents: input.maxIntents,
      conversationGap: input.conversationGap,
    })) as {
      primary: string
      score: number
      merged: string[]
      labels: string[]
      conversationExclusive: boolean
    } | null
    if (raw === null) return undefined
    return raw
  } catch (e) {
    log.warn("router_intent_embed_merged_failed", { message: String(e) })
    return undefined
  }
}

export async function augmentMatchedEmbed(input: {
  userText: string
  matched: Set<string>
  allowedBuiltin: Set<string>
  model: string
  topK: number
  minScore: number
  intentLabel?: string
  exactMatch?: import("./router-exact-match").ExactMatchFlags
  auto?: {
    enabled: boolean
    ratio: number
    tokenBudget: number
    maxCap: number
  }
  rerank?: {
    enabled: boolean
    candidates: number
    semanticWeight: number
    lexicalWeight: number
  }
  phraseFor: (id: string) => string
}) {
  const candidates = [...input.allowedBuiltin].filter((id) => !input.matched.has(id))
  if (candidates.length === 0) {
    log.info("router_embed_skip", { reason: "no_candidates" })
    return undefined
  }
  const phrases = Object.fromEntries(candidates.map((id) => [id, input.phraseFor(id)]))
  try {
    const raw = (await rpc("augmentMatchedEmbed", {
      userText: input.userText,
      matched: [...input.matched],
      allowedBuiltin: [...input.allowedBuiltin],
      model: input.model,
      topK: input.topK,
      minScore: input.minScore,
      intentLabel: input.intentLabel,
      exactMatch: input.exactMatch,
      auto: input.auto,
      rerank: input.rerank,
      phrases,
    })) as { added: string[]; note?: string } | null
    if (raw === null) return undefined
    return raw
  } catch (e) {
    log.warn("router_embed_failed", { message: String(e) })
    return undefined
  }
}
