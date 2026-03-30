#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Single tree: data/cache/config/state under .local-opencode (see packages/opencode/src/global/index.ts portableRoot).
# fork.opencode.env is loaded automatically by packages/opencode/bin/opencode (and again at app startup); no need to `source` it here unless you want to pre-set vars.
export OPENCODE_PORTABLE_ROOT="${OPENCODE_PORTABLE_ROOT:-$root/.local-opencode}"

# Prefer a locally built CLI (bun run build -- --single → dist/opencode-<platform>/bin/opencode) so we do not rely on node_modules platform packages.
if [[ -z "${OPENCODE_BIN_PATH:-}" ]]; then
  shopt -s nullglob
  for candidate in "$root/packages/opencode/dist"/opencode-*/bin/opencode; do
    if [[ -x "$candidate" ]]; then
      export OPENCODE_BIN_PATH="$candidate"
      break
    fi
  done
  shopt -u nullglob
fi

exec "$root/packages/opencode/bin/opencode" "$@"
