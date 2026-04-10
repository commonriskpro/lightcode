/**
 * TGE Provider — SolidJS context that manages the TGE bridge lifecycle.
 *
 * Responsibilities:
 *   - Auto-detect rendering mode (supersample / halfblock / cell)
 *   - Create and manage the pixel bridge
 *   - Register/unregister the postProcessFn on the renderer
 *   - Provide cell dimensions and bridge to child components
 *   - Handle resize events
 *   - Graceful degradation when pixel rendering is unavailable
 */

import { createContext, useContext, onMount, onCleanup, createSignal, createMemo, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { bridge, type Bridge, type Region } from "./opentui"
import { detect, isPixel, label, type RenderMode } from "./detect"

type TGEContext = {
  /** Cell width in pixels */
  cellW: () => number
  /** Cell height in pixels */
  cellH: () => number
  /** Whether TGE pixel rendering is active (supersample or halfblock) */
  active: () => boolean
  /** Whether TGE is in any mode (including cell) */
  ready: () => boolean
  /** Submit a pixel region for rendering (no-op in cell mode) */
  submit: (region: Region) => void
  /** Clear all pixel regions */
  clear: () => void
  /** Current rendering mode */
  mode: () => RenderMode
  /** Human-readable mode label */
  label: () => string
}

const Ctx = createContext<TGEContext>()

export function TGEProvider(props: { mode?: RenderMode | "auto"; children: JSX.Element }) {
  const renderer = useRenderer()

  const [cellW, setCellW] = createSignal(8)
  const [cellH, setCellH] = createSignal(16)
  const [ready, setReady] = createSignal(false)

  const mode = createMemo((): RenderMode => {
    if (props.mode && props.mode !== "auto") return props.mode
    return detect(renderer.resolution)
  })

  const active = createMemo(() => isPixel(mode()))

  let ref: Bridge | null = null

  function sync() {
    const res = renderer.resolution
    if (res && renderer.width > 0 && renderer.height > 0) {
      setCellW(Math.max(1, Math.floor(res.width / renderer.width)))
      setCellH(Math.max(1, Math.floor(res.height / renderer.height)))
    }
  }

  function setup() {
    sync()
    if (ref) {
      renderer.removePostProcessFn(ref.process)
      ref.destroy()
    }
    const m = mode()
    if (isPixel(m)) {
      const bm = m === "supersample" ? "supersample" : "halfblock"
      ref = bridge(cellW(), cellH(), bm)
      renderer.addPostProcessFn(ref.process)
    } else {
      ref = null
    }
  }

  onMount(() => {
    setup()
    setReady(true)

    const resize = () => {
      setup()
    }

    renderer.on("resize", resize)
    onCleanup(() => {
      renderer.off("resize", resize)
      if (ref) {
        renderer.removePostProcessFn(ref.process)
        ref.destroy()
        ref = null
      }
      setReady(false)
    })
  })

  const ctx: TGEContext = {
    cellW,
    cellH,
    active,
    ready,
    submit(region) {
      if (!ref) return
      ref.submit(region)
      renderer.requestRender()
    },
    clear() {
      ref?.clear()
    },
    mode,
    label: () => label(mode()),
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

/** Access the TGE bridge context. */
export function useTGE(): TGEContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useTGE must be used within a TGEProvider")
  return ctx
}
