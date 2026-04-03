import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")
  export const OPENCODE_GIT_BASH_PATH = process.env["OPENCODE_GIT_BASH_PATH"]
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]
  export declare const OPENCODE_PURE: boolean
  export declare const OPENCODE_TUI_CONFIG: string | undefined
  export declare const OPENCODE_CONFIG_DIR: string | undefined
  export declare const OPENCODE_PLUGIN_META_FILE: string | undefined
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")
  export const OPENCODE_ALWAYS_NOTIFY_UPDATE = truthy("OPENCODE_ALWAYS_NOTIFY_UPDATE")
  export const OPENCODE_DISABLE_PRUNE = truthy("OPENCODE_DISABLE_PRUNE")
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("OPENCODE_DISABLE_TERMINAL_TITLE")
  export const OPENCODE_SHOW_TTFD = truthy("OPENCODE_SHOW_TTFD")
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("OPENCODE_DISABLE_AUTOCOMPACT")
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("OPENCODE_DISABLE_MODELS_FETCH")
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")
  export const OPENCODE_DISABLE_EXTERNAL_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENCODE_DISABLE_EXTERNAL_SKILLS")
  export declare const OPENCODE_DISABLE_PROJECT_CONFIG: boolean
  export const OPENCODE_FAKE_VCS = process.env["OPENCODE_FAKE_VCS"]
  export declare const OPENCODE_CLIENT: string
  export const OPENCODE_SERVER_PASSWORD = process.env["OPENCODE_SERVER_PASSWORD"]
  export const OPENCODE_SERVER_USERNAME = process.env["OPENCODE_SERVER_USERNAME"]
  export const OPENCODE_ENABLE_QUESTION_TOOL = truthy("OPENCODE_ENABLE_QUESTION_TOOL")

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENCODE_ENABLE_EXA =
    truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA")
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT")
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("OPENCODE_EXPERIMENTAL_LSP_TY")
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL")
  export const OPENCODE_DISABLE_FILETIME_CHECK = Config.boolean("OPENCODE_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const OPENCODE_EXPERIMENTAL_PLAN_MODE = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE")
  export const OPENCODE_EXPERIMENTAL_WORKSPACES = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_WORKSPACES")
  export const OPENCODE_EXPERIMENTAL_MARKDOWN = !falsy("OPENCODE_EXPERIMENTAL_MARKDOWN")
  export const OPENCODE_MODELS_URL = process.env["OPENCODE_MODELS_URL"]
  export const OPENCODE_MODELS_PATH = process.env["OPENCODE_MODELS_PATH"]
  export const OPENCODE_DISABLE_EMBEDDED_WEB_UI = truthy("OPENCODE_DISABLE_EMBEDDED_WEB_UI")
  export const OPENCODE_DB = process.env["OPENCODE_DB"]
  export const OPENCODE_DISABLE_CHANNEL_DB = truthy("OPENCODE_DISABLE_CHANNEL_DB")
  export const OPENCODE_SKIP_MIGRATIONS = truthy("OPENCODE_SKIP_MIGRATIONS")
  export const OPENCODE_STRICT_CONFIG_DEPS = truthy("OPENCODE_STRICT_CONFIG_DEPS")
  export const OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH = truthy("OPENCODE_INITIAL_MINIMAL_INCLUDE_BASH")
  /** Log wire/usage analytics; also configurable as experimental.debug_request. */
  export const OPENCODE_DEBUG_REQUEST = truthy("OPENCODE_DEBUG_REQUEST")
  /** When set, always send the full `agent.prompt` and per-message `user.system` even if the offline router chose `contextTier: conversation`. */
  export const OPENCODE_ALWAYS_FULL_AGENT_PROMPT = truthy("OPENCODE_ALWAYS_FULL_AGENT_PROMPT")
  /** Skip global instruction paths (~/.config/.../AGENTS.md, OPENCODE_CONFIG_DIR/AGENTS.md, ~/.claude/CLAUDE.md) and append a system line discouraging proactive README/CLAUDE.md/package.json reads. */
  export const OPENCODE_DISABLE_GLOBAL_DOC_READS = truthy("OPENCODE_DISABLE_GLOBAL_DOC_READS")
  /** Disable ALL global file imports — no ~/.config/opencode/AGENTS.md, no ~/.claude/CLAUDE.md, no OPENCODE_CONFIG_DIR/AGENTS.md. Only use the portable/self-contained directory. */
  export const OPENCODE_DISABLE_GLOBAL_IMPORTS = truthy("OPENCODE_DISABLE_GLOBAL_IMPORTS")
  /** Enable offline tool router; merges with experimental.tool_router.enabled. */
  export declare const OPENCODE_TOOL_ROUTER: boolean
  /** Same as experimental.tool_router.router_only: no no_match tool bundle, strict MCP; conversation tier is local intent embed only (local_intent_embed). */
  export declare const OPENCODE_TOOL_ROUTER_ONLY: boolean
  /** `rules` (default) or `hybrid` (keyword rules + small LLM for extra tools). Same as experimental.tool_router.mode. */
  export declare const OPENCODE_TOOL_ROUTER_MODE: "rules" | "hybrid" | undefined
  /** Optional: HF id for offline router embeddings (e.g. Xenova/paraphrase-multilingual-MiniLM-L12-v2). Overrides experimental.tool_router.local_embed_model when set. */
  export const OPENCODE_TOOL_ROUTER_EMBED_MODEL = process.env["OPENCODE_TOOL_ROUTER_EMBED_MODEL"]
  /** Optional: filesystem cache dir for @huggingface/transformers (router embed). Prefer under OPENCODE_PORTABLE_ROOT for autocontenido. */
  export const OPENCODE_TRANSFORMERS_CACHE = process.env["OPENCODE_TRANSFORMERS_CACHE"]
  export declare const OPENCODE_INITIAL_TOOL_TIER: "minimal" | "full" | undefined
  /** With `initial_tool_tier: minimal`, keep the small tool allowlist + deferred instructions every turn; router + additive supply the rest. */
  export declare const OPENCODE_MINIMAL_TIER_ALL_TURNS: boolean

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for OPENCODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_TUI_CONFIG", {
  get() {
    return process.env["OPENCODE_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "OPENCODE_PURE", {
  get() {
    return truthy("OPENCODE_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENCODE_PLUGIN_META_FILE", {
  get() {
    return process.env["OPENCODE_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENCODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENCODE_CLIENT", {
  get() {
    return process.env["OPENCODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_TOOL_ROUTER", {
  get() {
    return truthy("OPENCODE_TOOL_ROUTER")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_TOOL_ROUTER_ONLY", {
  get() {
    return truthy("OPENCODE_TOOL_ROUTER_ONLY")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_TOOL_ROUTER_MODE", {
  get() {
    const v = process.env["OPENCODE_TOOL_ROUTER_MODE"]?.toLowerCase()
    if (v === "hybrid" || v === "rules") return v
    return undefined
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_INITIAL_TOOL_TIER", {
  get() {
    const v = process.env["OPENCODE_INITIAL_TOOL_TIER"]?.toLowerCase()
    if (v === "minimal" || v === "full") return v
    return undefined
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_MINIMAL_TIER_ALL_TURNS", {
  get() {
    return truthy("OPENCODE_MINIMAL_TIER_ALL_TURNS")
  },
  enumerable: true,
  configurable: false,
})
