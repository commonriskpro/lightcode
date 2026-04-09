/**
 * Entry shim for the compiled binary.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The compiled binary needs native modules (`@libsql/client`, `fastembed`)
 * that Bun's `--compile` cannot bundle into the virtual `/$bunfs/root/` FS
 * because they include `.node`/`.dylib` addons that the OS loader requires
 * on a real disk path. Those modules are shipped as a "sidecar":
 * `dist/<target>/bin/node_modules/` lives next to the `lightcode` binary.
 *
 * Bun resolves externalized modules against `process.cwd()` at runtime, NOT
 * against `path.dirname(process.execPath)`. That means if the user runs
 * `lightcode` via a symlink from an unrelated working directory:
 *
 *     $ cd /some/project
 *     $ lightcode   # symlink -> /path/to/dist/.../bin/lightcode
 *
 * Bun looks for `node_modules/@libsql/client` in `/some/project`, doesn't
 * find it, and crashes with:
 *
 *     error: Cannot find module '@libsql/client' from '/$bunfs/root/src/index.js'
 *
 * This shim runs BEFORE any import of `src/index.ts` (and therefore before
 * any transitive import of `@libsql/client`) and does three things:
 *
 *   1. Save the original `cwd` to `process.env.LIGHTCODE_USER_CWD`, so the
 *      rest of the app can recover it even in environments where `PWD` is
 *      missing. (`PWD` survives `chdir()` because the shell sets it at
 *      spawn time — see `Paths.userCwd()` in `src/cli/bootstrap.ts`.)
 *   2. `chdir()` into the directory containing the executable, so Bun's
 *      external module resolver finds the sidecar `node_modules/`.
 *   3. Dynamically import `src/index.ts`, which triggers the rest of the
 *      app AFTER the chdir has taken effect. Must be `await import(...)`
 *      because static `import` statements are hoisted and evaluated before
 *      any of the code above would run.
 *
 * UX IMPACT
 * ---------
 * None visible to the user. All CLI entrypoints read the original cwd via
 * `userCwd()` from `src/cli/bootstrap.ts`, so `lightcode` keeps operating
 * on the directory the user was in — exactly like opencode upstream (which
 * doesn't need this shim because it uses `bun:sqlite`, a built-in module
 * that doesn't require a sidecar).
 *
 * DEV MODE
 * --------
 * In `bun run dev` (uncompiled) this file is not used as an entrypoint —
 * `src/index.ts` is the entry directly. That's fine: dev mode doesn't have
 * a sidecar problem because `@libsql/client` resolves from the normal
 * `node_modules/` next to `package.json`.
 */

import path from "path"

process.env.LIGHTCODE_USER_CWD = process.cwd()
process.chdir(path.dirname(process.execPath))

await import("./index.ts")
