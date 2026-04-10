/**
 * Backend selection and dispatch.
 */

export { kitty, type KittyBackend } from "./kitty"
export { cell, rasterize, type CellBackend } from "./cell"
export { cellPanel, cellCard, cellChip, cellOverlay, cellToast, cellComposer, cellStrip, cellDivider } from "./cell"
export type { Placement, PlacementManager, Region } from "./kitty"
