#!/bin/sh
#
# lightcode launcher
# ===================================================
#
# Wrapper around the compiled `lightcode` binary that ensures the binary is
# invoked with its own directory as cwd, so Bun's runtime module resolver can
# locate the sidecar `node_modules/@libsql/client` and `node_modules/fastembed`
# that live next to the binary.
#
# WHY THIS WRAPPER EXISTS
# -----------------------
#
# Since Bun 1.3.4 (oven-sh/bun#27058, closed as Not planned), `bun build
# --compile` resolves externalized native modules against `process.cwd()` at
# runtime, NOT against `path.dirname(process.execPath)`. That means a bare
# invocation of the compiled `lightcode` binary from any directory other than
# its own crashes with:
#
#     error: Cannot find module '@libsql/client' from '/$bunfs/root/src/index.js'
#
# Workarounds INSIDE the binary (entry shim with chdir + dynamic import) do
# NOT work because Bun resolves externals during ESM module graph
# instantiation, BEFORE any user code runs. Empirically verified: even
# debug prints at the top of an entrypoint never execute. The only reliable
# fix is to perform the `cd` in the SHELL before `exec`-ing the binary,
# which is what this script does.
#
# Related upstream issues (all unfixed as of Bun 1.3.11):
#   oven-sh/bun#27058  — closed Not planned (the canonical confirmation)
#   oven-sh/bun#25395  — sharp package
#   oven-sh/bun#18749  — playwright-core
#   oven-sh/bun#19601  — firebase-admin
#
# WHAT THIS SCRIPT DOES
# ---------------------
#
#   1. Saves the user's invocation cwd to LIGHTCODE_USER_CWD. The compiled
#      binary's `userCwd()` helper (src/cli/bootstrap.ts) reads this env var
#      to know which project the user is operating on, since after the `cd`
#      below, `process.cwd()` inside the binary will be the binary directory.
#
#   2. Resolves this script's own real path (following symlinks). Without
#      this, an install layout like
#          ~/.local/bin/lightcode -> /opt/lightcode/bin/lightcode-launcher.sh
#      would break because $0 would be the symlink path, not the real
#      script path next to the binary.
#
#   3. `cd`s into the directory containing the real binary, so Bun's
#      external resolver finds the adjacent `node_modules/`.
#
#   4. `exec`s the binary with the original arguments. Using `exec` (not a
#      plain invocation) replaces this shell process with the binary, so:
#        - The user's shell directly waits on the binary, not on the wrapper
#        - Ctrl-C / signals are delivered to the binary, not the wrapper
#        - The binary's exit code propagates directly to the parent
#        - No extra process sits in the process tree
#
# PORTABILITY
# -----------
#
# Written in POSIX `sh` (NOT bash) so it runs on:
#   - macOS /bin/sh (which is bash 3.2 in `--posix` mode)
#   - Linux dash, ash (Alpine, Debian minimal)
#   - busybox sh
#   - any other POSIX-compatible shell
#
# We avoid `readlink -f` because it's a GNU extension not present on macOS;
# the symlink-following loop below is the portable equivalent.
#
# WINDOWS
# -------
#
# Windows uses a separate `lightcode-launcher.cmd` shipped alongside this
# file. See `script/launcher.cmd` for the equivalent.
#

set -eu

# Save the user's invocation cwd. We use $PWD (the POSIX env var that the
# shell maintains) instead of $(pwd) because $PWD preserves the logical path
# the user typed (e.g. /tmp on macOS), while pwd would resolve to the real
# path (/private/tmp). The logical path matches user intent better.
LIGHTCODE_USER_CWD="$PWD"
export LIGHTCODE_USER_CWD

# Resolve this script's real path, following any symlinks. Portable
# equivalent of `readlink -f "$0"`.
SOURCE="$0"
while [ -h "$SOURCE" ]; do
  SOURCE_DIR="$(cd -P "$(dirname -- "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$SOURCE_DIR/$TARGET" ;;
  esac
done
BIN_DIR="$(cd -P "$(dirname -- "$SOURCE")" && pwd)"

# Locate the binary. Bail out with a clear error if it's missing — that
# would mean the install is broken (e.g. someone removed the binary but
# kept the launcher).
BINARY="$BIN_DIR/lightcode"
if [ ! -x "$BINARY" ]; then
  printf 'lightcode: binary not found or not executable: %s\n' "$BINARY" >&2
  exit 127
fi

# cd into the binary directory so the sidecar `node_modules/` is found by
# Bun's external resolver, then exec the binary. exec replaces this shell
# with the binary process; nothing after this line runs.
cd "$BIN_DIR"
exec "$BINARY" "$@"
