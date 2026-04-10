/**
 * TGE-powered Atlas Field graph component.
 *
 * Replaces the Unicode-art AtlasGraph with pixel-rendered graphics
 * via the Terminal Graphics Engine.
 *
 * Integration:
 *   1. Compute graph data from session state (same extract logic)
 *   2. Render to PixelBuffer via TGE
 *   3. Submit pixel buffer + text labels to TGE bridge
 *   4. Bridge calls drawSuperSampleBuffer, then drawText for labels
 *
 * Labels are rendered AFTER supersample so they are never overwritten.
 *
 * Same props interface as the original AtlasGraph = drop-in replacement.
 */

import { createMemo, createResource, createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { extract, render as renderAtlas, type AtlasFrame } from "@/tge/atlas"
import { useTGE } from "@/tge/bridge/context"
import { type RGBA, type Renderable } from "@opentui/core"
import type { TextLabel } from "@/tge/bridge/opentui"

type Memory = {
  observations: string | null
  reflections: string | null
  observation_tokens: number
  generation_count: number
  is_observing: boolean
  is_reflecting: boolean
}

/** Pack an opentui RGBA into a u32 0xRRGGBBAA. */
function pack(c: RGBA): number {
  const [r, g, b, a] = c.toInts()
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}

/** Walk up the renderable tree to compute absolute terminal position. */
function abs(r: Renderable): { col: number; row: number } {
  let col = 0
  let row = 0
  let cur: Renderable | null = r
  while (cur) {
    col += cur.x
    row += cur.y
    cur = cur.parent
  }
  return { col, row }
}

export function AtlasGraphTGE(props: { sessionID: string; width: number; height: number }) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const tge = useTGE()
  let anchor: Renderable | undefined

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

  // Color lookup for text labels (Void Black semantics)
  const color = (kind: string, ring: number): RGBA => {
    if (ring === 0) return theme.info
    if (ring <= 1) {
      const map: Record<string, RGBA> = {
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

  // Build text labels for the bridge (rendered AFTER supersample)
  const labels = createMemo((): TextLabel[] => {
    const f = frame()
    if (!f) return []
    return f.texts.map((t) => ({
      content: t.content,
      col: t.col,
      row: t.row,
      fg: pack(color((t.node.data.kind as string) ?? "", (t.node.data.ring as number) ?? 2)),
    }))
  })

  // Submit pixel buffer + labels to bridge on every frame update
  createEffect(() => {
    const f = frame()
    if (!f || !tge.active() || !anchor) return
    const pos = abs(anchor)
    tge.submit({
      key: "atlas-field",
      col: pos.col,
      row: pos.row,
      cols: props.width,
      rows: props.height,
      buf: f.buffer,
      labels: labels(),
    })
  })

  // Clean up pixel region on unmount
  onCleanup(() => tge.clear())

  return (
    <box ref={(r: Renderable) => (anchor = r)} width={props.width} height={props.height}>
      <Show when={!frame()}>
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.textMuted}>Loading atlas field…</text>
        </box>
      </Show>
    </box>
  )
}
