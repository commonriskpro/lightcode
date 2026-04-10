/**
 * TGE surface renderer — generates pixel backgrounds for cell-based surfaces.
 *
 * Instead of replacing existing opentui components, surfaces paint pixel
 * chrome (backgrounds, borders, shadows, rounded corners) BEHIND the
 * cell-based content. The cell layer renders text on top.
 *
 * Each surface function takes cell dimensions and returns a PixelBuffer
 * that the bridge composites into the opentui render pipeline.
 */

import { buffer, clear, type PixelBuffer } from "../paint/buffer"
import { rounded, fill, stroke } from "../paint/rect"
import { halo } from "../paint/halo"
import { blur } from "../paint/halo"
import { surface, accent, palette, border, alpha } from "../tokens"
import { shadow as shadowTokens } from "../tokens"
import { radius } from "../tokens"

// ─── Dialog surface ───────────────────────────────────────────────────

export type DialogOpts = {
  /** Width in cells */
  cols: number
  /** Height in cells */
  rows: number
  /** Cell pixel dimensions */
  cellW: number
  cellH: number
  /** Accent color for the top border (default: thread cyan) */
  accent?: number
}

/**
 * Render a dialog surface: backdrop dim + centered panel with shadow.
 *
 * Returns two buffers:
 * - backdrop: full viewport dim overlay
 * - panel: the dialog box itself with shadow and rounded border
 */
export function dialog(viewport: { cols: number; rows: number }, opts: DialogOpts) {
  const vpW = viewport.cols * opts.cellW
  const vpH = viewport.rows * opts.cellH
  const panelW = opts.cols * opts.cellW
  const panelH = opts.rows * opts.cellH
  const px = (vpW - panelW) / 2
  const py = vpH * 0.22 // ~22% from top, matching current dialog.tsx paddingTop

  // Backdrop
  const bg = buffer(vpW, vpH)
  fill(bg, 0, 0, vpW, vpH, alpha(palette.void, 0xb0))

  // Panel with shadow
  const sh = shadowTokens.floating
  rounded(
    bg,
    px + sh.x - sh.blur,
    py + sh.y - sh.blur,
    panelW + sh.blur * 2,
    panelH + sh.blur * 2,
    sh.color,
    radius.lg + sh.blur,
  )
  if (sh.blur > 0)
    blur(bg, px + sh.x - sh.blur, py + sh.y - sh.blur, panelW + sh.blur * 2, panelH + sh.blur * 2, sh.blur)

  // Panel background
  rounded(bg, px, py, panelW, panelH, surface.panel, radius.lg)

  // Top accent border
  const acc = opts.accent ?? accent.thread
  fill(bg, px + radius.lg, py, panelW - radius.lg * 2, 2, acc)

  return {
    buffer: bg,
    /** Cell position where the panel starts (for text overlay alignment) */
    col: Math.floor(px / opts.cellW),
    row: Math.floor(py / opts.cellH),
  }
}

// ─── Panel surface ────────────────────────────────────────────────────

export type PanelOpts = {
  cols: number
  rows: number
  cellW: number
  cellH: number
  bg?: number
  borderColor?: number
  rad?: number
  elevated?: boolean
}

/** Render a panel background (sidebar, context panel, card). */
export function panel(opts: PanelOpts): PixelBuffer {
  const w = opts.cols * opts.cellW
  const h = opts.rows * opts.cellH
  const buf = buffer(w, h)
  const bg = opts.bg ?? surface.panel
  const rad = opts.rad ?? radius.sm

  if (opts.elevated) {
    const sh = shadowTokens.subtle
    rounded(buf, sh.x, sh.y, w, h, sh.color, rad + 2)
    if (sh.blur > 0) blur(buf, 0, 0, w + sh.blur * 2, h + sh.blur * 2, sh.blur)
  }

  rounded(buf, 0, 0, w, h, bg, rad)

  if (opts.borderColor) {
    stroke(buf, 0, 0, w, h, opts.borderColor, 1, rad)
  }

  return buf
}

