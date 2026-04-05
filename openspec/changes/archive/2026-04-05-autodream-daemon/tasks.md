# Tasks: autodream-daemon

## Phase 1 — New file: `src/dream/ensure.ts`

- [x] **T-1.1** Create `src/dream/ensure.ts` with `paths(dir)` helper:
  - Imports `Hash` from `../util/hash`, `Global` from `../global`, `path` from `path`
  - Returns `{ sock, pid, log }` using `Hash.fast(dir).slice(0, 16)` as slug
  - All paths under `Global.Path.state` with prefix `dream-<slug>`

- [x] **T-1.2** Add `daemonEntry()` helper in `ensure.ts`:
  - Returns the absolute path to `daemon.ts` entry point
  - Use `import.meta.dir` to resolve relative to `ensure.ts` at compile time

- [x] **T-1.3** Add `isAlive(pid: number, sockPath: string): Promise<boolean>` in `ensure.ts`:
  - Try `process.kill(pid, 0)` — if throws (ESRCH), return false
  - If process exists, try `fetch("http://localhost/ping", { unix: sockPath })` with 500ms timeout
  - Return true only if both checks pass; false on any error

- [x] **T-1.4** Add `spawnDaemon(dir, p)` private helper in `ensure.ts`:
  - `fs.openSync(p.log, "a")` for log fd
  - `spawn(process.execPath, [daemonEntry()], { detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, LIGHTCODE_PROJECT_DIR: dir, LIGHTCODE_SOCK_PATH: p.sock, LIGHTCODE_PID_PATH: p.pid, LIGHTCODE_SERVER_URL: process.env.LIGHTCODE_SERVER_URL ?? "" } })`
  - `fs.closeSync(logFd)`
  - `proc.unref()`
  - `await Bun.write(p.pid, String(proc.pid))`

- [x] **T-1.5** Implement `export async function ensureDaemon(dir: string): Promise<string>` in `ensure.ts`:
  - Read PID file: `Number(await Bun.file(p.pid).text().catch(() => "0"))`
  - If `pid > 0 && await isAlive(pid, p.sock)` → return `p.sock`
  - Else: delete `p.pid` and `p.sock` (ignore errors), call `spawnDaemon`
  - Poll `/ping` at 100ms intervals for up to 10s — throw `Error("daemon ready timeout")` if exhausted
  - Return `p.sock`

---

## Phase 2 — New file: `src/dream/daemon.ts`

- [x] **T-2.1** Create `src/dream/daemon.ts` with startup guard:
  - At module top: `if (!process.env.LIGHTCODE_SOCK_PATH) process.exit(1)` — prevents accidental direct import
  - Read `sockPath`, `pidPath`, `projectDir`, `serverURL` from env vars
  - Register SIGTERM handler: delete sock file (swallow errors), `process.exit(0)`

- [x] **T-2.2** Implement idle timer in `daemon.ts`:
  - `const IDLE_MS = 10 * 60 * 1000`
  - `let timer: ReturnType<typeof setTimeout>`
  - `function resetTimer() { clearTimeout(timer); timer = setTimeout(shutdown, IDLE_MS) }`
  - `function shutdown() { try { fs.unlinkSync(sockPath) } catch {} ; process.exit(0) }`
  - Call `resetTimer()` at top-level after server starts

- [x] **T-2.3** Implement `GET /ping` route in `daemon.ts`:
  - Calls `resetTimer()`
  - Returns `Response.json({ ok: true, pid: process.pid })`

- [x] **T-2.4** Implement `GET /status` route in `daemon.ts`:
  - Calls `resetTimer()`
  - Returns `Response.json({ dreaming, lastCompleted, lastError })`
  - Where `dreaming`, `lastCompleted`, `lastError` are module-level state variables

- [x] **T-2.5** Implement `POST /trigger` route in `daemon.ts`:
  - Calls `resetTimer()`
  - Parse body as `{ focus?: string, model?: string, obs?: string }`
  - If `dreaming` is true, return `{ ok: true, queued: true }` (drop or queue — drop is acceptable)
  - Otherwise: set `dreaming = true`, run `doDream(focus, model, obs)` as a floating promise (do not await)
  - Return `Response.json({ ok: true })` immediately

