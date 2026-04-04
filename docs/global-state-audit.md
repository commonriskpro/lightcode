# OpenCode Global State: Complete Audit

## 1. XDG Base Directories (Core Global Paths)

**Source:** `src/global/index.ts` — imports from the `xdg-basedir` npm package at module load time.

| Env Var           | Default (macOS)  | Default (Linux)  | Resolves To                                        |
| ----------------- | ---------------- | ---------------- | -------------------------------------------------- |
| `XDG_DATA_HOME`   | `~/.local/share` | `~/.local/share` | `Global.Path.data` = `$XDG_DATA_HOME/opencode`     |
| `XDG_CACHE_HOME`  | `~/.cache`       | `~/.cache`       | `Global.Path.cache` = `$XDG_CACHE_HOME/opencode`   |
| `XDG_CONFIG_HOME` | `~/.config`      | `~/.config`      | `Global.Path.config` = `$XDG_CONFIG_HOME/opencode` |
| `XDG_STATE_HOME`  | `~/.local/state` | `~/.local/state` | `Global.Path.state` = `$XDG_STATE_HOME/opencode`   |

Additionally:

- `Global.Path.home` = `process.env.OPENCODE_TEST_HOME || os.homedir()` (dynamic getter)
- `Global.Path.bin` = `$XDG_CACHE_HOME/opencode/bin`
- `Global.Path.log` = `$XDG_DATA_HOME/opencode/log`

**At startup**, `src/global/index.ts` unconditionally `mkdir -p`s: `data`, `config`, `state`, `log`, `bin`.

---

## 2. Complete File/Directory Inventory

### 2A. CONFIGURATION (Global.Path.config)

Default: `~/.config/opencode/`

| Path                                 | Source                              | R/W          | Purpose                 |
| ------------------------------------ | ----------------------------------- | ------------ | ----------------------- |
| `$config/config.json`                | `config/config.ts:1222`             | R/W          | Legacy global config    |
| `$config/opencode.json`              | `config/config.ts:1223`             | R            | Global config           |
| `$config/opencode.jsonc`             | `config/config.ts:1224`             | R            | Global config (JSONC)   |
| `$config/config`                     | `config/config.ts:1227`             | R (migrated) | Legacy TOML config      |
| `$config/AGENTS.md`                  | `session/instruction.ts:30`         | R            | Global instruction file |
| `$config/tui.json` / `tui.jsonc`     | `config/tui.ts:88`                  | R            | TUI config              |
| `$config/themes/`                    | `cli/cmd/tui/plugin/runtime.ts:164` | W            | Global plugin themes    |
| `$config/{command,commands}/**/*.md` | `config/config.ts:207`              | R            | Global custom commands  |
| `$config/{agent,agents}/**/*.md`     | `config/config.ts:246`              | R            | Global custom agents    |
| `$config/{mode,modes}/*.md`          | `config/config.ts:284`              | R            | Global custom modes     |
| `$config/{plugin,plugins}/*.{ts,js}` | `config/config.ts:321`              | R            | Global plugins          |
| `$config/{skill,skills}/**/SKILL.md` | `skill/index.ts:164`                | R            | Global skills           |

### 2B. DATA (Global.Path.data)

Default: `~/.local/share/opencode/`

| Path                                 | Source                     | R/W | Purpose                           |
| ------------------------------------ | -------------------------- | --- | --------------------------------- |
| `$data/opencode.db`                  | `storage/db.ts:33`         | R/W | **SQLite database**               |
| `$data/opencode-{channel}.db`        | `storage/db.ts:35`         | R/W | Channel-specific DB               |
| `$data/auth.json`                    | `auth/index.ts:10`         | R/W | Provider auth tokens (mode 0o600) |
| `$data/mcp-auth.json`                | `mcp/auth.ts:34`           | R/W | MCP OAuth tokens (mode 0o600)     |
| `$data/storage/`                     | `storage/storage.ts:229`   | R   | Legacy JSON storage (migrated)    |
| `$data/log/`                         | `util/log.ts:62-65`        | W   | Log files                         |
| `$data/tool-output/`                 | `tool/truncation-dir.ts:4` | W   | Truncated tool output             |
| `$data/snapshot/{project_id}/{hash}` | `snapshot/index.ts:89`     | R/W | Git-based file snapshots          |
| `$data/worktree/{project_id}/`       | `worktree/index.ts:227`    | R/W | Git worktree directories          |
| `$data/plans/`                       | `session/index.ts:241`     | R/W | Plan files                        |

