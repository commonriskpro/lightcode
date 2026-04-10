/**
 * Atlas Field scene builder — converts graph data into a TGE scene graph.
 *
 * Takes the extracted + laid-out graph data and builds a full TGE scene
 * that can be painted to a PixelBuffer.
 *
 * The scene includes:
 *   - Graph container (background)
 *   - Cluster halos and labels
 *   - Edges (anti-aliased lines/curves)
 *   - Nodes (circles with halos)
 *   - Node labels (text regions for cell-layer rendering)
 */

import { scene as createScene, type Scene, type SceneNode } from "../scene"
import { surface, accent, palette, alpha } from "../tokens"
import { graph as graphTokens } from "../tokens"
import type { PlacedGraph, PlacedNode, Cluster } from "./layout"
import type { EdgeWeight } from "./extract"

/** Build a TGE scene graph from a placed graph. */
export function build(pg: PlacedGraph, cellW: number, cellH: number): Scene {
  const s = createScene(pg.width, pg.height)

  // Root is transparent — only graphical elements paint pixels.
  // The bridge skips transparent areas, letting opentui content show.
  s.update(s.root, { style: { bg: 0x00000000 } })

  // Cluster halos (painted first, behind everything)
  for (const [, cluster] of pg.clusters) {
    s.add("panel", {
      tag: "cluster-halo",
      layout: {
        position: "absolute",
        left: cluster.cx - graphTokens.clusterHaloRadius,
        top: cluster.cy - graphTokens.clusterHaloRadius / 2,
        width: graphTokens.clusterHaloRadius * 2,
        height: graphTokens.clusterHaloRadius,
      },
      style: { halo: { radius: graphTokens.clusterHaloRadius, color: graphTokens.clusterHaloColor, intensity: 0.5 } },
    })

    // Cluster label (text node for cell-layer rendering)
    s.add("text", {
      tag: "cluster-label",
      layout: {
        position: "absolute",
        left: cluster.cx - (cluster.label.length * cellW) / 2,
        top: cluster.cy,
        width: cluster.label.length * cellW,
        height: cellH,
      },
      style: { fg: palette.borderStrong },
      data: { content: cluster.label, cellWidth: cellW, cellHeight: cellH },
    })
  }

  // Graph container for z-ordering (edges before nodes)
  const container = s.add("graph", {
    tag: "graph-container",
    layout: { position: "absolute", left: 0, top: 0, width: pg.width, height: pg.height },
  })

  // Build node index for edge lookup
  const idx = new Map(pg.nodes.map((n) => [n.id, n]))

  // Edges
  for (const e of pg.edges) {
    const a = idx.get(e.from)
    const b = idx.get(e.to)
    if (!a || !b) continue

    // Compute curvature based on distance and ring
    const dx = b.px - a.px
    const dy = b.py - a.py
    const dist = Math.sqrt(dx * dx + dy * dy)
    const curve = dist > 200 ? dist * 0.15 : dist > 100 ? dist * 0.1 : 0

    s.add(
      "panel",
      {
        tag: `edge-${e.from}-${e.to}`,
        data: { type: "edge", x0: a.px, y0: a.py, x1: b.px, y1: b.py, weight: e.weight, curve },
      },
      container,
    )
  }

  // Nodes
  for (const n of pg.nodes) {
    const r = n.ring === 0 ? graphTokens.centerRadius : n.ring <= 1 ? graphTokens.nodeRadius : graphTokens.smallRadius
    const size = (r + (n.ring === 0 ? graphTokens.haloRadius : r * 2)) * 2

    s.add(
      "panel",
      {
        tag: `node-${n.id}`,
        layout: {
          position: "absolute",
          left: n.px - size / 2,
          top: n.py - size / 2,
          width: size,
          height: size,
        },
        data: { type: "node", kind: n.kind, ring: n.ring, selected: false, hover: false },
      },
      container,
    )

    // Node label (text for cell-layer)
    const label = n.label
    const labelW = label.length * cellW
    const labelX = n.px - labelW / 2
    const labelY =
      n.ring === 0
        ? n.py + graphTokens.centerRadius + 6 // below center node
        : n.py + r + 3 // below regular node
    const labelColor =
      n.ring === 0
        ? accent.thread
        : n.ring <= 1
          ? (graphTokens.node[n.kind] ?? palette.text)
          : n.ring <= 2
            ? palette.muted
            : alpha(palette.muted, 0x80)

    s.add(
      "text",
      {
        tag: `label-${n.id}`,
        layout: {
          position: "absolute",
          left: Math.max(2, Math.min(pg.width - labelW - 2, labelX)),
          top: Math.min(pg.height - cellH - 2, labelY),
          width: labelW,
          height: cellH,
        },
        style: { fg: labelColor },
        data: { content: label, cellWidth: cellW, cellHeight: cellH },
      },
      container,
    )

    // "current thread" subtitle for center node
    if (n.ring === 0) {
      const sub = "current thread"
      const subW = sub.length * cellW
      s.add(
        "text",
        {
          tag: "center-subtitle",
          layout: {
            position: "absolute",
            left: n.px - subW / 2,
            top: labelY + cellH + 2,
            width: subW,
            height: cellH,
          },
          style: { fg: palette.muted },
          data: { content: sub, cellWidth: cellW, cellHeight: cellH },
        },
        container,
      )
    }
  }

  return s
}