- [x] **T-2.6** Implement `doDream(focus, model, obs)` async function in `daemon.ts`:
  - Build prompt using `buildSpawnPrompt(PROMPT, focus, obs)` (import from `./index`)
  - Retry connecting to `serverURL` for up to 30s (exponential backoff starting at 100ms)
  - `POST ${serverURL}/session` → get `sessionID`; on failure after retries: log and set `lastError`, set `dreaming = false`, return
  - `POST ${serverURL}/session/${sessionID}/prompt_async` with `{ model, agent: "dream", parts: [{ type: "text", text: prompt }] }`
  - Poll `GET ${serverURL}/session/status` every 2s up to 300 iterations until `data[sessionID]` is `idle` or missing
  - On success: call `writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })`, set `lastCompleted = Date.now()`, `dreaming = false`
  - On timeout: log warn, set `lastError = "timed out"`, `dreaming = false`

- [x] **T-2.7** Start `Bun.serve({ unix: sockPath, fetch: router })` at module bottom:
  - `router` dispatches to `GET /ping`, `POST /trigger`, `GET /status`; returns 404 for unknown routes
  - Log "daemon ready" with pid and sockPath after serve starts
  - Call `resetTimer()` after server starts

---

## Phase 3 — Modify `src/dream/index.ts`

- [x] **T-3.1** Remove SDK injection from `src/dream/index.ts`:
  - Delete `interface SDKClient { ... }` block
  - Delete `let sdk: SDKClient | undefined`
  - Delete `export function setSDK(client: SDKClient) { sdk = client }`
  - Delete `export function setModel(model: string | undefined) { configuredModel = model }`
  - Delete `let configuredModel: string | undefined`
  - Delete `async function spawn(...): Promise<string>` (entire function)

- [x] **T-3.2** Simplify `idle()` in `src/dream/index.ts`:
  - Keep `Engram.ensure()` and config checks unchanged
  - Replace `spawn()` call with `ensureDaemon` + fetch block
  - Wrap in `try/catch` that calls `log.warn` and returns on error
  - Remove `_dreaming = true` / `_dreaming = false` from `idle()` (daemon manages its own state)
  - Import `ensureDaemon` from `./ensure` and `Instance` from `../project/instance`

- [x] **T-3.3** Simplify `run()` in `src/dream/index.ts`:
  - Replace `spawn(focus)` call with `ensureDaemon` + fetch trigger
  - Remove `_dreaming = true` / `_dreaming = false` from `run()`
  - Keep `Engram.ensure()` check at top of `run()`

- [x] **T-3.4** Remove unused imports from `src/dream/index.ts`:
  - All imports verified — `Session`, `MessageV2`, `OM`, `Token` still needed for `summaries()`

---

## Phase 4 — Remove `setSDK` / `setModel` call sites

- [x] **T-4.1** Update `test/dream/autodream.test.ts`:
  - Delete `describe("setSDK", ...)` block
  - Delete `describe("setModel", ...)` block
  - Keep `describe("dreaming state", ...)` block
  - Keep `describe("run() error handling", ...)` block

- [x] **T-4.2** Search codebase for any other `AutoDream.setSDK` or `AutoDream.setModel` references:
  - Found and removed: `src/cli/cmd/tui/app.tsx` lines 271-275

---

## Phase 5 — Update `daemon.ts` to read `LIGHTCODE_SERVER_URL` and use it for session HTTP calls

- [x] **T-5.1** Verify `LIGHTCODE_SERVER_URL` is passed correctly when `spawnDaemon` runs:
  - `ensure.ts` passes `LIGHTCODE_SERVER_URL: process.env.LIGHTCODE_SERVER_URL ?? ""`
  - `idle()` in `index.ts` sets `process.env.LIGHTCODE_SERVER_URL = Server.url.toString()` before calling `ensureDaemon`

- [x] **T-5.2** Verify daemon HTTP calls to `serverURL` use the correct route signatures:
  - `POST /session?directory=<dir>` — confirmed against `src/server/routes/session.ts` line 192
  - `POST /session/:id/prompt_async?directory=<dir>` — confirmed line 768
  - `GET /session/status?directory=<dir>` — confirmed line 77

---

## Phase 6 — Tests

- [x] **T-6.1** Create `test/dream/ensure.test.ts`:
  - Test: `paths(dir)` returns deterministic paths using `Hash.fast(dir).slice(0, 16)`
  - Test: sock path under 104 chars
  - Test: `process.kill` behavior for live/dead PIDs

- [x] **T-6.2** Update `test/dream/autodream.test.ts`:
  - Remove `setSDK` and `setModel` describe blocks

---

## Phase 7 — Typecheck + Test Run

- [x] **T-7.1** Run `bun typecheck` from `packages/opencode` — passed with 0 errors

- [ ] **T-7.2** Run `bun test --timeout 30000` from `packages/opencode` — must pass

- [ ] **T-7.3** Manual smoke test: start LightCode, trigger an idle event, close the UI window, verify daemon process still running (`ps aux | grep dream`) and completes
