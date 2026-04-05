# Design: autodream-daemon

## Overview

AutoDream moves from an in-process SDK-injection pattern to a detached OS daemon reachable over a Unix domain socket. The UI process calls `ensureDaemon(projectDir)` — which lazily spawns, single-instance-enforces, and returns a socket path — then sends a single HTTP POST. Everything after that is the daemon's responsibility and survives UI close.

---

## Section 1 — File Layout

```
src/dream/
  index.ts     ← modified: remove sdk, simplify idle() and run()
  ensure.ts    ← new: daemon lifecycle manager
  daemon.ts    ← new: HTTP server + idle timer + SIGTERM handler
  engram.ts    ← unchanged
  prompt.txt   ← unchanged
```

---

## Section 2 — Socket, PID, and Log Paths

All runtime files live in `Global.Path.state` (XDG state dir, e.g. `~/.local/state/lightcode/`).

The 16-character hex hash is derived from the absolute project directory path:

```ts
import { Hash } from "../util/hash"
import { Global } from "../global"
import path from "path"

function slug(dir: string) {
  return Hash.fast(dir).slice(0, 16)
}

function paths(dir: string) {
  const base = path.join(Global.Path.state, `dream-${slug(dir)}`)
  return { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` }
}
```

**Why 16 chars**: SHA-1 hex gives 40 chars. 16 gives 64-bit collision space — sufficient for a single workstation. The full path stays well under the 104-char Unix socket path limit (Linux) and 104-char limit (macOS).

**Example**: project at `/home/alice/myapp` →

- sock: `~/.local/state/lightcode/dream-a3f2c1d4e5b67890.sock`
- pid: `~/.local/state/lightcode/dream-a3f2c1d4e5b67890.pid`
- log: `~/.local/state/lightcode/dream-a3f2c1d4e5b67890.log`

---

## Section 3 — Spawn Mechanism

**Why `node:child_process.spawn` (not `Bun.spawn`)**: Bun's native `Bun.spawn` does not support `detached: true` as of Bun 1.x. The existing codebase already uses `cross-spawn` (via `Process.spawn`) for child processes, and `cross-spawn-spawner.ts:376` already passes `detached: process.platform !== "win32"`. We follow the same pattern.

**Exact spawn call** (inside `ensure.ts`):

```ts
import { spawn } from "node:child_process"
import fs from "fs"

async function spawnDaemon(dir: string, p: { sock: string; pid: string; log: string }) {
  const logFd = fs.openSync(p.log, "a")
  const proc = spawn(process.execPath, [daemonEntry()], {
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      LIGHTCODE_PROJECT_DIR: dir,
      LIGHTCODE_SOCK_PATH: p.sock,
      LIGHTCODE_PID_PATH: p.pid,
      LIGHTCODE_SERVER_URL: process.env.LIGHTCODE_SERVER_URL ?? "",
    },
  })
  fs.closeSync(logFd)
  proc.unref()
  await Bun.write(p.pid, String(proc.pid))
}
```

- **`detached: true`**: creates a new process group (OS calls `setsid()` internally). The daemon ignores SIGHUP when the parent terminal closes.
- **`proc.unref()`**: tells Node/Bun's event loop not to wait for this child. The parent can exit freely.
- **`stdio: ['ignore', logFd, logFd]`**: daemon's stdout and stderr go to the log file (append mode). Using a pre-opened fd avoids a race window where the file descriptor is closed before `exec`.
- **`daemonEntry()`**: returns the path to the compiled daemon entry file. At runtime this is `process.execPath` (the Bun binary) with the daemon source path as argument. The daemon module is identified by `__filename` comparison at startup; if `process.env.LIGHTCODE_SOCK_PATH` is set, the module auto-starts as daemon.

**Why NOT `Process.spawn` from `util/process.ts`**: That wrapper uses `cross-spawn` which always waits for exit and does not call `unref()`. It is designed for short-lived child processes.

---

## Section 4 — Daemon HTTP API

The daemon runs `Bun.serve({ unix: sockPath })`. All requests use HTTP/1.1 over the Unix socket.

| Method | Path       | Request Body                         | Response                                                            | Description                                          |
| ------ | ---------- | ------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET`  | `/ping`    | —                                    | `{ ok: true, pid: number }`                                         | Liveness check. Also resets idle timer.              |
| `POST` | `/trigger` | `{ focus?: string, model?: string }` | `{ ok: true }` or `{ ok: false, error: string }`                    | Fire a dream. Returns immediately; dream runs async. |
| `GET`  | `/status`  | —                                    | `{ dreaming: boolean, lastCompleted?: number, lastError?: string }` | Current daemon state for TUI indicator.              |

