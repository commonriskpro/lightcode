import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { Log } from "@/util/log"
import { errorMessage } from "@/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { Event } from "@opencode-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { writeHeapSnapshot } from "v8"
import { userCwd } from "@/cli/bootstrap"

declare global {
  const OPENCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
    setWorkspace: (workspaceID) => {
      void client.call("setWorkspace", { workspaceID })
    },
  }
}

async function target() {
  if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve the effective project directory:
      //   - userCwd() returns the user's invocation cwd (recovered from
      //     LIGHTCODE_USER_CWD which the launcher script set before exec).
      //   - --project, if given, is resolved relative to that.
      const root = Filesystem.resolve(userCwd())
      const next = args.project
        ? Filesystem.resolve(path.isAbsolute(args.project) ? args.project : path.join(root, args.project))
        : root

      // Validate the directory exists before going any further. Without
      // this we'd fail later with a confusing error from filesystem code
      // deep inside the bootstrap chain.
      if (!(await Filesystem.isDir(next))) {
        UI.error("Project directory does not exist: " + next)
        return
      }

      // CRITICAL: do NOT do `process.chdir(next)` here.
      //
      // The TUI spawns a Bun Worker (below) that statically imports
      // `Server` -> `Database` -> `@libsql/client`. `@libsql/client` is
      // marked external in `script/build.ts` and ships as a sidecar
      // `node_modules/` next to the binary. Bun's runtime resolver finds
      // that sidecar by looking at `process.cwd()` AT THE MOMENT THE WORKER
      // IS SPAWNED, because the new Worker JS runtime inherits the parent
      // process's cwd. The launcher script (`script/launcher.sh`) cd'd into
      // the binary directory before exec'ing the binary, so the cwd is
      // currently correct — if we chdir to `next` (the user's project)
      // here, the Worker's @libsql/client import will fail with
      //     Cannot find module '@libsql/client' from '/$bunfs/root/...'
      // and the Worker silently dies before answering the RPC `server`
      // call below, leaving the TUI hanging forever on a black screen.
      //
      // Background: this is the same Bun 1.3.4+ external resolution
      // regression as oven-sh/bun#27058 (closed Not planned). It does NOT
      // matter that the main thread already imported @libsql/client
      // successfully — Bun Workers are isolated runtimes with their own
      // module graph, so they re-resolve externals from scratch with the
      // current cwd.
      //
      // The project directory is communicated to the worker via:
      //   - LIGHTCODE_USER_CWD env var (read by userCwd() in the worker)
      //   - The `cwd` variable passed to TuiConfig.get(), tui(), and
      //     server.routing via Instance.provide({ directory: cwd })
      // No call site inside the TUI or worker reads `process.cwd()`
      // expecting the project directory; everything goes through
      // `Instance.directory` (the AsyncLocalStorage) or this `cwd` string.
      const cwd = next

      // Set LIGHTCODE_USER_CWD to the resolved project directory so the
      // worker (which inherits the parent's env) recovers it via userCwd().
      // If the user passed --project foo, this overrides whatever the
      // launcher script originally set, so the worker sees the resolved
      // project, not the user's original invocation cwd.
      process.env.LIGHTCODE_USER_CWD = cwd

      const file = await target()
      const worker = new Worker(file, {
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      })
      worker.onerror = (e) => {
        Log.Default.error(e)
      }

      const client = Rpc.client<typeof rpc>(worker)
      const error = (e: unknown) => {
        Log.Default.error(e)
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("worker reload failed", {
            error: errorMessage(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      let stopped = false
      let exiting = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)
        process.off("SIGINT", interrupt)
        process.off("SIGTERM", terminate)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((error) => {
          Log.Default.warn("worker shutdown failed", {
            error: errorMessage(error),
          })
        })
        worker.terminate()
      }

      const exit = async (signal: "SIGINT" | "SIGTERM") => {
        if (exiting) return
        exiting = true
        Log.Default.info("tui signal received", { signal })
        await stop()
        process.exit(signal === "SIGINT" ? 130 : 143)
      }
      const interrupt = () => {
        void exit("SIGINT")
      }
      const terminate = () => {
        void exit("SIGTERM")
      }
      process.on("SIGINT", interrupt)
      process.on("SIGTERM", terminate)

      const prompt = await input(args.prompt)
      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      const network = await resolveNetworkOptions(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      const serverUrl = external
        ? (await client.call("server", network)).url
        : (await client.call("server", { port: 0, hostname: "127.0.0.1" })).url

      process.env.LIGHTCODE_SERVER_URL = serverUrl

      const transport = external
        ? {
            url: serverUrl,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: "http://opencode.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      try {
        await tui({
          url: transport.url,
          async onSnapshot() {
            const tui = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tui, server]
          },
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            sessionID: args.session,
            agent: args.agent,
            model: args.model,
            prompt,
            fork: args.fork,
          },
        })
      } finally {
        await stop()
      }
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
