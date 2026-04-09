/**
 * Entry shim for the `lightcode-dream-daemon` compiled binary.
 *
 * Same reason as `src/entry.ts` for the main binary: the daemon imports
 * `@libsql/client` transitively via `Database` (see `daemon.ts:2`), and that
 * module is externalized in `script/build.ts`. Bun resolves externals at
 * runtime against `process.cwd()`, not against `path.dirname(process.execPath)`,
 * so when the daemon is spawned from an arbitrary working directory it must
 * first chdir into its own binary directory to find the sidecar
 * `node_modules/`.
 *
 * The parent (`src/dream/ensure.ts`) spawns the daemon without overriding
 * `cwd`, so the daemon inherits the parent's cwd at spawn time. That cwd may
 * or may not have a sidecar, so we can't rely on it. Instead, we unconditionally
 * chdir into `path.dirname(process.execPath)`.
 *
 * Unlike the main binary, the daemon doesn't need to recover a "user cwd"
 * later: it receives the project directory via the `LIGHTCODE_PROJECT_DIR`
 * env var set by `ensure.ts`. But we still save the pre-chdir cwd to
 * `LIGHTCODE_USER_CWD` for symmetry and for any helper that reaches for
 * `userCwd()` (none today, but future-proof).
 */

import path from "path"

if (!process.env.LIGHTCODE_USER_CWD) {
  process.env.LIGHTCODE_USER_CWD = process.cwd()
}

process.chdir(path.dirname(process.execPath))

await import("./daemon.ts")
