import { hideBin } from "yargs/helpers"

/** Top-level commands that do not load the TUI bundle (@opentui/solid). Update when adding CLI commands in index.ts (unless they belong with thread/attach). */
const HEADLESS = new Set([
  "acp",
  "mcp",
  "run",
  "generate",
  "debug",
  "console",
  "providers",
  "agent",
  "upgrade",
  "uninstall",
  "serve",
  "web",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "pr",
  "session",
  "plugin",
  "db",
  "completion",
])

/** When true, thread/attach (Solid) are not imported — e.g. `generate`, SDK OpenAPI emit. */
export function skipTuiBundle(argv = hideBin(process.argv)): boolean {
  if (argv.length === 0) return false
  const head = argv[0]
  if (head.startsWith("-")) return false
  return HEADLESS.has(head)
}