### 2C. CACHE (Global.Path.cache)

Default: `~/.cache/opencode/`

| Path                        | Source                     | R/W | Purpose                     |
| --------------------------- | -------------------------- | --- | --------------------------- |
| `$cache/version`            | `global/index.ts:39-53`    | R/W | Cache version marker        |
| `$cache/models.json`        | `provider/models.ts:19-21` | R/W | models.dev API cache        |
| `$cache/models-{hash}.json` | `provider/models.ts:21`    | R/W | Custom models URL cache     |
| `$cache/bin/`               | LSP servers, ripgrep       | R/W | Downloaded binaries         |
| `$cache/skills/`            | `skill/discovery.ts:36`    | R/W | Downloaded skills from URLs |

### 2D. STATE (Global.Path.state)

Default: `~/.local/state/opencode/`

| Path                      | Source                      | R/W | Purpose                      |
| ------------------------- | --------------------------- | --- | ---------------------------- |
| `$state/locks/`           | `util/flock.ts:9`           | R/W | File-based distributed locks |
| `$state/plugin-meta.json` | `plugin/meta.ts:50`         | R/W | Plugin metadata/fingerprints |
| `$state/model.json`       | `provider/provider.ts:1580` | R   | Recently used model tracking |

### 2E. HOME DIRECTORY READS

Default: `os.homedir()` (overridable via `OPENCODE_TEST_HOME`)

| Path                           | Source                      | R/W | Purpose                         |
| ------------------------------ | --------------------------- | --- | ------------------------------- |
| `~/.claude/CLAUDE.md`          | `session/instruction.ts:32` | R   | Claude Code instruction compat  |
| `~/.claude/skills/**/SKILL.md` | `skill/index.ts:23,148`     | R   | External skills (Claude compat) |
| `~/.agents/skills/**/SKILL.md` | `skill/index.ts:23,148`     | R   | External skills                 |
| `~/.opencode/`                 | `config/paths.ts:28-33`     | R   | Home-level config dir           |

### 2F. SYSTEM-MANAGED PATHS (Enterprise/MDM)

