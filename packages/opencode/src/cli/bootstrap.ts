import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

/**
 * Returns the working directory the user was in when they invoked the CLI.
 *
 * The compiled binary needs to resolve native deps (@libsql/client, fastembed)
 * from a `node_modules/` sidecar that lives next to the executable. To make
 * that resolution work reliably — even when the binary is invoked via a
 * symlink from an unrelated cwd — `src/entry.ts` does an early `chdir()` into
 * the binary directory BEFORE any import of `src/index.ts` runs. That chdir
 * means `process.cwd()` no longer reflects where the user actually was.
 *
 * This helper recovers the original cwd in this priority order:
 *   1. `process.env.PWD` — POSIX-standard, preserved across `chdir()` because
 *      the shell populates it at process spawn time. Also keeps the
 *      non-resolved path (e.g. `/tmp` instead of `/private/tmp` on macOS),
 *      which matches user intent better than `process.cwd()` did before.
 *   2. `process.env.LIGHTCODE_USER_CWD` — set by the entry shim right before
 *      `chdir()`. This is the fallback for environments where the shell
 *      didn't set `PWD` (cron, systemd units, `env -i`, some containers).
 *   3. `process.cwd()` — final fallback for dev mode (`bun run dev`) and
 *      tests where the entry shim never ran.
 */
export function userCwd(): string {
  return process.env.PWD ?? process.env.LIGHTCODE_USER_CWD ?? process.cwd()
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
