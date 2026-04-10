/**
 * Absolute positioning resolver.
 *
 * Positions nodes with position="absolute" relative to their parent's
 * computed rect, using top/left/right/bottom offsets.
 */

import type { SceneNode } from "../scene"
import { resolve, clamp } from "./measure"

export function absolute(node: SceneNode) {
  const children = node.children.filter((ch) => ch.layout.position === "absolute")
  if (children.length === 0) return
  const parent = node.computed

  for (const child of children) {
    const l = child.layout
    const w = resolve(l.width, parent.width)
    const h = resolve(l.height, parent.height)

    let x = parent.x
    let y = parent.y
    let width = w || parent.width
    let height = h || parent.height

    // Horizontal: if both left and right are set, derive width
    if (l.left !== 0) x = parent.x + l.left
    if (l.right !== 0 && l.left !== 0) width = parent.width - l.left - l.right
    else if (l.right !== 0) x = parent.x + parent.width - l.right - width

    // Vertical: if both top and bottom are set, derive height
    if (l.top !== 0) y = parent.y + l.top
    if (l.bottom !== 0 && l.top !== 0) height = parent.height - l.top - l.bottom
    else if (l.bottom !== 0) y = parent.y + parent.height - l.bottom - height

    child.computed.x = x
    child.computed.y = y
    child.computed.width = clamp(width, l.minWidth, l.maxWidth)
    child.computed.height = clamp(height, l.minHeight, l.maxHeight)
  }
}
