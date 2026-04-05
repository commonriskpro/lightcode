# Proposal: AutoDream Persistent Background Daemon

## Intent

Extract AutoDream from the main LightCode process into a **persistent background daemon** that survives UI close. When a user closes LightCode before the idle timeout fires — or before dream polling completes (up to 10 min) — the dream is lost. The daemon runs detached, completing dreams regardless of UI lifetime.

## Scope

### In Scope

- New `src/dream/daemon.ts` — HTTP server over Unix socket; idle self-termination; SIGTERM cleanup
- New `src/dream/ensure.ts` — single-instance (PID file + socket ping), spawn, ready polling
- Modify `src/dream/index.ts` — remove SDK injection; `idle()` and `run()` delegate to daemon via HTTP
- Remove `AutoDream.setSDK` / `AutoDream.setModel` and call sites

### Out of Scope

- Windows support (daemon uses `detached: true`; Windows degrades silently)
- Multi-project shared daemon (one daemon per project directory)
- systemd / launchd integration (daemon self-terminates; no system service)
- Daemon auto-restart on crash (next idle event re-spawns)

## Capabilities

### New Capabilities

- `autodream-daemon`: Dream consolidation survives UI close; single instance per project; self-terminates after 10 min

### Modified Capabilities

- `autodream`: `idle()` and `run()` become thin HTTP callers; SDK injection gone

## Affected Areas

| Area                           | Impact   | Description                                                                               |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `src/dream/daemon.ts`          | **New**  | HTTP server over Unix socket; `/ping`, `/trigger`, `/status`; idle timer; SIGTERM handler |
| `src/dream/ensure.ts`          | **New**  | `ensureDaemon(dir)` — PID check, ping, spawn, ready poll                                  |
| `src/dream/index.ts`           | Modified | Remove `SDKClient`, `setSDK`, `setModel`, `spawn()`; simplify `idle()`/`run()`            |
| `test/dream/autodream.test.ts` | Modified | Remove `setSDK`/`setModel` tests; add `ensureDaemon` tests                                |

## Risks

| Risk                                        | Likelihood | Mitigation                                                                                 |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Daemon fails to start                       | Medium     | `ensureDaemon()` throws → `idle()` logs warning, returns — dream skipped, no crash         |
| Stale PID file after hard kill              | Low        | Double-check: `process.kill(pid, 0)` + socket `/ping`; stale files cleaned before re-spawn |
| `LIGHTCODE_SERVER_URL` missing              | Low        | Daemon retries 30s then logs and returns; no crash                                         |
| Socket path too long (Linux 104-char limit) | Low        | Hash truncated to 16 hex chars — path stays well under limit                               |

## Rollback Plan

Git revert. No DB migration. Stale `.sock`/`.pid` files in `Global.Path.state` are inert to the reverted code.

## Success Criteria

- [ ] Dream completes after the UI window is closed
- [ ] Second idle event reuses the running daemon (single instance)
- [ ] Daemon exits after 10 minutes of no requests
- [ ] Stale PID file cleaned up without error on next idle
- [ ] `AutoDream.setSDK` and `AutoDream.setModel` no longer exist
- [ ] `bun typecheck` passes; `bun test` passes
