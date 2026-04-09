import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

/**
 * Returns the working directory the user was in when they invoked the CLI.
 *
 * The compiled binary needs to resolve native deps (@libsql/client, fastembed)
 * from a `node_modules/` sidecar that lives next to the executable. The
 * launcher script (`script/launcher.sh`, generated into
 * `dist/<target>/bin/lightcode-launcher.sh` by `script/build.ts`) handles
 * that by `cd`-ing into the binary directory BEFORE exec'ing the binary, so
 * Bun's runtime resolver finds the sidecar. As a side effect of that `cd`,
 * `process.cwd()` inside the binary is the binary directory, NOT where the
 * user was when they ran `lightcode`. This helper recovers it.
 *
 * Priority order (matters for correctness):
 *   1. `process.env.LIGHTCODE_USER_CWD` — set explicitly by the launcher
 *      script before its `cd`. This is THE source of truth in compiled mode.
 *      It is also re-set by `cli/cmd/tui/thread.ts` after `process.chdir(next)`
 *      so the TUI worker (which inherits the env) sees the resolved
 *      project directory when `--project foo` is used.
 *   2. `process.env.PWD` — POSIX-standard. Used in dev mode (`bun run dev`)
 *      where there's no launcher and `PWD` is set by the shell. In compiled
 *      mode, the launcher's `cd` makes the shell update `PWD` to the binary
 *      directory before exec, and most shells reset `PWD` on startup if it
 *      disagrees with the real cwd, so we cannot trust `PWD` in that mode —
 *      that's why `LIGHTCODE_USER_CWD` has higher priority.
 *   3. `process.cwd()` — final fallback for tests or any context where neither
 *      env var was set.
 */
export function userCwd(): string {
  return process.env.LIGHTCODE_USER_CWD ?? process.env.PWD ?? process.cwd()
}

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
