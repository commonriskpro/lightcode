#!/usr/bin/env bun
/**
 * Comprueba si el proceso actual ve el mismo node que fork.opencode.env (mismo criterio que router-embed-ipc).
 *
 * Uso (desde la raíz del repo):
 *   bun scripts/check-router-embed-node.ts
 *
 * Simular entorno mínimo (PATH vacío rompe `bun`; hay que conservarlo o usar ruta absoluta a bun):
 *   env -i HOME="$HOME" PATH="$PATH" USER="${USER:-}" bun scripts/check-router-embed-node.ts
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const forkPath = path.join(root, "fork.opencode.env")

function fromFork(): string | undefined {
  if (!existsSync(forkPath)) return
  for (const line of readFileSync(forkPath, "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    if (!t.startsWith("OPENCODE_ROUTER_EMBED_NODE=")) continue
    let val = t.slice("OPENCODE_ROUTER_EMBED_NODE=".length).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    const stateDefault = path.join(homedir(), ".local/state")
    const xdg = process.env.XDG_STATE_HOME?.trim() || stateDefault
    return val
      .replace(/\$\{HOME\}/g, homedir())
      .replace(/\$HOME\b/g, homedir())
      .replace(/\$\{XDG_STATE_HOME\}/g, xdg)
  }
}

const p = process.env.OPENCODE_ROUTER_EMBED_NODE?.trim() || fromFork()
const exe =
  p &&
  (() => {
    try {
      accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  })()

console.log(
  JSON.stringify(
    {
      HOME: process.env.HOME,
      homedir: homedir(),
      fork_file: forkPath,
      OPENCODE_ROUTER_EMBED_NODE_env: process.env.OPENCODE_ROUTER_EMBED_NODE ?? null,
      resolved_path: p ?? null,
      exists: p ? existsSync(p) : false,
      executable: !!exe,
    },
    null,
    2,
  ),
)

if (p && existsSync(p) && exe) {
  const r = spawnSync(p, ["--version"], { encoding: "utf8", timeout: 8000 })
  console.log(
    JSON.stringify(
      {
        posix_spawn_probe: r.error ? String(r.error) : null,
        status: r.status,
        version_line: (r.stdout ?? r.stderr ?? "").trim().split("\n")[0]?.slice(0, 120),
      },
      null,
      2,
    ),
  )
}
