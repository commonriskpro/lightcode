import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "opencode"

function inferFromExecPath(): string | undefined {
  const off = process.env.OPENCODE_DISABLE_PORTABLE_INFER?.toLowerCase()
  if (off === "true" || off === "1") return
  try {
    const execPath = process.execPath
    if (!execPath) return
    const normalized = path.normalize(execPath)
    const needle = `${path.sep}dist${path.sep}opencode-`
    const idx = normalized.indexOf(needle)
    if (idx === -1) return
    const packageRoot = normalized.slice(0, idx)
    const repoRoot = path.resolve(packageRoot, "..", "..")
    return path.join(repoRoot, ".local-opencode")
  } catch {
    return
  }
}

/** Self-contained mode: all app data under one tree (no XDG / ~/.config). */
export function portableRoot(): string | undefined {
  const ex = process.env.OPENCODE_PORTABLE_ROOT
  if (ex) return path.resolve(ex)
  const p = process.env.OPENCODE_PORTABLE?.toLowerCase()
  if (p === "true" || p === "1") return path.join(process.cwd(), ".local-opencode")
  return inferFromExecPath()
}

function basePaths() {
  const r = portableRoot()
  if (r) {
    return {
      data: path.join(r, "data", app),
      cache: path.join(r, "cache", app),
      config: path.join(r, "config", app),
      state: path.join(r, "state", app),
    }
  }
  return {
    data: path.join(xdgData!, app),
    cache: path.join(xdgCache!, app),
    config: path.join(xdgConfig!, app),
    state: path.join(xdgState!, app),
  }
}

const base = basePaths()

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data: base.data,
    bin: path.join(base.cache, "bin"),
    log: path.join(base.data, "log"),
    cache: base.cache,
    config: base.config,
    state: base.state,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