// ─── Card surface ─────────────────────────────────────────────────────

export type CardOpts = {
  cols: number
  rows: number
  cellW: number
  cellH: number
  bg?: number
}

/** Render a card background (inner elevated surface within a panel). */
export function card(opts: CardOpts): PixelBuffer {
  return panel({
    ...opts,
    bg: opts.bg ?? surface.card,
    rad: radius.md,
    borderColor: border.subtle,
    elevated: false,
  })
}

// ─── Composer surface ─────────────────────────────────────────────────

export type ComposerOpts = {
  cols: number
  rows: number
  cellW: number
  cellH: number
  accent?: number
}

/** Render the composer/prompt background with left accent border. */
export function composer(opts: ComposerOpts): PixelBuffer {
  const w = opts.cols * opts.cellW
  const h = opts.rows * opts.cellH
  const buf = buffer(w, h)
  const bg = surface.card
  const acc = opts.accent ?? accent.thread

  // Background
  rounded(buf, 0, 0, w, h, bg, radius.sm)

  // Left accent bar (2px wide, full height minus radius)
  fill(buf, 0, radius.sm, 3, h - radius.sm * 2, acc)

  return buf
}

// ─── Toast surface ────────────────────────────────────────────────────

export type ToastOpts = {
  cols: number
  rows: number
  cellW: number
  cellH: number
  variant: "info" | "error" | "warning" | "success"
}

const VARIANT_COLOR: Record<string, number> = {
  info: accent.thread,
  error: accent.drift,
  warning: accent.signal,
  success: accent.green,
}

/** Render a toast notification background. */
export function toast(opts: ToastOpts): PixelBuffer {
  const w = opts.cols * opts.cellW
  const h = opts.rows * opts.cellH
  const buf = buffer(w, h)
  const color = VARIANT_COLOR[opts.variant] ?? accent.thread

  // Shadow
  const sh = shadowTokens.elevated
  rounded(buf, sh.x, sh.y + 1, w, h, sh.color, radius.md + 2)
  if (sh.blur > 0) blur(buf, 0, 0, w + sh.blur * 2, h + sh.blur * 2, sh.blur)

  // Background
  rounded(buf, 0, 0, w, h, surface.panel, radius.md)

  // Left + right accent borders
  fill(buf, 0, radius.md, 2, h - radius.md * 2, color)
  fill(buf, w - 2, radius.md, 2, h - radius.md * 2, color)

  return buf
}

// ─── Chip strip surface ───────────────────────────────────────────────

export type ChipOpts = {
  cellW: number
  cellH: number
  kind: "thread" | "anchor" | "signal" | "drift" | "neutral" | "active" | "inactive"
  /** Width in characters */
  chars: number
}

const CHIP_BG: Record<string, number> = {
  thread: accent.thread,
  anchor: accent.anchor,
  signal: accent.signal,
  drift: accent.drift,
  neutral: surface.card,
  active: accent.thread,
  inactive: surface.card,
}

/** Render a single chip background (pill shape). */
export function chip(opts: ChipOpts): PixelBuffer {
  const w = (opts.chars + 2) * opts.cellW // +2 for padding
  const h = opts.cellH
  const buf = buffer(w, h)
  const bg = CHIP_BG[opts.kind] ?? surface.card
  const rad = Math.floor(h / 2)

  rounded(buf, 0, 0, w, h, bg, rad)

  return buf
}

// ─── Field strip surface ──────────────────────────────────────────────

export type FieldStripOpts = {
  cols: number
  cellW: number
  cellH: number
}

/** Render the field strip bar background (above the atlas graph). */
export function strip(opts: FieldStripOpts): PixelBuffer {
  const w = opts.cols * opts.cellW
  const h = opts.cellH + 4 // single row + small padding
  const buf = buffer(w, h)

  rounded(buf, 0, 0, w, h, surface.card, radius.sm)
  stroke(buf, 0, 0, w, h, border.subtle, 1, radius.sm)

  return buf
}
