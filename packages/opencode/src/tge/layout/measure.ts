/**
 * Measure pass — bottom-up intrinsic size computation.
 *
 * Leaf nodes report their preferred size; containers aggregate.
 * This runs before the resolve pass.
 */

import type { SceneNode, Size } from "../scene"

/** Resolve a Size value to pixels given a parent dimension. */
export function resolve(size: Size, parent: number): number {
  if (typeof size === "number") return size
  if (size === "auto") return 0
  if (size.endsWith("%")) return (parseFloat(size) / 100) * parent
  return parseFloat(size) || 0
}

/** Compute intrinsic (content) width for a node. */
export function intrinsic(node: SceneNode): { width: number; height: number } {
  if (node.kind === "text") {
    // Text nodes measure by character count × cell dimensions
    // This is a placeholder — real measurement needs cell size from the runtime
    const content = (node.data.content as string) ?? ""
    const lines = content.split("\n")
    const cols = Math.max(1, ...lines.map((l) => l.length))
    const rows = Math.max(1, lines.length)
    const cw = (node.data.cellWidth as number) ?? 8
    const ch = (node.data.cellHeight as number) ?? 16
    return { width: cols * cw, height: rows * ch }
  }
  // Non-text leaf nodes have zero intrinsic size unless explicitly sized
  return { width: 0, height: 0 }
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
