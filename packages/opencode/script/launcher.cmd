@echo off
rem ================================================================
rem  lightcode launcher (Windows)
rem ================================================================
rem
rem  Wrapper around the compiled `lightcode.exe` binary that ensures the
rem  binary is invoked with its own directory as cwd, so Bun's runtime
rem  module resolver can locate the sidecar `node_modules\@libsql\client`
rem  and `node_modules\fastembed` that live next to the binary.
rem
rem  See `script/launcher.sh` for the full rationale (this file is the
rem  Windows equivalent). Short version:
rem
rem    Since Bun 1.3.4 (oven-sh/bun#27058, closed Not planned),
rem    `bun build --compile` resolves externalized native modules against
rem    process.cwd() at runtime. Workarounds inside the binary do not
rem    work because Bun resolves externals during ESM module graph
rem    instantiation, before any user code runs. The only reliable fix
rem    is to `cd` in the SHELL before running the binary.
rem
rem  WHAT THIS SCRIPT DOES
rem  ---------------------
rem
rem    1. Saves the user's cwd to LIGHTCODE_USER_CWD so the binary's
rem       userCwd() helper can recover it after the cd below.
rem    2. cd's into its own directory (which contains lightcode.exe and
rem       the sidecar node_modules).
rem    3. Calls lightcode.exe with the original arguments and propagates
rem       its exit code.
rem
rem  Unlike the POSIX sh launcher, cmd.exe does not support `exec` to
rem  replace the current process — we use `call` and propagate the exit
rem  code via ERRORLEVEL. The trade-off is that one extra cmd.exe stays
rem  in the process tree until the binary exits. Ctrl-C is still
rem  forwarded to the child by cmd.exe automatically.
rem
rem  %~dp0 expands to the directory containing this batch file, with a
rem  trailing backslash. It already follows .lnk shortcuts on Windows
rem  (the closest analog to symlinks), so we don't need an explicit
rem  resolution loop like the sh launcher does.
rem ================================================================

setlocal

set "LIGHTCODE_USER_CWD=%CD%"

rem %~dp0 already ends with a trailing backslash.
set "BIN_DIR=%~dp0"
set "BINARY=%BIN_DIR%lightcode.exe"

if not exist "%BINARY%" (
  echo lightcode: binary not found: "%BINARY%" 1>&2
  exit /b 127
)

cd /d "%BIN_DIR%"
call "%BINARY%" %*
exit /b %ERRORLEVEL%
