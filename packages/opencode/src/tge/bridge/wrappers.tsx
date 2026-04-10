/**
 * TGE surface wrappers — SolidJS components that add pixel chrome
 * around existing cell-based opentui content.
 *
 * These DON'T replace existing components. They wrap them, submitting
 * pixel backgrounds to the TGE bridge while letting the cell layer
 * render text on top.
 *
 * Usage:
 *   <TGEDialog cols={60} rows={20}>
 *     <ExistingDialogContent />
 *   </TGEDialog>
 */

import { createEffect, createMemo, onCleanup, type ParentProps } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTGE } from "./context"
import { dialog, panel, card, composer, toast, chip, strip } from "./surface"
import type { Region } from "./opentui"

// ─── Dialog wrapper ───────────────────────────────────────────────────

export function TGEDialog(props: ParentProps<{ cols: number; rows: number; accent?: number }>) {
  const tge = useTGE()
  const dims = useTerminalDimensions()

  createEffect(() => {
    if (!tge.active()) return
    const result = dialog(
      { cols: dims().width, rows: dims().height },
      { cols: props.cols, rows: props.rows, cellW: tge.cellW(), cellH: tge.cellH(), accent: props.accent },
    )
    tge.submit({
      key: "dialog-backdrop",
      col: 0,
      row: 0,
      cols: dims().width,
      rows: dims().height,
      buf: result.buffer,
    })
  })

  onCleanup(() => tge.clear())

  return <>{props.children}</>
}

// ─── Panel wrapper ────────────────────────────────────────────────────

export function TGEPanel(
  props: ParentProps<{
    col: number
    row: number
    cols: number
    rows: number
    bg?: number
    borderColor?: number
    elevated?: boolean
    id: string
  }>,
) {
  const tge = useTGE()

  createEffect(() => {
    if (!tge.active()) return
    const buf = panel({
      cols: props.cols,
      rows: props.rows,
      cellW: tge.cellW(),
      cellH: tge.cellH(),
      bg: props.bg,
      borderColor: props.borderColor,
      elevated: props.elevated,
    })
    tge.submit({
      key: `panel-${props.id}`,
      col: props.col,
      row: props.row,
      cols: props.cols,
      rows: props.rows,
      buf,
    })
  })

  return <>{props.children}</>
}

// ─── Card wrapper ─────────────────────────────────────────────────────

export function TGECard(
  props: ParentProps<{ col: number; row: number; cols: number; rows: number; id: string; bg?: number }>,
) {
  const tge = useTGE()

  createEffect(() => {
    if (!tge.active()) return
    const buf = card({
      cols: props.cols,
      rows: props.rows,
      cellW: tge.cellW(),
      cellH: tge.cellH(),
      bg: props.bg,
    })
    tge.submit({
      key: `card-${props.id}`,
      col: props.col,
      row: props.row,
      cols: props.cols,
      rows: props.rows,
      buf,
    })
  })

  return <>{props.children}</>
}

// ─── Composer wrapper ─────────────────────────────────────────────────

export function TGEComposer(
  props: ParentProps<{ col: number; row: number; cols: number; rows: number; accent?: number }>,
) {
  const tge = useTGE()

  createEffect(() => {
    if (!tge.active()) return
    const buf = composer({
      cols: props.cols,
      rows: props.rows,
      cellW: tge.cellW(),
      cellH: tge.cellH(),
      accent: props.accent,
    })
    tge.submit({
      key: "composer",
      col: props.col,
      row: props.row,
      cols: props.cols,
      rows: props.rows,
      buf,
    })
  })

  return <>{props.children}</>
}

// ─── Toast wrapper ────────────────────────────────────────────────────

export function TGEToast(
  props: ParentProps<{
    col: number
    row: number
    cols: number
    rows: number
    variant: "info" | "error" | "warning" | "success"
  }>,
) {
  const tge = useTGE()

  createEffect(() => {
    if (!tge.active()) return
    const buf = toast({
      cols: props.cols,
      rows: props.rows,
      cellW: tge.cellW(),
      cellH: tge.cellH(),
      variant: props.variant,
    })
    tge.submit({
      key: "toast",
      col: props.col,
      row: props.row,
      cols: props.cols,
      rows: props.rows,
      buf,
    })
  })

  onCleanup(() => tge.clear())

  return <>{props.children}</>
}

// ─── Chip wrapper ─────────────────────────────────────────────────────

export function TGEChip(
  props: ParentProps<{
    col: number
    row: number
    kind: "thread" | "anchor" | "signal" | "drift" | "neutral" | "active" | "inactive"
    chars: number
    id: string
  }>,
) {
  const tge = useTGE()

  createEffect(() => {
    if (!tge.active()) return
    const buf = chip({
      cellW: tge.cellW(),
      cellH: tge.cellH(),
      kind: props.kind,
      chars: props.chars,
    })
    tge.submit({
      key: `chip-${props.id}`,
      col: props.col,
      row: props.row,
      cols: props.chars + 2,
      rows: 1,
      buf,
    })
  })

  return <>{props.children}</>
}

// ─── Field strip wrapper ──────────────────────────────────────────────

export function TGEFieldStrip(props: ParentProps<{ col: number; row: number; cols: number }>) {
  const tge = useTGE()

  createEffect(() => {
    if (!tge.active()) return
    const buf = strip({
      cols: props.cols,
      cellW: tge.cellW(),
      cellH: tge.cellH(),
    })
    tge.submit({
      key: "field-strip",
      col: props.col,
      row: props.row,
      cols: props.cols,
      rows: 1,
      buf,
    })
  })

  return <>{props.children}</>
}
