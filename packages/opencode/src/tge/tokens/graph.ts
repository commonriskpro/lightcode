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

  /** Edge line widths at 8x */
  edgeStrong: 8,
  edgeNormal: 5,
  edgeWeak: 3,

  /** Halo glow around center node — ~8 cells radius */
  haloRadius: 32,
  haloColor: alpha(palette.thread, 0x70),

  /** Orbit ring guides (concentric ellipses behind nodes) */
  orbitWidth: 3,
  orbitColor: alpha(palette.borderBase, 0x45),

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

  /** Edge colors — brighter than border tokens to survive downsample + quadrant rendering */
  edge: {
    strong: palette.borderFocus,
    normal: palette.borderStrong,
    weak: palette.borderBase,
  },
} as const
