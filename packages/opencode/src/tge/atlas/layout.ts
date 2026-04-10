/**
 * Atlas Field graph layout — positions nodes in concentric rings.
 *
 * Direct port of the ring layout from atlas-graph.tsx, adapted for
 * pixel coordinates instead of cell coordinates.
 *
 * The layout produces pixel positions for each node based on:
 *   - Ring (0 = center, 1 = inner, 2 = middle, 3 = outer)
 *   - Angular distribution within each ring
 *   - Jitter for organic feel
 */

import type { GraphNode, GraphEdge, NodeKind } from "./extract"

export type PlacedNode = GraphNode & {
  px: number
  py: number
}

export type Cluster = {
  label: string
  cx: number
  cy: number
}

export type Orbit = {
  rx: number
  ry: number
}

export type PlacedGraph = {
  nodes: PlacedNode[]
  edges: GraphEdge[]
  width: number
  height: number
  clusters: Map<string, Cluster>
  /** Ellipse radii for each ring (1-3), used to draw concentric orbit guides. */
  orbits: Orbit[]
}

/** Deterministic jitter based on a seed value. */
function jitter(seed: number, range: number): number {
  const x = Math.sin(seed * 9.8 + 7.1) * 0.5 + 0.5
  return Math.round((x - 0.5) * range)
}

/** Layout graph nodes in concentric rings within a pixel viewport. */
export function ring(nodes: GraphNode[], edges: GraphEdge[], w: number, h: number): PlacedGraph {
  const cx = w / 2
  const cy = h / 2
  const placed: PlacedNode[] = []

  // Group by ring
  const rings = new Map<number, GraphNode[]>()
  for (const n of nodes) {
    const list = rings.get(n.ring) ?? []
    list.push(n)
    rings.set(n.ring, list)
  }

  // Ring 0: center
  for (const n of rings.get(0) ?? []) {
    placed.push({ ...n, px: cx, py: cy })
  }

  // Rings 1-3: concentric ellipses with jitter
  // Margins and jitter scale with viewport size for resolution independence
  const margin = Math.max(4, Math.round(w * 0.04))
  const orbits: Orbit[] = []
  for (const idx of [1, 2, 3]) {
    const group = rings.get(idx) ?? []

    // Ellipse radii scale with viewport, capped to avoid overflow
    const rx = Math.min(w * 0.22 * idx, w / 2 - margin * 2)
    const ry = Math.min(h * 0.22 * idx, h / 2 - margin)
    // Always record the orbit even if empty — draws the guide ring
    orbits.push({ rx, ry })

    if (!group.length) continue
    const step = (2 * Math.PI) / Math.max(group.length, 1)
    const offset = idx * 0.7

    for (let i = 0; i < group.length; i++) {
      const angle = step * i + offset
      const jx = jitter(i + idx * 17, Math.max(1, Math.round(w * 0.01)))
      const jy = jitter(i + idx * 31, Math.max(1, Math.round(h * 0.02)))
      const px = cx + rx * Math.cos(angle) + jx
      const py = cy + ry * Math.sin(angle) + jy
      placed.push({
        ...group[i],
        px: Math.max(margin, Math.min(w - margin, px)),
        py: Math.max(margin, Math.min(h - margin, py)),
      })
    }
  }

  // Build cluster positions (centroid of cluster members)
  const clusters = new Map<string, Cluster>()
  const groups = new Map<string, PlacedNode[]>()
  for (const n of placed) {
    if (!n.cluster) continue
    const list = groups.get(n.cluster) ?? []
    list.push(n)
    groups.set(n.cluster, list)
  }
  for (const [key, members] of groups) {
    const avgX = members.reduce((s, m) => s + m.px, 0) / members.length
    const minY = Math.min(...members.map((m) => m.py))
    clusters.set(key, { label: key, cx: avgX, cy: minY - 4 })
  }

  return { nodes: placed, edges, width: w, height: h, clusters, orbits }
}
