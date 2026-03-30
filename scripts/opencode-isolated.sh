#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Single tree: data/cache/config/state under .local-opencode (see packages/opencode/src/global/index.ts portableRoot).
export OPENCODE_PORTABLE_ROOT="${OPENCODE_PORTABLE_ROOT:-$root/.local-opencode}"
exec "${OPENCODE_BIN_PATH:-$root/packages/opencode/bin/opencode}" "$@"
