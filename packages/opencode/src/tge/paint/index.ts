/**
 * Paint system — pixel rasterization for the TGE.
 *
 * Re-exports all drawing operations and the PixelBuffer type.
 */

export { buffer, resize, clear, clearRect, get, set, blend, sub } from "./buffer"
export type { PixelBuffer } from "./buffer"

export { fill, rounded, stroke } from "./rect"
export { line, bezier } from "./line"
export { filled as circle, stroked as ring } from "./circle"
export { halo, blur } from "./halo"
export { over, withOpacity } from "./composite"
export { tracker } from "./dirty"
export type { DirtyRect, DirtyTracker } from "./dirty"
export { paint, textRegions } from "./painter"
