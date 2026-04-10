/**
 * tmux passthrough wrapper for Kitty graphics protocol.
 *
 * When running inside tmux, Kitty escape sequences must be wrapped
 * in tmux's DCS passthrough:
 *
 *   \ePtmux;\e<original_escape>\e\\
 *
 * Requirements:
 *   - tmux ≥ 3.4
 *   - `set -g allow-passthrough on` in tmux.conf
 *   - Parent terminal supports Kitty graphics (Ghostty, Kitty, WezTerm, iTerm2)
 *
 * Inside the passthrough, every \e (0x1b) in the inner payload must be
 * doubled to \e\e so tmux doesn't interpret them.
 */

/** Known env vars that reveal the real parent terminal inside tmux. */
const PARENT_HINTS: Record<string, string> = {
  GHOSTTY_RESOURCES_DIR: "ghostty",
  KITTY_PID: "kitty",
  KITTY_WINDOW_ID: "kitty",
  WEZTERM_EXECUTABLE: "wezterm",
  WEZTERM_PANE: "wezterm",
  ITERM_SESSION_ID: "iterm2",
  LC_TERMINAL: "", // iterm2 sets this to "iTerm2"
}

/** Detect if we're inside tmux. */
export function inTmux(): boolean {
  return !!process.env["TMUX"]
}

/** Detect the parent terminal behind tmux (if recognizable). */
export function parent(): string | null {
  for (const [key, name] of Object.entries(PARENT_HINTS)) {
    const val = process.env[key]
    if (!val) continue
    if (key === "LC_TERMINAL") return val.toLowerCase().includes("iterm") ? "iterm2" : null
    return name
  }
  return null
}

/** Check if tmux passthrough can work (known parent + tmux present). */
export function supported(): boolean {
  if (!inTmux()) return false
  return parent() !== null
}

/**
 * Wrap a Kitty graphics escape sequence for tmux passthrough.
 *
 * Input: the raw escape e.g. "\x1b_G...;\x1b\\"
 * Output: "\x1bPtmux;\x1b\x1b_G...;\x1b\x1b\\\x1b\\"
 *
 * Every 0x1b in the inner payload gets doubled.
 */
export function wrap(raw: string): string {
  // Double all \x1b inside the payload
  const inner = raw.replaceAll("\x1b", "\x1b\x1b")
  return `\x1bPtmux;${inner}\x1b\\`
}

/**
 * Create a write function that wraps output for tmux passthrough.
 *
 * If we're in tmux with a capable parent, wraps every write.
 * Otherwise returns a plain passthrough.
 */
export function writer(stdout: NodeJS.WriteStream): (data: string) => boolean {
  if (!supported()) return (data) => stdout.write(data)
  return (data) => stdout.write(wrap(data))
}
