/**
 * Scene painter — walks the scene graph and paints each node.
 *
 * This is the glue between the scene graph and the paint primitives.
 * It traverses the tree in depth-first order, painting each node
 * based on its kind, then recursing into children.
 *
 * Handles:
 *   - Opacity stacking (parent opacity affects children)
 *   - Scroll offset (children of scroll containers are offset)
 *   - Clip rects (children of scroll/overflow:hidden are clipped)
 *   - Dirty checking (skip clean subtrees when possible)
 */

import type { PixelBuffer } from "./buffer"
import type { SceneNode, Rect } from "../scene/node"
import { buffer as createBuffer, clear as clearBuf } from "./buffer"
import { over, withOpacity } from "./composite"
import { panel } from "../primitives/panel"
import { chip } from "../primitives/chip"
import { node as graphNode } from "../primitives/node"
import { edge as graphEdge } from "../primitives/edge"
import { orbit as graphOrbit } from "../primitives/orbit"
import { overlay } from "../primitives/overlay"
import { divider } from "../primitives/divider"
import { text } from "../primitives/text"
import { scroll, offset as scrollOffset } from "../primitives/scroll"

/** Paint the entire scene graph onto the buffer. */
export function paint(root: SceneNode, buf: PixelBuffer) {
  visit(root, buf, 1, 0, 0)
}

function visit(nd: SceneNode, buf: PixelBuffer, opacity: number, offX: number, offY: number) {
  const eff = opacity * nd.style.opacity
  if (eff <= 0) return

  // Apply scroll offset from parent
  const saved = { x: nd.computed.x, y: nd.computed.y }
  nd.computed.x -= offX
  nd.computed.y -= offY

  // Paint this node
  if (eff >= 0.99) {
    paintNode(nd, buf)
  } else {
    // Reduced opacity: paint into temp buffer, then composite
    const c = nd.computed
    if (c.width > 0 && c.height > 0) {
      const tmp = createBuffer(c.width, c.height)
      // Shift computed rect to temp buffer origin
      const sx = c.x
      const sy = c.y
      nd.computed.x = 0
      nd.computed.y = 0
      paintNode(nd, tmp)
      nd.computed.x = sx
      nd.computed.y = sy
      withOpacity(buf, tmp, sx, sy, eff)
    }
  }

  // Recurse into children
  let childOffX = offX
  let childOffY = offY
  if (nd.kind === "scroll") {
    const off = scrollOffset(nd)
    childOffX += off.x
    childOffY += off.y
  }

  // Paint edges first (they go behind nodes in graph containers)
  if (nd.kind === "graph") {
    for (const child of nd.children) {
      if (child.data.type === "edge") visit(child, buf, eff, childOffX, childOffY)
    }
    for (const child of nd.children) {
      if (child.data.type !== "edge") visit(child, buf, eff, childOffX, childOffY)
    }
  } else {
    for (const child of nd.children) visit(child, buf, eff, childOffX, childOffY)
  }

  // Restore
  nd.computed.x = saved.x
  nd.computed.y = saved.y
}

function paintNode(nd: SceneNode, buf: PixelBuffer) {
  // Check data.type FIRST — sub-kinds like "node", "edge", "chip"
  // are created as kind="panel" but need specialized painting.
  const type = nd.data.type as string | undefined
  if (type === "node") return graphNode(buf, nd)
  if (type === "edge") return graphEdge(buf, nd)
  if (type === "orbit") return graphOrbit(buf, nd)
  if (type === "chip") return chip(buf, nd)
  if (type === "divider") return divider(buf, nd)

  switch (nd.kind) {
    case "panel":
    case "flex":
    case "root":
    case "absolute":
    case "input":
      panel(buf, nd)
      break
    case "text":
      text(buf, nd)
      break
    case "overlay":
      overlay(buf, nd)
      break
    case "scroll":
      scroll(buf, nd)
      break
    case "graph":
      panel(buf, nd)
      break
    case "slot":
      break
  }
}

/**
 * Collect text nodes that need cell-layer rendering.
 *
 * After painting pixels, the integration layer needs to know
 * which regions contain text so opentui can render it in cells.
 */
export function textRegions(
  root: SceneNode,
): Array<{ node: SceneNode; content: string; col: number; row: number; cols: number; rows: number }> {
  const result: Array<{ node: SceneNode; content: string; col: number; row: number; cols: number; rows: number }> = []
  collectText(root, result)
  return result
}

function collectText(
  nd: SceneNode,
  out: Array<{ node: SceneNode; content: string; col: number; row: number; cols: number; rows: number }>,
) {
  if (nd.kind === "text" && nd.data.content) {
    const cw = (nd.data.cellWidth as number) ?? 8
    const ch = (nd.data.cellHeight as number) ?? 16
    if (cw > 0 && ch > 0) {
      out.push({
        node: nd,
        content: nd.data.content as string,
        col: Math.floor(nd.computed.x / cw),
        row: Math.floor(nd.computed.y / ch),
        cols: Math.ceil(nd.computed.width / cw),
        rows: Math.ceil(nd.computed.height / ch),
      })
    }
  }
  for (const child of nd.children) collectText(child, out)
}
