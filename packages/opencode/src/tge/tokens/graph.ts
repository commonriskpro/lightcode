import { palette, alpha } from "./color"

/** Graph-specific visual tokens.
 *
 * Sizes are calibrated for supersample rendering where ~10x20 pixels
 * map to one terminal cell. Nodes need to be large enough that
 * drawSuperSampleBuffer produces visible color in the cell average.
 */
export const graph = {
  /** Center (active thread) node radius in pixels */
  centerRadius: 40,
  /** Standard node radius (ring 1) — must cover at least 3x2 cells after supersample */
  nodeRadius: 24,
  /** Small node radius (ring 2-3) — must cover at least 2x1 cells after supersample */
  smallRadius: 16,

  /** Edge line widths — must survive supersample averaging (>= cellW/2) */
  edgeStrong: 8,
  edgeNormal: 6,
  edgeWeak: 4,

  /** Halo glow around center node — high alpha to survive supersample */
  haloRadius: 80,
  haloColor: alpha(palette.thread, 0xa0),

  /** Cluster halo */
  clusterHaloRadius: 60,
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
