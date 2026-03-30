# Fork notes (Lightcode / commonriskpro)

This repository tracks a fork of OpenCode with offline-oriented tooling (initial tool tier, rules-based tool router, debug-request logging). Upstream-style contribution flow may differ; the default development branch here is `dev`.

- **Environment variables (fork):** `fork.opencode.env` is applied automatically when the app or `packages/opencode/bin/opencode` starts (repo root from `dist/…` or cwd). Optional: `set -a && source ./fork.opencode.env && set +a`. Set `OPENCODE_SKIP_FORK_ENV=1` to skip loading the file.

- **Run a self-contained CLI** (no `~/.config` / global XDG for app data): `./scripts/opencode-isolated.sh` — sets `OPENCODE_PORTABLE_ROOT` to `<repo>/.local-opencode` and, if present, `OPENCODE_BIN_PATH` to `packages/opencode/dist/opencode-*/bin/opencode` from `bun run build -- --single`. If you run the **built** binary directly (e.g. from another cwd), the app infers `<repo>/.local-opencode` from the path `…/dist/opencode-*/bin/opencode` (`OPENCODE_DISABLE_PORTABLE_INFER=1` to opt out). In portable mode, remote account / `.well-known` config merges and system `managed` config are skipped so only local + project config apply. Build first: `(cd packages/opencode && bun run build -- --single)`.
- **Offline router spec:** `packages/opencode/docs/spec-offline-tool-router.md`
- **Implementation index:** `packages/opencode/docs/offline-tool-router-implementation.md`
