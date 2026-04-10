/**
 * Hit testing for the Atlas Field graph.
 *
 * Given a click position in screen-pixel coordinates, finds the nearest
 * node within its hit radius. Returns null if no node is close enough.
 */

import type { PlacedNode } from "./layout"
import { graph } from "../tokens"

/** Hit radius multiplier — generous touch targets for terminal mouse. */
const PAD = 1.6

function radius(ring: number): number {
  if (ring === 0) return graph.centerRadius
  if (ring <= 1) return graph.nodeRadius
  return graph.smallRadius
}

/**
 * Find the node at pixel position (px, py), or null if none.
 * Uses the node's ring to determine its hit radius.
 */
export function hit(nodes: PlacedNode[], px: number, py: number): PlacedNode | null {
  let best: PlacedNode | null = null
  let shortest = Infinity

  for (const n of nodes) {
    const dx = px - n.px
    const dy = py - n.py
    const d = Math.sqrt(dx * dx + dy * dy)
    const r = radius(n.ring) * PAD
    if (d <= r && d < shortest) {
      shortest = d
      best = n
    }
  }

  return best
}

/**
 * Find the nearest node to (px, py) regardless of distance.
 * Useful for keyboard navigation — always returns a node if any exist.
 */
export function nearest(nodes: PlacedNode[], px: number, py: number): PlacedNode | null {
  if (nodes.length === 0) return null
  let best = nodes[0]
  let shortest = Infinity

  for (const n of nodes) {
    const dx = px - n.px
    const dy = py - n.py
    const d = dx * dx + dy * dy
    if (d < shortest) {
      shortest = d
      best = n
    }
  }

  return best
}