All routes reset the idle timer on receipt. Routes respond with `Content-Type: application/json`.

**Caller side** (in `ensure.ts` and `index.ts`):

```ts
// Ping
const res = await fetch("http://localhost/ping", { unix: sockPath })

// Trigger
await fetch("http://localhost/trigger", {
  unix: sockPath,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ focus, model }),
})
```

Note: `fetch` with `{ unix }` is Bun-native. The `http://localhost` URL is a placeholder; the actual transport is the Unix socket. The daemon only binds to the socket, never to a TCP port.

---

## Section 5 — Idle Timer and Self-Termination

The daemon maintains a single `NodeJS.Timeout` (`let timer: ReturnType<typeof setTimeout>`).

**On each incoming request**: `clearTimeout(timer); timer = setTimeout(shutdown, 10 * 60 * 1000)`

**`shutdown()` function**:

1. Remove socket file: `fs.unlinkSync(sockPath)` (catch errors — may already be gone)
2. `process.exit(0)`

**SIGTERM handler** (registered at startup):

```ts
process.on("SIGTERM", () => {
  try {
    fs.unlinkSync(sockPath)
  } catch {}
  process.exit(0)
})
```

The PID file is intentionally NOT deleted by the daemon on exit. The next `ensureDaemon` call detects staleness via `process.kill(pid, 0)` and cleans it. This avoids a TOCTOU race where two processes both think they need to spawn.

---

## Section 6 — How the Daemon Creates Dream Sessions

The daemon does not import `index.ts` or use `Session` / `Bus` directly. It communicates with the running LightCode server via HTTP.

**Server URL**: passed as `LIGHTCODE_SERVER_URL` env var when spawned (e.g. `http://127.0.0.1:4242`). The main process sets this env var from its own server address before spawning.

**Dream session flow inside daemon** (on `POST /trigger`):

1. Parse `{ focus?, model }` from request body
2. `POST ${serverURL}/session` with `{ title: focus ? "Dream: ${focus}" : "AutoDream consolidation" }` → get `sessionID`
3. Build prompt: `AutoDream.buildSpawnPrompt(PROMPT, focus, obs)` (daemon imports `buildSpawnPrompt` from `index.ts` — pure function, no side effects)
4. `POST ${serverURL}/session/${sessionID}/prompt` with `{ model, agent: "dream", parts: [{ type: "text", text: prompt }] }` → fire async
5. Poll `GET ${serverURL}/session/status` every 2s for up to 10 minutes until `status[sessionID]` is `idle` or absent
6. On completion: call `AutoDream.writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })`

**On server unreachable**: retry with exponential backoff (100ms → 200ms → 400ms → ...) for up to 30 seconds. After 30s, log and return `{ ok: false, error: "server unavailable" }`. The daemon stays alive.

**Daemon state**:

```ts
let dreaming = false
let lastCompleted: number | undefined
let lastError: string | undefined
```

