/**
 * Entry shim for the TUI worker thread.
 *
 * The TUI worker runs as a Bun Worker (separate JS runtime within the same
 * process as the main binary) and transitively imports `@libsql/client`
 * through `Server -> Database`. That import is marked external in
 * `script/build.ts`, so it's resolved at runtime against `process.cwd()`.
 *
 * By the time the worker is spawned, `src/cli/cmd/tui/thread.ts` has already
 * done `process.chdir(next)` to the user's project directory — which means
 * `process.cwd()` no longer points at the binary directory where the sidecar
 * `node_modules/` lives. Without this shim, the worker would crash at
 * startup with:
 *
 *     error: Cannot find module '@libsql/client' from '/$bunfs/root/src/cli/cmd/tui/worker.js'
 *
 * The fix mirrors `src/entry.ts` for the main binary: chdir to the
 * executable directory BEFORE any static import statement runs, then
 * dynamically import the real worker module. The cwd change only affects
 * this worker thread — the main thread keeps whatever cwd it had.
 *
 * The original user cwd is still recoverable from `process.env.PWD` (which
 * `thread.ts` also relies on) and from `process.env.LIGHTCODE_USER_CWD`,
 * both of which are inherited when the parent does `new Worker(file, { env })`.
 */

import path from "path"

// Capture the cwd the parent thread handed us (typically the user's project
// directory — `thread.ts` does `process.chdir(next)` before calling
// `new Worker(...)`). Save it to LIGHTCODE_USER_CWD so userCwd() inside the
// worker can recover it after the chdir below. Skip the assignment if the
// parent already set it; PWD keeps priority anyway.
if (!process.env.LIGHTCODE_USER_CWD) {
  process.env.LIGHTCODE_USER_CWD = process.cwd()
}

process.chdir(path.dirname(process.execPath))

await import("./worker.ts")
