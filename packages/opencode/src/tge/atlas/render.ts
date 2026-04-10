/**
 * Atlas Field renderer — paints the graph scene to a PixelBuffer.
 *
 * Orchestrates:
 *   1. Build scene graph from session data
 *   2. Run layout engine
 *   3. Paint scene to pixel buffer
 *   4. Return buffer + text regions for cell-layer integration
 */

import type { GraphData } from "./extract"
import { ring as ringLayout, type PlacedGraph } from "./layout"
import { build } from "./build"
import { buffer as createBuffer, clear, paint, textRegions, type PixelBuffer } from "../paint"
import { layout as resolveLayout } from "../layout"
import type { SceneNode } from "../scene"

export type AtlasFrame = {
  buffer: PixelBuffer
  texts: Array<{ node: SceneNode; content: string; col: number; row: number; cols: number; rows: number }>
  graph: PlacedGraph
}

/** Render the Atlas Field to a pixel buffer. */
export function render(data: GraphData, width: number, height: number, cellW: number, cellH: number): AtlasFrame {
  // 1. Layout nodes in concentric rings
  const placed = ringLayout(data.nodes, data.edges, width, height)

  // 2. Build TGE scene graph
  const scene = build(placed, cellW, cellH)

  // 3. Resolve layout (positions absolute nodes)
  resolveLayout(scene.root, { width, height })

  // 4. Paint to pixel buffer
  // Background is transparent — bridge will alpha-blend onto void black.
  const buf = createBuffer(width, height)
  clear(buf, 0x00000000)
  paint(scene.root, buf)

  // 5. Collect text regions for cell-layer rendering
  const texts = textRegions(scene.root)

  return { buffer: buf, texts, graph: placed }
}
