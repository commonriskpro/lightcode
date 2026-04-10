import { palette, alpha } from "./color"

/** Graph-specific visual tokens.
 *
 * Sizes are in SCREEN PIXELS (the actual pixel dimensions of terminal cells).
 * The TGE renders in screen-pixel coordinates where 1px = 1 screen pixel,
 * so circles are naturally circular. The bridge area-samples the buffer
 * down to 2x (2 pixels per cell) for drawSuperSampleBuffer.
 *
 * With typical Ghostty cells of 7×18px:
 *   radius 20 = ~6 cells wide, ~2 cells tall = circular on screen (40×40px)
 */
export const graph = {
  /** Center (active thread) node radius in screen pixels */
  centerRadius: 20,
  /** Standard node radius (ring 1) — ~3 cells wide */
  nodeRadius: 12,
  /** Small node radius (ring 2-3) — ~2 cells wide */
  smallRadius: 8,

  /** Edge line widths in screen pixels */
  edgeStrong: 3,
  edgeNormal: 2,
  edgeWeak: 2,

  /** Halo glow around center node — ~8 cells radius */
  haloRadius: 32,
  haloColor: alpha(palette.thread, 0x70),

  /** Orbit ring guides (concentric ellipses behind nodes) */
  orbitWidth: 5,
  orbitColor: alpha(palette.borderStrong, 0x60),

  /** Cluster halo */
  clusterHaloRadius: 24,
  clusterHaloColor: alpha(palette.borderStrong, 0x40),

  /** Node colors by kind */
  node: {
    thread: palette.thread,
    anchor: palette.anchor,
    signal: palette.signal,
    drift: palette.drift,
    file: palette.text,
    mcp: palette.muted,
    parent: palette.anchor,
    child: palette.thread,
  },

  /** Edge colors — visible against void black background */
  edge: {
    strong: alpha(palette.muted, 0xcc), // #52587a at 80% — visible but subtle
    normal: alpha(palette.borderFocus, 0xaa), // #3e4a68 at 67%
    weak: alpha(palette.borderStrong, 0x70), // #303850 at 44%
  },
} as const
