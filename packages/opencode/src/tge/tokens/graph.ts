import { palette, alpha } from "./color"

/** Graph-specific visual tokens.
 *
 * Sizes are calibrated for supersample rendering where ~10x20 pixels
 * map to one terminal cell. Nodes need to be large enough that
 * drawSuperSampleBuffer produces visible color in the cell average.
 */
export const graph = {
  /** Center (active thread) node radius in pixels (~4 cells wide, ~2 cells tall) */
  centerRadius: 16,
  /** Standard node radius (ring 1) — ~3 cells wide */
  nodeRadius: 10,
  /** Small node radius (ring 2-3) — ~2 cells wide */
  smallRadius: 7,

  /** Edge line widths — must survive supersample averaging */
  edgeStrong: 6,
  edgeNormal: 4,
  edgeWeak: 3,

  /** Halo glow around center node */
  haloRadius: 36,
  haloColor: alpha(palette.thread, 0x70),

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

  /** Edge colors */
  edge: {
    strong: palette.borderStrong,
    normal: palette.borderBase,
    weak: palette.borderWeak,
  },
} as const
