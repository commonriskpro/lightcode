/**
 * TGE-powered Atlas Field graph component.
 *
 * Renders the Atlas Field graph using pixel-level supersample rendering
 * via opentui's drawSuperSampleBuffer. The pixel data is submitted to
 * the TGE bridge which paints it in the postProcessFn (runs after all
 * component rendering). Text labels are drawn on top via drawText.
 *
 * Same props interface as the original AtlasGraph = drop-in replacement.
 */

import { createMemo, createResource, createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useRenderer } from "@opentui/solid"
import { extract, render as renderAtlas } from "@/tge/atlas"
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
  const renderer = useRenderer()
  const tge = useTGE()
  let anchor: Renderable | undefined

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const diffs = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const mcp = createMemo(() => Object.entries(sync.data.mcp).map(([name, item]) => ({ name, status: item.status })))
  const status = createMemo(() => sync.data.session_status?.[props.sessionID]?.type)

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

  createEffect(() => {
    const d = data()
    if (!d || !tge.active() || !anchor) return

    const pos = abs(anchor)
    // Clamp graph so it never extends past its parent's content area.
    // The parent box (flexGrow=1, pL=1, pR=1) occupies the center column;
    // its right edge = renderer.width - contextPanelWidth (36 when visible,
    // i.e. renderer.width > 140). Subtract pos.col to get max columns.
    const right = renderer.width > 140 ? renderer.width - 36 : renderer.width
    const maxCols = Math.max(1, right - pos.col)
    const gc = Math.max(1, Math.min(props.width, maxCols))
    const gr = Math.max(1, Math.min(props.height, renderer.height - pos.row))
    // Screen pixel dimensions: cells × cell pixel size
    const cw = Math.max(1, tge.cellW())
    const ch = Math.max(1, tge.cellH())
    const pw = gc * cw
    const ph = gr * ch
    if (pw <= 0 || ph <= 0) return

    // Render graph in screen-pixel space — circles are circular here.
    const f = renderAtlas(d, pw, ph, cw, ch)

    const labels: TextLabel[] = f.texts.map((t) => ({
      content: t.content,
      col: t.col,
      row: t.row,
      fg: pack(color((t.node.data.kind as string) ?? "", (t.node.data.ring as number) ?? 2)),
    }))

    tge.submit({
      key: "atlas-field",
      col: pos.col,
      row: pos.row,
      cols: gc,
      rows: gr,
      buf: f.buffer,
      labels,
    })
  })

  onCleanup(() => tge.clear())

  return (
    <box ref={(r: Renderable) => (anchor = r)} width={props.width} height={props.height}>
      <Show when={!data()}>
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.textMuted}>Loading atlas field…</text>
        </box>
      </Show>
    </box>
  )
}
