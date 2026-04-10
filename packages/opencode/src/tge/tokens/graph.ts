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
  /** Standard node radius */
  nodeRadius: 18,
  /** Small node radius (ring 3+) */
  smallRadius: 12,

  /** Edge line widths */
  edgeStrong: 4,
  edgeNormal: 3,
  edgeWeak: 2,

  /** Halo glow around center node */
  haloRadius: 80,
  haloColor: alpha(palette.thread, 0x50),

  /** Cluster halo */
  clusterHaloRadius: 50,
  clusterHaloColor: alpha(palette.borderStrong, 0x30),

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
