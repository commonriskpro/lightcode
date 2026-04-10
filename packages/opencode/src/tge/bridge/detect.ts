/**
 * TGE capability detection — determines the best rendering mode.
 *
 * Detection order:
 *   1. Check env var OPENCODE_TGE_MODE (explicit override)
 *   2. If inside tmux, check for capable parent terminal (passthrough mode)
 *   3. Check TERM_PROGRAM for known Kitty-graphics-capable terminals
 *   4. Check renderer.resolution for pixel dimension availability
 *   5. Fall back to "cell" mode
 *
 * Modes:
 *   - "supersample" — pixel rendering via drawSuperSampleBuffer (best quality)
 *   - "halfblock" — pixel rendering via ▀ half-block characters (universal)
 *   - "cell" — pure cell-mode rendering with Unicode box-drawing (degraded)
 */

import { inTmux, supported as tmuxSupported } from "../backend/kitty/passthrough"

export type RenderMode = "supersample" | "halfblock" | "cell"

/** Known terminals that support Kitty graphics protocol. */
const PIXEL_TERMINALS = new Set(["kitty", "wezterm", "iterm2", "iterm.app", "ghostty"])

/** Detect the best rendering mode for the current terminal. */
export function detect(resolution: { width: number; height: number } | null): RenderMode {
  // 1. Explicit override
  const override = process.env["OPENCODE_TGE_MODE"]?.toLowerCase()
  if (override === "supersample" || override === "halfblock" || override === "cell") return override

  // 2. tmux: check for passthrough to capable parent terminal
  if (inTmux()) {
    if (tmuxSupported()) {
      // tmux + capable parent (Ghostty, Kitty, WezTerm, iTerm2)
      // Use supersample if resolution available, else halfblock
      if (resolution && resolution.width > 0 && resolution.height > 0) return "supersample"
      return "halfblock"
    }
    // tmux with unknown parent — cell mode (screen also lands here)
    return "cell"
  }

  // 3. Direct terminal — check TERM_PROGRAM
  const prog = (process.env["TERM_PROGRAM"] ?? "").toLowerCase()
  const capable = PIXEL_TERMINALS.has(prog)

  // 4. Check pixel resolution availability
  if (resolution && resolution.width > 0 && resolution.height > 0) {
    return capable ? "supersample" : "halfblock"
  }

  // 5. Terminal is capable but no resolution yet
  if (capable) return "halfblock"

  // 6. No pixel info at all
  return "cell"
}

/** Human-readable mode description (for debug/status display). */
export function label(mode: RenderMode): string {
  const suffix = inTmux() ? " (tmux passthrough)" : ""
  if (mode === "supersample") return `TGE Pixel (supersample)${suffix}`
  if (mode === "halfblock") return `TGE Pixel (half-block)${suffix}`
  return "Cell mode (fallback)"
}

/** Check if a mode supports pixel rendering. */
export function isPixel(mode: RenderMode): boolean {
  return mode !== "cell"
}
