#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
/** Darwin arm64 (Apple Silicon) + CLI/TUI only; no embedded Web UI bundle. */
await $`bun turbo run build:cli:fast --filter=opencode`.cwd(root)
