/**
 * Flex layout algorithm — simplified flexbox for the TGE.
 *
 * Supports:
 * - row / column direction
 * - flex grow / shrink
 * - gap
 * - align (cross axis)
 * - justify (main axis)
 * - padding
 *
 * Does NOT support: flex-wrap, order, align-content, baseline.
 */

import type { SceneNode, Edges } from "../scene"
import { resolve, intrinsic, clamp } from "./measure"

/** Run flex layout on a node and its children. */
export function flex(node: SceneNode) {
  const c = node.computed
  const p = node.layout.padding
  const dir = node.layout.flexDirection
  const gap = node.layout.gap
  const children = node.children.filter((ch) => ch.layout.position !== "absolute")
  if (children.length === 0) return

  const isRow = dir === "row"
  const mainSize = isRow ? c.width - p.left - p.right : c.height - p.top - p.bottom
  const crossSize = isRow ? c.height - p.top - p.bottom : c.width - p.left - p.right
  const totalGap = gap * (children.length - 1)

  // Pass 1: compute base sizes
  const bases: number[] = []
  const crosses: number[] = []
  let totalBase = 0
  let totalFlex = 0
  let totalShrink = 0

  for (const child of children) {
    const cw = resolve(child.layout.width, isRow ? mainSize : crossSize)
    const ch = resolve(child.layout.height, isRow ? crossSize : mainSize)
    const intr = intrinsic(child)
    const base = isRow
      ? child.layout.width === "auto"
        ? intr.width
        : cw
      : child.layout.height === "auto"
        ? intr.height
        : ch
    const cross = isRow
      ? child.layout.height === "auto"
        ? intr.height
        : ch
      : child.layout.width === "auto"
        ? intr.width
        : cw

    bases.push(base)
    crosses.push(cross)
    totalBase += base
    totalFlex += child.layout.flex
    totalShrink += child.layout.flexShrink
  }

  // Pass 2: distribute remaining space
  const remaining = mainSize - totalBase - totalGap
  const sizes: number[] = []
  for (let i = 0; i < children.length; i++) {
    let size = bases[i]
    if (remaining > 0 && totalFlex > 0) {
      size += (children[i].layout.flex / totalFlex) * remaining
    } else if (remaining < 0 && totalShrink > 0) {
      size += (children[i].layout.flexShrink / totalShrink) * remaining
    }
    const min = isRow ? children[i].layout.minWidth : children[i].layout.minHeight
    const max = isRow ? children[i].layout.maxWidth : children[i].layout.maxHeight
    sizes.push(clamp(Math.max(0, size), min, max))
  }

  // Pass 3: compute justify offsets
  const total = sizes.reduce((s, v) => s + v, 0) + totalGap
  let mainOffset = isRow ? p.left : p.top
  const extra = mainSize - total
  if (node.layout.justify === "center") mainOffset += extra / 2
  else if (node.layout.justify === "end") mainOffset += extra
  // "between" and "around" adjust gap instead
  let adjustedGap = gap
  if (node.layout.justify === "between" && children.length > 1) adjustedGap = gap + extra / (children.length - 1)
  else if (node.layout.justify === "around" && children.length > 0) {
    adjustedGap = gap + extra / children.length
    mainOffset += adjustedGap / 2
  }

  // Pass 4: write computed rects
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const mainDim = sizes[i]
    const crossDim = clamp(
      child.layout.align === "stretch" && node.layout.align === "stretch" ? crossSize : crosses[i],
      isRow ? child.layout.minHeight : child.layout.minWidth,
      isRow ? child.layout.maxHeight : child.layout.maxWidth,
    )

    // Cross-axis alignment
    let crossOffset = isRow ? p.top : p.left
    const align = node.layout.align
    if (align === "center") crossOffset += (crossSize - crossDim) / 2
    else if (align === "end") crossOffset += crossSize - crossDim

    const m = child.layout.margin
    if (isRow) {
      child.computed.x = c.x + mainOffset + m.left
      child.computed.y = c.y + crossOffset + m.top
      child.computed.width = Math.max(0, mainDim - m.left - m.right)
      child.computed.height = Math.max(0, crossDim - m.top - m.bottom)
    } else {
      child.computed.x = c.x + crossOffset + m.left
      child.computed.y = c.y + mainOffset + m.top
      child.computed.width = Math.max(0, crossDim - m.left - m.right)
      child.computed.height = Math.max(0, mainDim - m.top - m.bottom)
    }

    mainOffset += sizes[i] + adjustedGap
  }
}
