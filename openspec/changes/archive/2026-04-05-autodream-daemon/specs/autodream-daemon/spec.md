# Delta Spec: autodream-daemon → autodream-daemon capability

## New Capability: autodream-daemon

AutoDream consolidation runs in a persistent background daemon process that survives LightCode UI close.

---

## Scenarios

### Scenario: Daemon starts on first idle event

- GIVEN LightCode receives `SessionStatus.Event.Idle` for a session
- AND no daemon PID file exists for the current project directory
- WHEN `AutoDream.idle()` is called
- THEN `ensureDaemon(projectDir)` MUST spawn a new daemon process with `detached: true` and `stdio: 'ignore'`
- AND `proc.unref()` MUST be called so the parent process does not wait for the child
- AND a PID file MUST be written at `Global.Path.state/dream-<hash16>.pid`
- AND `ensureDaemon` MUST poll `/ping` at 100ms intervals until the socket responds (max 10s)
- AND `idle()` MUST send `POST /trigger` with `{ model }` to the daemon socket
- AND the daemon MUST begin a dream session against the LightCode server

---

### Scenario: Single instance enforced — second idle reuses running daemon

- GIVEN a daemon is already running for the current project (PID file exists, process alive, socket responsive)
- WHEN a second `SessionStatus.Event.Idle` fires
- THEN `ensureDaemon` MUST NOT spawn a new process
- AND `ensureDaemon` MUST return the existing socket path immediately
- AND `POST /trigger` MUST be sent to the already-running daemon

---

### Scenario: Dream completes after UI close

- GIVEN a daemon was started by an idle event
- AND the user closes LightCode (SIGHUP sent to process group)
- WHEN the daemon is running a dream session (polling for completion)
- THEN the daemon MUST continue running (SIGHUP-immune via `detached` spawn + `setsid`)
- AND the dream session MUST complete and write Engram observations
- AND `writeState` MUST be called with `lastConsolidatedAt: Date.now()`

---

### Scenario: Daemon self-terminates after 10 minutes of inactivity

- GIVEN the daemon has received no HTTP requests for 10 minutes
- WHEN the idle timer fires
- THEN the daemon MUST delete its socket file
- AND the daemon MUST call `process.exit(0)`
- AND the PID file MAY remain (will be cleaned up by `ensureDaemon` on next spawn via stale-check)

---

### Scenario: Stale PID file handled gracefully

- GIVEN a PID file exists for the project directory
- AND `process.kill(pid, 0)` throws (process not running)
- OR the socket `/ping` times out (process running but socket gone)
- WHEN `ensureDaemon(projectDir)` is called
- THEN the stale PID file MUST be deleted
- AND the stale socket file MUST be deleted if it exists
- AND a new daemon MUST be spawned
- AND no error MUST be thrown to the caller

---

### Scenario: Server URL unavailable — daemon logs and gives up gracefully

- GIVEN `LIGHTCODE_SERVER_URL` env var is empty or not set
- OR the LightCode server is unreachable at that URL
- WHEN the daemon receives `POST /trigger` and attempts to create a dream session
- THEN the daemon MUST log the error to its log file
- AND the daemon MUST retry the server connection for up to 30 seconds
- AND if still unreachable after 30s, the daemon MUST log "dream skipped: server unavailable" and return
- AND the daemon MUST NOT crash or exit due to this failure
- AND the daemon idle timer MUST continue normally

---

### Scenario: Manual `/dream` command uses daemon same as idle trigger

- GIVEN the user runs the `/dream` command (optionally with a focus string)
- WHEN `AutoDream.run(focus?)` is called
- THEN `ensureDaemon(projectDir)` MUST be called (same as `idle()`)
- AND `POST /trigger` with `{ focus, model }` MUST be sent to the daemon socket
- AND the result string MUST be returned to the caller (via the HTTP response body)

---

### Scenario: Daemon log accessible at deterministic path

- GIVEN a daemon has been spawned for project directory `dir`
- WHEN the daemon runs
- THEN all daemon stdout and stderr MUST be written to `Global.Path.state/dream-<hash16>.log`
- WHERE `hash16 = Hash.fast(dir).slice(0, 16)`
- AND the log file MUST be opened with `flags: 'a'` (append) so restarts do not truncate prior logs

---

### Scenario: `ensureDaemon` throws — idle/run degrade gracefully

- GIVEN `ensureDaemon()` throws for any reason (spawn error, ready-poll timeout, etc.)
- WHEN `AutoDream.idle()` or `AutoDream.run()` catches the error
- THEN a warning MUST be logged via `log.warn`
- AND `idle()` MUST return without throwing
- AND `run()` MUST return a descriptive string (not throw)
- AND the LightCode main process MUST NOT crash

---

### Scenario: `AutoDream.setSDK` and `AutoDream.setModel` removed

- GIVEN the change is applied
- WHEN any code attempts to call `AutoDream.setSDK(...)` or `AutoDream.setModel(...)`
- THEN a TypeScript compile error MUST occur (functions do not exist)
- AND no runtime `sdk` variable MUST exist in `index.ts`
