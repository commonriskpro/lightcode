/**
 * Kitty graphics backend — primary output backend for the TGE.
 *
 * Transmits pixel buffers to the terminal using the Kitty graphics protocol.
 */

import type { PixelBuffer } from "../../paint"
import { detect } from "./detect"
import { transmit, remove, clear as clearAll } from "./transmit"
import { manager, type PlacementManager, type Region } from "./placement"

export type KittyBackend = {
  kind: "kitty"
  supported: boolean
  placements: PlacementManager
  send(buf: PixelBuffer, region: Region, col: number, row: number): number
  remove(id: number): void
  clear(): void
  destroy(): void
}

export async function kitty(stdout: NodeJS.WriteStream, stdin: NodeJS.ReadStream): Promise<KittyBackend> {
  const supported = await detect(stdin, stdout)
  const placements = manager()

  return {
    kind: "kitty",
    supported,
    placements,

    send(buf, region, col, row) {
      if (!supported) return -1
      const id = placements.alloc(region)
      transmit(stdout, buf, id)
      placements.set({ id, col, row, width: 0, height: 0, pw: buf.width, ph: buf.height })
      return id
    },

    remove(id) {
      if (!supported) return
      remove(stdout, id)
      placements.remove(id)
    },

    clear() {
      if (!supported) return
      clearAll(stdout)
      placements.clear()
    },

    destroy() {
      if (supported) clearAll(stdout)
      placements.clear()
    },
  }
}

export { detect } from "./detect"
export { transmit, place, remove, clear } from "./transmit"
export { manager, type Placement, type PlacementManager, type Region } from "./placement"
export { inTmux, parent, supported as tmuxSupported, wrap, writer } from "./passthrough"
export { transmit as phTransmit, remove as phRemove, grid as phGrid, fg as phFg } from "./placeholder"