| Path                                                            | Platform | Purpose                           |
| --------------------------------------------------------------- | -------- | --------------------------------- |
| `/Library/Application Support/opencode/`                        | macOS    | Managed config (highest priority) |
| `/Library/Managed Preferences/{user}/ai.opencode.managed.plist` | macOS    | MDM preferences                   |
| `/Library/Managed Preferences/ai.opencode.managed.plist`        | macOS    | Machine-scoped MDM                |
| `/etc/opencode/`                                                | Linux    | Managed config                    |
| `C:\ProgramData\opencode\`                                      | Windows  | Managed config                    |

---

## 3. Environment Variables That Control Paths

### Path Override Variables

| Env Var                            | Controls             | Effect                                                       |
| ---------------------------------- | -------------------- | ------------------------------------------------------------ |
| `XDG_DATA_HOME`                    | `Global.Path.data`   | Redirects ALL data (DB, auth, logs, snapshots)               |
| `XDG_CACHE_HOME`                   | `Global.Path.cache`  | Redirects ALL cache (models, binaries, skills)               |
| `XDG_CONFIG_HOME`                  | `Global.Path.config` | Redirects ALL config (opencode.json, AGENTS.md, tui.json)    |
| `XDG_STATE_HOME`                   | `Global.Path.state`  | Redirects ALL state (locks, plugin-meta, model.json)         |
| `OPENCODE_TEST_HOME`               | `Global.Path.home`   | Redirects home dir reads (~/.claude, ~/.agents, ~/.opencode) |
| `OPENCODE_DB`                      | DB path              | Overrides SQLite DB location (`:memory:` for in-memory)      |
| `OPENCODE_CONFIG`                  | Config file          | Load config from specific file                               |
| `OPENCODE_CONFIG_DIR`              | Extra config dir     | Load additional config from this directory                   |
| `OPENCODE_CONFIG_CONTENT`          | Inline config        | Parse config from env var value (no file read)               |
| `OPENCODE_TUI_CONFIG`              | TUI config file      | Override TUI config path                                     |
| `OPENCODE_MODELS_PATH`             | Models cache         | Use static models file                                       |
| `OPENCODE_MODELS_URL`              | Models URL           | Override models.dev URL                                      |
| `OPENCODE_PLUGIN_META_FILE`        | Plugin meta          | Override plugin-meta.json path                               |
| `OPENCODE_TEST_MANAGED_CONFIG_DIR` | Managed config       | Override system managed config dir                           |

### Disable Flags

| Env Var                                    | What It Disables                                   |
| ------------------------------------------ | -------------------------------------------------- |
| `OPENCODE_DISABLE_PROJECT_CONFIG=true`     | Project-level config files                         |
| `OPENCODE_DISABLE_CLAUDE_CODE=true`        | ALL Claude Code compat (CLAUDE.md, skills, prompt) |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=true` | Reading `~/.claude/CLAUDE.md`                      |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=true` | Reading `~/.claude/skills/`, `~/.agents/skills/`   |
| `OPENCODE_DISABLE_EXTERNAL_SKILLS=true`    | ALL external skill directories                     |
| `OPENCODE_DISABLE_MODELS_FETCH=true`       | Fetching from models.dev                           |
| `OPENCODE_DISABLE_LSP_DOWNLOAD=true`       | Downloading LSP server binaries                    |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`    | Built-in plugins (codex, copilot, gitlab, poe)     |
| `OPENCODE_DISABLE_AUTOUPDATE=true`         | Auto-update checks                                 |
| `OPENCODE_DISABLE_CHANNEL_DB=true`         | Forces default DB name                             |

---

## 4. Full Isolation: Zero Global Reads

```bash
# Redirect all XDG dirs to isolated location
export XDG_DATA_HOME=/tmp/opencode-isolated/data
export XDG_CACHE_HOME=/tmp/opencode-isolated/cache
export XDG_CONFIG_HOME=/tmp/opencode-isolated/config
export XDG_STATE_HOME=/tmp/opencode-isolated/state

# Redirect home dir reads
export OPENCODE_TEST_HOME=/tmp/opencode-isolated/home

# Use in-memory DB (or isolated path)
export OPENCODE_DB=:memory:

# Redirect managed config dir
export OPENCODE_TEST_MANAGED_CONFIG_DIR=/tmp/opencode-isolated/managed

# Disable network fetches
export OPENCODE_DISABLE_MODELS_FETCH=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
export OPENCODE_DISABLE_AUTOUPDATE=true

# Disable external reads
export OPENCODE_DISABLE_CLAUDE_CODE=true
export OPENCODE_DISABLE_EXTERNAL_SKILLS=true

# Optional: disable project-level config too
export OPENCODE_DISABLE_PROJECT_CONFIG=true

# Disable default plugins
export OPENCODE_DISABLE_DEFAULT_PLUGINS=true
```

### Caveats

1. **XDG vars are read at import time** by `xdg-basedir`. They MUST be set BEFORE importing any OpenCode module.

2. **MDM plist reads** (`/Library/Managed Preferences/`) cannot be redirected by env var in production — only `OPENCODE_TEST_MANAGED_CONFIG_DIR` controls the file-based managed dir.

3. **`Global.Path.home`** is the only path using a dynamic getter (checked at access time). All four XDG paths are frozen at module load.

---

## 5. What the Test Suite Uses (from `test/preload.ts`)

The test harness sets:

- All 4 `XDG_*_HOME` vars to temp dirs
- `OPENCODE_TEST_HOME` to an isolated home
- `OPENCODE_TEST_MANAGED_CONFIG_DIR` to an isolated dir
- `OPENCODE_DB=:memory:`
- `OPENCODE_MODELS_PATH` to a local fixture
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`
- Clears all provider API key env vars
