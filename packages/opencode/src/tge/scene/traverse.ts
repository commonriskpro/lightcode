/**
 * Tree traversal utilities for the scene graph.
 */

import type { SceneNode } from "./node"

/** Depth-first pre-order walk. Callback receives node and depth. */
export function walk(node: SceneNode, fn: (node: SceneNode, depth: number) => void, depth = 0) {
  fn(node, depth)
  for (const child of node.children) walk(child, fn, depth + 1)
}

/** Depth-first post-order walk (children before parent — useful for measure pass). */
export function post(node: SceneNode, fn: (node: SceneNode, depth: number) => void, depth = 0) {
  for (const child of node.children) post(child, fn, depth + 1)
  fn(node, depth)
}

/** Find a node by id. */
export function find(root: SceneNode, id: string): SceneNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = find(child, id)
    if (found) return found
  }
  return null
}

/** Find a node by tag. */
export function tagged(root: SceneNode, tag: string): SceneNode | null {
  if (root.tag === tag) return root
  for (const child of root.children) {
    const found = tagged(child, tag)
    if (found) return found
  }
  return null
}

/** Collect all nodes matching a predicate. */
export function collect(root: SceneNode, pred: (node: SceneNode) => boolean): SceneNode[] {
  const result: SceneNode[] = []
  walk(root, (node) => {
    if (pred(node)) result.push(node)
  })
  return result
}

/** Count total nodes in a subtree. */
export function count(node: SceneNode): number {
  let total = 1
  for (const child of node.children) total += count(child)
  return total
}

/** Get ancestors from node to root (inclusive). */
export function ancestors(node: SceneNode): SceneNode[] {
  const result: SceneNode[] = []
  let cur: SceneNode | null = node
  while (cur) {
    result.push(cur)
    cur = cur.parent
  }
  return result
}
