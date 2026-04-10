/**
 * TGE bridge — integration layer between TGE and opentui.
 */

export { bridge, type Bridge, type Region } from "./opentui"
export { TGEProvider, useTGE } from "./context"
export { detect, isPixel, label, type RenderMode } from "./detect"
export { dialog, panel, card, composer, toast, chip, strip } from "./surface"
export { TGEDialog, TGEPanel, TGECard, TGEComposer, TGEToast, TGEChip, TGEFieldStrip } from "./wrappers"
