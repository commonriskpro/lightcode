import path from "path"
import { existsSync, readFileSync } from "fs"

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

/**
 * Loads repo-root `fork.opencode.env` before Global paths. Only sets keys that are not already in `process.env`.
 * Use `__REPO_ROOT__` or `${REPO_ROOT}` in values for the repository root path.
 */
export function loadForkEnvSync() {
  if (process.env.OPENCODE_SKIP_FORK_ENV === "1") return
  const root = repoRootForForkEnv()
  if (!root) return
  const fp = path.join(root, "fork.opencode.env")
  if (!existsSync(fp)) return
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    if (!key || key.startsWith("#")) continue
    if (process.env[key] !== undefined) continue
    let val = t.slice(eq + 1).trim()
    if (!val) continue
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    val = val.replace(/\$\{REPO_ROOT\}/g, root).replace(/__REPO_ROOT__/g, root)
    process.env[key] = val
  }
}
