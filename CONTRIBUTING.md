# Contributing to LightCode

## What gets merged

- Bug fixes
- Performance improvements
- Memory system improvements (Observer, AutoDream, Engram integration)
- Provider support
- LSP / formatter additions
- Documentation improvements

Features that change core product behavior should start with an issue describing the problem and proposed approach before a PR.

## Getting Started

Requirements: **Bun 1.3+**

```bash
git clone https://github.com/commonriskpro/lightcode.git
cd lightcode
bun install
bun dev
```

Run against a specific directory:

```bash
bun dev /path/to/project
```

## Development Commands

```bash
bun dev                          # TUI in current directory
bun dev serve                    # Headless API server (port 4096)
bun dev serve --port 8080        # Custom port
bun run --cwd packages/app dev   # Web UI (requires server running)
bun run --cwd packages/desktop tauri dev  # Desktop app
```

## Testing

Always run tests from the package directory, **not** the repo root:

```bash
# Correct
bun test --cwd packages/opencode

# Type check
bun turbo typecheck

# DB migration (after schema changes in *.sql.ts)
bun run --cwd packages/opencode db generate --name <slug>
```

**Test rules:**

- Test actual implementation — do not duplicate logic in tests
- Avoid mocks — use real behavior and graceful degradation paths
- Single-word names in test code: `sid`, `obs`, `tok`, `result`

## Building a Standalone Binary

```bash
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

Replace `<platform>` with e.g. `darwin-arm64`, `linux-x64`.

## Debugging

The most reliable way to debug is `bun run --inspect=<url> dev ...` and attach via that URL.

```bash
# Debug server separately
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096
# Attach TUI
lightcode attach http://localhost:4096
```

If you use VSCode, see `.vscode/settings.example.json` and `.vscode/launch.example.json`.

## Code Style

From [AGENTS.md](AGENTS.md) — these are enforced:

- **Naming**: single-word identifiers (`pid`, `sid`, `cfg`, `err`) — not `sessionId`, `configuredModel`
- **Destructuring**: avoid — use dot notation (`msg.info.role` not `const { role } = msg.info`)
- **Control flow**: no `else` — prefer early returns
- **Variables**: `const` over `let`; ternaries over reassignment
- **Error handling**: no `try/catch` in Effect code — use Effect error channels
- **Types**: avoid `any`; use type guards on `filter()` for inference
- **Runtime**: use Bun APIs (`Bun.file()`) over Node equivalents

### Effect patterns

```typescript
// Services
Effect.gen(function* () { ... })
Effect.fn("Domain.method")(function* (input) { ... })

// Background work
Effect.forkIn(scope)   // scoped fiber (preferred)
Effect.forkScoped      // inside layer definition

// Graceful degradation
Effect.catchAll((_) => Effect.succeed(undefined))
```

### DB schema

```typescript
// snake_case columns, no string column names
const table = sqliteTable("session_observation", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## Pull Request Guidelines

### Issue First

Open an issue before a PR for anything beyond a trivial bug fix. This prevents duplicate work and aligns on approach before implementation.

Use `Fixes #123` or `Closes #123` in the PR description to link the issue.

### PR Requirements

- Keep PRs small and focused — one concern per PR
- Explain what changed and why
- For UI changes: include screenshots or a short video
- For logic changes: explain how you verified it works
- PR titles follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`

Optional scope:

- `feat(session):` — change in the session package
- `fix(tui):` — bug fix in the TUI
- `chore(om):` — maintenance in the observational memory module

### Keep it short

Long AI-generated descriptions slow down review. Write in your own words, briefly.

## Architecture Notes

### Memory system

LightCode's memory system has three layers — all in `packages/opencode/src/`:

| Layer                  | Files                          | What it does                                                      |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------- |
| Cross-session recall   | `session/system.ts` `recall()` | Fetches Engram context at session start → `system[1]`             |
| Intra-session Observer | `session/om/`                  | Background LLM compresses messages every 30k tokens → `system[2]` |
| AutoDream              | `dream/index.ts`               | Consolidates session memory to Engram on idle                     |

### Prompt caching

`system[]` slots are intentional — don't reorder them:

```
system[0]  BP2 1h     agent prompt        ← never touch
system[1]  BP3 5min   Engram recall       ← recall() output
system[2]  BP3 5min   local observations  ← OM output
system[3]  not cached volatile            ← date + model
```

`applyCaching()` in `provider/transform.ts` places breakpoints on `system[0]` and `system[1]`. Everything else is inert with respect to caching.

### OM buffer naming

The observational memory buffer namespace is `OMBuf` (not `Buffer` — would shadow the Node.js global).

---

_LightCode is built on [OpenCode](https://github.com/anomalyco/opencode) by [Anomaly](https://anomaly.co)._
