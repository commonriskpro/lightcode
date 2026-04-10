/**
 * TGE-powered Atlas Field graph component.
 *
 * Replaces the Unicode-art AtlasGraph with pixel-rendered graphics
 * via the Terminal Graphics Engine.
 *
 * Integration:
 *   1. Compute graph data from session state (same extract logic)
 *   2. Render to PixelBuffer via TGE
 *   3. Submit pixel buffer to TGE bridge (→ postProcessFn → OptimizedBuffer)
 *   4. Overlay text labels in cell layer via opentui's normal text rendering
 *
 * Same props interface as the original AtlasGraph = drop-in replacement.
 */

import { createMemo, createResource, createSignal, createEffect, onCleanup, onMount, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { extract, render as renderAtlas, type AtlasFrame } from "@/tge/atlas"
import { useTGE } from "@/tge/bridge/context"

type Memory = {
  observations: string | null
  reflections: string | null
  observation_tokens: number
  generation_count: number
  is_observing: boolean
  is_reflecting: boolean
}

export function AtlasGraphTGE(props: { sessionID: string; width: number; height: number }) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const tge = useTGE()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const diffs = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const mcp = createMemo(() => Object.entries(sync.data.mcp).map(([name, item]) => ({ name, status: item.status })))
  const status = createMemo(() => sync.data.session_status?.[props.sessionID]?.type)

  // Memory polling (same as original)
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000)
    onCleanup(() => clearInterval(id))
  })
  const [mem] = createResource(tick, async (): Promise<Memory | null> => {
    try {
      const res = await sdk.client.session.memory({ sessionID: props.sessionID })
      return (res.data as Memory) ?? null
    } catch {
      return null
    }
  })

  // Pixel dimensions for the graph region
  const pixelW = createMemo(() => props.width * tge.cellW())
  const pixelH = createMemo(() => props.height * tge.cellH())

  // Extract graph data
  const data = createMemo(() => {
    const s = session()
    if (!s) return null
    return extract(
      s as any,
      sync.data.session as any,
      messages() as any,
      sync.data.part as any,
      todos() as any,
      diffs() as any,
      mcp(),
      status(),
      mem() ?? null,
    )
  })

  // Render to pixel buffer
  const frame = createMemo((): AtlasFrame | null => {
    const d = data()
    if (!d) return null
    const pw = pixelW()
    const ph = pixelH()
    if (pw <= 0 || ph <= 0) return null
    return renderAtlas(d, pw, ph, tge.cellW(), tge.cellH())
  })

  // Submit pixel buffer to bridge on every frame update
  createEffect(() => {
    const f = frame()
    if (!f || !tge.active()) return
    tge.submit({
      key: "atlas-field",
      col: 0,
      row: 0,
      cols: props.width,
      rows: props.height,
      buf: f.buffer,
    })
  })

  // Clean up pixel region on unmount
  onCleanup(() => tge.clear())

  // Color lookup for text labels (Void Black semantics)
  const labelColor = (kind: string, ring: number) => {
    if (ring === 0) return theme.info
    if (ring <= 1) {
      const map: Record<string, typeof theme.text> = {
        thread: theme.info,
        parent: theme.secondary,
        child: theme.secondary,
        anchor: theme.secondary,
        signal: theme.warning,
        drift: theme.error,
        file: theme.text,
        mcp: theme.textMuted,
      }
      return map[kind] ?? theme.text
    }
    return theme.textMuted
  }

  return (
    <box width={props.width} height={props.height}>
      <Show when={frame()}>
        {(f) => (
          <For each={f().texts}>
            {(region) => (
              <box position="absolute" left={region.col} top={region.row} width={region.cols} height={region.rows}>
                <text
                  fg={labelColor((region.node.data.kind as string) ?? "", (region.node.data.ring as number) ?? 2)}
                  wrapMode="none"
                >
                  {region.content}
                </text>
              </box>
            )}
          </For>
        )}
      </Show>
      <Show when={!frame()}>
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.textMuted}>Loading atlas field…</text>
        </box>
      </Show>
    </box>
  )
}
