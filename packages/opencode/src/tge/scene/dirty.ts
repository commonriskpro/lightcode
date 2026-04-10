/**
 * Dirty tracking for the scene graph.
 *
 * When a node's layout or style changes, it marks itself dirty.
 * Dirty propagates UP to ancestors (so the layout engine knows
 * which subtrees need re-resolve) and DOWN to children (so the
 * paint system knows which regions need re-raster).
 */

import type { SceneNode } from "./node"

/** Mark a node and all its ancestors as dirty. */
export function mark(node: SceneNode) {
  let cur: SceneNode | null = node
  while (cur && !cur.dirty) {
    cur.dirty = true
    cur = cur.parent
  }
  // If the node was already dirty, ancestors are already marked
  if (cur) cur.dirty = true
}

/** Mark a node and all descendants as dirty (for subtree invalidation). */
export function deep(node: SceneNode) {
  node.dirty = true
  for (const child of node.children) deep(child)
}

/** Clear dirty flag on a node (called after layout + paint). */
export function clean(node: SceneNode) {
  node.dirty = false
}

/** Clear dirty flags on an entire subtree. */
export function cleanAll(node: SceneNode) {
  node.dirty = false
  for (const child of node.children) cleanAll(child)
}

/** Collect all dirty leaf rects for the paint system. */
export function rects(node: SceneNode): Array<{ x: number; y: number; width: number; height: number }> {
  if (!node.dirty) return []
  // If this node has no dirty children, the whole node rect is dirty
  const dirtyChildren = node.children.filter((c) => c.dirty)
  if (dirtyChildren.length === 0) return [node.computed]
  // Otherwise, recurse into dirty children
  const result: Array<{ x: number; y: number; width: number; height: number }> = []
  for (const child of dirtyChildren) result.push(...rects(child))
  // Also include self if style changed (bg, border, etc.)
  result.push(node.computed)
  return result
}
