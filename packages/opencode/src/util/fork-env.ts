import path from "path"
import { accessSync, constants as fsConstants, existsSync, readFileSync } from "fs"
import { homedir } from "node:os"

/** Repo root when running the compiled binary under …/dist/opencode-(platform)/bin/. */
export function repoRootFromExecPath(): string | undefined {
  try {
    const execPath = process.execPath
    if (!execPath) return
    const normalized = path.normalize(execPath)
    const needle = `${path.sep}dist${path.sep}opencode-`
    const idx = normalized.indexOf(needle)
    if (idx === -1) return
    const packageRoot = normalized.slice(0, idx)
    return path.resolve(packageRoot, "..", "..")
  } catch {
    return
  }
}

function repoRootForForkEnv(): string | undefined {
  const ex = process.env.OPENCODE_REPO_ROOT
  if (ex) return path.resolve(ex)
  const fromExec = repoRootFromExecPath()
  if (fromExec) return fromExec
  try {
    const cwd = process.cwd()
    if (existsSync(path.join(cwd, "fork.opencode.env"))) return cwd
  } catch {
    return
  }
  return
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

function okExec(p: string) {
  if (!existsSync(p)) return false
  if (process.platform === "win32") return true
  try {
    accessSync(p, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Loads repo-root `fork.opencode.env` before Global paths. Only sets keys that are not already in `process.env`,
 * except `OPENCODE_ROUTER_EMBED_NODE` which always follows the file so IDE env cannot pin a stale path.
 * Use `__REPO_ROOT__` or `${REPO_ROOT}` for repo root; `${HOME}` or `$HOME` for the user home directory.
 */
export function loadForkEnvSync() {
  if (process.env.OPENCODE_SKIP_FORK_ENV === "1") return
  const root = repoRootForForkEnv()
  if (!root) return
  const fp = path.join(root, "fork.opencode.env")
  if (!existsSync(fp)) return
  const home = homeSafe()
  const state = stateSafe(home)
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    if (!key || key.startsWith("#")) continue
    if (process.env[key] !== undefined && key !== "OPENCODE_ROUTER_EMBED_NODE") continue
    let val = t.slice(eq + 1).trim()
    if (!val) continue
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    val = val.replace(/\$\{REPO_ROOT\}/g, root).replace(/__REPO_ROOT__/g, root)
    val = val.replace(/\$\{HOME\}/g, home).replace(/\$HOME\b/g, home)
    val = val.replace(/\$\{XDG_STATE_HOME\}/g, state)
    if (key === "OPENCODE_ROUTER_EMBED_NODE" && !okExec(val)) {
      delete process.env.OPENCODE_ROUTER_EMBED_NODE
      continue
    }
    process.env[key] = val
  }
}
