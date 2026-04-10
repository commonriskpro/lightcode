/**
 * Focus management for the TGE scene graph.
 *
 * Tracks which node currently has focus and handles
 * tab cycling through focusable nodes.
 */

import type { SceneNode } from "../scene"
import { collect } from "../scene"

export type FocusState = {
  current: SceneNode | null
  focus(node: SceneNode | null): void
  next(root: SceneNode): SceneNode | null
  prev(root: SceneNode): SceneNode | null
}

const FOCUSABLE = new Set(["input", "panel", "scroll", "graph"])

export function focus(): FocusState {
  let current: SceneNode | null = null

  return {
    get current() {
      return current
    },

    focus(node) {
      current = node
    },

    next(root) {
      const nodes = collect(root, (n) => FOCUSABLE.has(n.kind))
      if (nodes.length === 0) return null
      if (!current) {
        current = nodes[0]
        return current
      }
      const idx = nodes.indexOf(current)
      current = nodes[(idx + 1) % nodes.length]
      return current
    },

    prev(root) {
      const nodes = collect(root, (n) => FOCUSABLE.has(n.kind))
      if (nodes.length === 0) return null
      if (!current) {
        current = nodes[nodes.length - 1]
        return current
      }
      const idx = nodes.indexOf(current)
      current = nodes[(idx - 1 + nodes.length) % nodes.length]
      return current
    },
  }
}
