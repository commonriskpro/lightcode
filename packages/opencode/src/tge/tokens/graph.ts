import { palette, alpha } from "./color"

/** Graph-specific visual tokens.
 *
 * Sizes are in pixels at 2x scale (2 pixels per terminal cell dimension).
 * drawSuperSampleBuffer renders quadrant blocks from 2×2 pixels per cell.
 * At 2x: 1px = 0.5 cells, radius 3 = 3 cells wide (diameter 6px).
 */
export const graph = {
  /** Center (active thread) node radius — ~3 cells wide */
  centerRadius: 3,
  /** Standard node radius (ring 1) — ~2 cells wide */
  nodeRadius: 2,
  /** Small node radius (ring 2-3) — ~1 cell wide */
  smallRadius: 1,

  /** Edge line widths at 2x */
  edgeStrong: 2,
  edgeNormal: 1,
  edgeWeak: 1,

  /** Halo glow around center node — ~5 cells radius */
  haloRadius: 6,
  haloColor: alpha(palette.thread, 0x90),

  /** Cluster halo */
  clusterHaloRadius: 4,
  clusterHaloColor: alpha(palette.borderStrong, 0x50),

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

  /** Edge colors */
  edge: {
    strong: palette.borderStrong,
    normal: palette.borderBase,
    weak: palette.borderWeak,
  },
} as const
