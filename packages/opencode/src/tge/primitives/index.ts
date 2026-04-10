/**
 * TGE Primitives — the building blocks of every LightCode surface.
 *
 * Each primitive knows how to paint one kind of scene node
 * onto a PixelBuffer. The scene painter dispatches to the
 * correct primitive based on node.kind and node.data.
 */

export { panel } from "./panel"
export { chip, fg as chipFg } from "./chip"
export { node as graphNode } from "./node"
export { edge as graphEdge } from "./edge"
export { overlay } from "./overlay"
export { divider } from "./divider"
export { text, cells as textCells } from "./text"
export { scroll, offset as scrollOffset, scrollTo, scrollBy } from "./scroll"
