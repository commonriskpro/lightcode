/**
 * Hit testing against the scene graph.
 *
 * Given pixel coordinates, walks the scene tree to find the deepest
 * node that contains the point.
 */

import type { SceneNode } from "../scene"

/** Find the deepest node at pixel coordinates (x, y). */
export function test(root: SceneNode, x: number, y: number): SceneNode | null {
  return walk(root, x, y)
}

function walk(node: SceneNode, x: number, y: number): SceneNode | null {
  const c = node.computed
  // Check bounds
  if (x < c.x || x >= c.x + c.width || y < c.y || y >= c.y + c.height) return null
  // Check children in reverse order (topmost first)
  for (let i = node.children.length - 1; i >= 0; i--) {
    const hit = walk(node.children[i], x, y)
    if (hit) return hit
  }
  // If no child hit, this node is the target (unless it's root with no handler)
  return node
}

/** Convert cell coordinates to pixel coordinates. */
export function pixels(col: number, row: number, cellW: number, cellH: number): { x: number; y: number } {
  return { x: col * cellW, y: row * cellH }
}
