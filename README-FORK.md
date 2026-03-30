# Fork notes (Lightcode / commonriskpro)

This repository tracks a fork of OpenCode with offline-oriented tooling (initial tool tier, rules-based tool router, debug-request logging). Upstream-style contribution flow may differ; the default development branch here is `dev`.

- **Run a self-contained CLI** (no `~/.config` / global XDG for app data): `./scripts/opencode-isolated.sh` — sets `OPENCODE_PORTABLE_ROOT` to `<repo>/.local-opencode`. Override with `OPENCODE_BIN_PATH` for a built binary (e.g. `dist/.../bin/opencode`).
- **Offline router spec:** `packages/opencode/docs/spec-offline-tool-router.md`
- **Implementation index:** `packages/opencode/docs/offline-tool-router-implementation.md`