`POST /trigger` returns `{ ok: true }` immediately and runs the dream asynchronously. If a dream is already running, a second `/trigger` is queued (or dropped, at implementer's discretion — dropping is simpler and acceptable).

---

## Section 7 — Graceful Degradation

`ensureDaemon()` is async and may throw. Both `idle()` and `run()` wrap it:

```ts
// idle()
async function idle(sid: string) {
  const available = await Engram.ensure()
  if (!available) return
  const { Config } = await import("../config/config")
  const cfg = await Config.get()
  if (cfg.experimental?.autodream === false) return
  const model = cfg.experimental?.autodream_model ?? "google/gemini-2.5-flash"
  try {
    const sock = await ensureDaemon(Instance.directory)
    const obs = await summaries(sid)
    await fetch("http://localhost/trigger", {
      unix: sock,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, obs }),
    })
  } catch (err) {
    log.warn("autodream daemon unavailable", { error: err instanceof Error ? err.message : String(err) })
  }
}
```

If `ensureDaemon` throws (daemon won't start, ready-poll times out, spawn error) the warning is logged and the function returns. LightCode continues normally. No crash, no user-visible error.

---

## Section 8 — Migration: Remove SDK Injection

The `sdk` injection pattern was needed because the in-process `AutoDream.spawn()` needed to call `sdk.session.create()` etc. via the TypeScript SDK client. With the daemon, these calls go directly to the HTTP server.

**Items to remove from `src/dream/index.ts`**:

- `interface SDKClient { ... }` — delete
- `let sdk: SDKClient | undefined` — delete
- `export function setSDK(client: SDKClient)` — delete
- `export function setModel(model: string | undefined)` — delete
- `let configuredModel: string | undefined` — delete (model now read from config inside `idle()`)
- `async function spawn(...)` — delete (daemon handles session creation)

**Grep for call sites**:

```
AutoDream.setSDK    — in test/dream/autodream.test.ts only (confirmed via search)
AutoDream.setModel  — in test/dream/autodream.test.ts only
```

Both call sites are in the test file. The test file must also be updated to remove these tests and add new `ensureDaemon` unit tests.

**`src/project/bootstrap.ts`**: No change. `AutoDream.init()` still subscribes to `SessionStatus.Event.Idle`. The call signature is unchanged.

---

## Section 9 — Sequence Diagram: First Idle Event

```
UI process                    ensure.ts            daemon.ts (new process)
    |                             |                        |
    |-- idle(sid) --------------->|                        |
    |                             |-- read PID file        |
    |                             |   (not found)          |
    |                             |-- spawn(node, daemon)--|---------> OS process
    |                             |   detached, unref      |         (setsid, new PID)
    |                             |-- write PID file       |                |
    |                             |                        |<-- Bun.serve({unix: sock})
    |                             |-- poll /ping (100ms)---|-- responds { ok, pid }
    |                             |   (ready)              |                |
    |<-- return sockPath ---------|                        |                |
    |-- fetch POST /trigger ------|---------------------> [http over unix]  |
    |<-- { ok: true } -----------|<--------------------- immediate response|
    |   (returns)                 |                        |                |
    |   UI may close              |                   dream session poll    |
    |                             |                   (10 min max)          |
    |                             |                        |<-- session idle |
    |                             |                   writeState()          |
    |                             |                        |           done |
```

---

## Section 10 — Test Plan

| Test file                      | Coverage                                                    |
| ------------------------------ | ----------------------------------------------------------- |
| `test/dream/ensure.test.ts`    | `ensureDaemon` returns existing sock when daemon alive      |
| `test/dream/ensure.test.ts`    | `ensureDaemon` cleans stale PID and spawns new daemon       |
| `test/dream/ensure.test.ts`    | `ensureDaemon` ready-poll times out after 10s → throws      |
| `test/dream/ensure.test.ts`    | `paths()` produces correct sock/pid/log paths for given dir |
| `test/dream/autodream.test.ts` | `setSDK` / `setModel` tests deleted                         |
| `test/dream/autodream.test.ts` | `idle()` logs warning when `ensureDaemon` throws            |
| `test/dream/autodream.test.ts` | `dreaming()` stays false when daemon unavailable            |
