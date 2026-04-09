# opencode core

Core runtime for LightCode/OpenCode: CLI, TUI, HTTP server, session loop, tools, memory, and provider integrations.

## What lives here

- `src/session/` — prompt loop, async queue, turn steering, compaction
- `src/server/` — Hono routes used by the SDK and TUI
- `src/cli/cmd/tui/` — terminal UI
- `src/tool/` — built-in tools and registry
- `src/memory/` — cross-session recall + working memory
- `src/session/om/` — Observer / Reflector / OM buffering
- `src/storage/` — libSQL + Drizzle runtime

## Current session flow

- `POST /session/:sessionID/prompt` — synchronous prompt, waits for assistant output
- `POST /session/:sessionID/prompt_async` — enqueue a user turn and return immediately
- `POST /session/:sessionID/steer_async` — steer the active turn, or enqueue if the session is idle

The async loop drains pending user messages in FIFO order by checking which user turns have already been consumed by a finished assistant reply (`assistant.parentID`).

## TUI behavior

- normal submit uses `promptAsync()`
- queued prompts render with a `QUEUED` badge
- queued prompts expose an inline `⎈ STEER` action
- command palette includes `Steer current turn`
- synthetic `finish="steered"` assistant markers are hidden from the conversation body and only drive UI state

## Development

```bash
# run the core package
bun run --cwd packages/opencode dev

# typecheck the core package
bun run --cwd packages/opencode typecheck

# run core tests
bun test --cwd packages/opencode

# generate a migration after schema changes
bun run --cwd packages/opencode db generate --name <slug>
```

## Notes

- storage is async end-to-end via `@libsql/client`
- compiled binaries require the adjacent `node_modules/` sidecar for libSQL native bindings
- if you regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`
