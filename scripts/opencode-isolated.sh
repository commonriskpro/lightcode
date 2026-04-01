#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Single tree: data/cache/config/state under .local-opencode (see packages/opencode/src/global/index.ts portableRoot).
# fork.opencode.env is loaded automatically by packages/opencode/bin/opencode (and again at app startup); no need to `source` it here unless you want to pre-set vars.
export OPENCODE_PORTABLE_ROOT="${OPENCODE_PORTABLE_ROOT:-$root/.local-opencode}"

# Router embed (Xenova): drop dead /nix/store paths (GC) or non-executable; then pin current node from this shell.
if [[ -n "${OPENCODE_ROUTER_EMBED_NODE:-}" ]]; then
  if [[ "${OPENCODE_ROUTER_EMBED_NODE}" == /nix/store/* ]] || [[ ! -x "${OPENCODE_ROUTER_EMBED_NODE}" ]]; then
    unset OPENCODE_ROUTER_EMBED_NODE
  fi
fi
if [[ -z "${OPENCODE_ROUTER_EMBED_NODE:-}" ]] && command -v node >/dev/null 2>&1; then
  _embed_node="$(command -v node)"
  if [[ -x "$_embed_node" ]]; then
    export OPENCODE_ROUTER_EMBED_NODE="$_embed_node"
  fi
fi

# packages/opencode/bin/opencode (Node) sets DYLD_FALLBACK_LIBRARY_PATH / LD_LIBRARY_PATH and copies
# onnxruntime dylibs under OPENCODE_PORTABLE_ROOT/cache/onnxruntime-libs/ so @huggingface/transformers works with the compiled CLI.

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
