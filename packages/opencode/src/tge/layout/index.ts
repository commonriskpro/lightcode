/**
 * Layout engine entry point — resolves constraints for the scene graph.
 *
 * Two-pass algorithm:
 * 1. Measure (bottom-up) — compute intrinsic sizes
 * 2. Resolve (top-down) — distribute space, compute final rects
 */

import type { SceneNode } from "../scene"
import { walk } from "../scene"
import { flex } from "./flex"
import { absolute } from "./absolute"
import { resolve as resolveSize, clamp } from "./measure"

/** Resolve layout for the entire scene graph. */
export function layout(root: SceneNode, viewport: { width: number; height: number }) {
  root.computed.x = 0
  root.computed.y = 0
  root.computed.width = viewport.width
  root.computed.height = viewport.height
  // Top-down resolve
  resolve(root)
}

function resolve(node: SceneNode) {
  // First, resolve this node's children sizes based on explicit constraints
  for (const child of node.children) {
    if (child.layout.position === "absolute") continue
    const l = child.layout
    const pw = node.computed.width - node.layout.padding.left - node.layout.padding.right
    const ph = node.computed.height - node.layout.padding.top - node.layout.padding.bottom
    // Set explicit sizes before flex distribution
    if (l.width !== "auto" && typeof l.width === "number") {
      child.computed.width = clamp(l.width, l.minWidth, l.maxWidth)
    } else if (typeof l.width === "string" && l.width.endsWith("%")) {
      child.computed.width = clamp(resolveSize(l.width, pw), l.minWidth, l.maxWidth)
    }
    if (l.height !== "auto" && typeof l.height === "number") {
      child.computed.height = clamp(l.height, l.minHeight, l.maxHeight)
    } else if (typeof l.height === "string" && l.height.endsWith("%")) {
      child.computed.height = clamp(resolveSize(l.height, ph), l.minHeight, l.maxHeight)
    }
  }

  // Run flex layout for relative children
  flex(node)
  // Position absolute children
  absolute(node)
  // Recurse into children
  for (const child of node.children) resolve(child)
}

export { flex } from "./flex"
export { absolute } from "./absolute"
export { resolve as resolveSize, intrinsic, clamp } from "./measure"
