#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
process.env.OPENCODE_REPO_ROOT = root
if (!process.env.OPENCODE_PORTABLE_ROOT) process.env.OPENCODE_PORTABLE_ROOT = join(root, ".local-opencode")

await $`bun run --cwd packages/opencode --conditions=browser src/index.ts`.cwd(root)
