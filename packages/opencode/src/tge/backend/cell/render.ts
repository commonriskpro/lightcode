/**
 * Cell-mode renderers for each TGE primitive type.
 *
 * When pixel rendering is unavailable, these produce styled Unicode
 * approximations using box-drawing characters, block elements, and
 * ANSI true-color attributes.
 *
 * These are NOT pixel rasterizers — they output ANSI escape sequences
 * for direct terminal display or opentui setCellWithAlphaBlending calls.
 */

import { RGBA, type OptimizedBuffer } from "@opentui/core"
import { palette, surface, accent, border, alpha } from "../../tokens/color"

// ─── RGBA helpers ─────────────────────────────────────────────────────

function unpack(color: number): [number, number, number, number] {
  return [(color >>> 24) & 0xff, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff]
}

function toRGBA(color: number): RGBA {
  const [r, g, b, a] = unpack(color)
  return RGBA.fromInts(r, g, b, a)
}

// ─── Panel (box-drawing borders) ──────────────────────────────────────

const BOX = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
  // Sharp variant
  stl: "┌",
  str: "┐",
  sbl: "└",
  sbr: "┘",
}

export function panel(
  buf: OptimizedBuffer,
  col: number,
  row: number,
  cols: number,
  rows: number,
  bg: number,
  borderColor: number,
  rounded = true,
) {
  if (cols <= 0 || rows <= 0) return
  const bgC = toRGBA(bg)
  const bdC = toRGBA(borderColor)
  const chars = rounded ? BOX : { tl: BOX.stl, tr: BOX.str, bl: BOX.sbl, br: BOX.sbr, h: BOX.h, v: BOX.v }

  // Fill background
  buf.fillRect(col, row, cols, rows, bgC)

  // Top border
  buf.setCell(col, row, chars.tl, bdC, bgC)
  for (let x = 1; x < cols - 1; x++) buf.setCell(col + x, row, chars.h, bdC, bgC)
  buf.setCell(col + cols - 1, row, chars.tr, bdC, bgC)

  // Side borders
  for (let y = 1; y < rows - 1; y++) {
    buf.setCell(col, row + y, chars.v, bdC, bgC)
    buf.setCell(col + cols - 1, row + y, chars.v, bdC, bgC)
  }

  // Bottom border
  buf.setCell(col, row + rows - 1, chars.bl, bdC, bgC)
  for (let x = 1; x < cols - 1; x++) buf.setCell(col + x, row + rows - 1, chars.h, bdC, bgC)
  buf.setCell(col + cols - 1, row + rows - 1, chars.br, bdC, bgC)
}

// ─── Card (subtle box inside panel) ───────────────────────────────────

export function card(buf: OptimizedBuffer, col: number, row: number, cols: number, rows: number) {
  panel(buf, col, row, cols, rows, surface.card, border.subtle, true)
}

// ─── Chip (bracket-style badge) ───────────────────────────────────────

const CHIP_COLOR: Record<string, number> = {
  thread: accent.thread,
  anchor: accent.anchor,
  signal: accent.signal,
  drift: accent.drift,
  neutral: palette.muted,
  active: accent.thread,
  inactive: palette.muted,
}

export function chip(buf: OptimizedBuffer, col: number, row: number, text: string, kind: string) {
  const color = CHIP_COLOR[kind] ?? palette.muted
  const fg = toRGBA(kind === "neutral" || kind === "inactive" ? palette.text : palette.void)
  const bg = toRGBA(color)
  const label = ` ${text} `
  for (let i = 0; i < label.length; i++) {
    if (col + i >= buf.width) break
    buf.setCellWithAlphaBlending(col + i, row, label[i], fg, bg)
  }
}

// ─── Dialog overlay (dim + bordered box) ──────────────────────────────

export function overlay(buf: OptimizedBuffer, cols: number, rows: number, dialogCols: number, dialogRows: number) {
  // Dim the background
  const dim = toRGBA(alpha(palette.void, 0x90))
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      buf.setCellWithAlphaBlending(x, y, " ", dim, dim)
    }
  }

  // Draw dialog box centered
  const dx = Math.floor((cols - dialogCols) / 2)
  const dy = Math.floor(rows * 0.22)
  panel(buf, dx, dy, dialogCols, dialogRows, surface.panel, border.active, true)

  // Top accent line
  const acc = toRGBA(accent.thread)
  const bgC = toRGBA(surface.panel)
  for (let x = 1; x < dialogCols - 1; x++) {
    buf.setCell(dx + x, dy, "━", acc, bgC)
  }
}

// ─── Toast (side-bordered notification) ───────────────────────────────

const TOAST_COLOR: Record<string, number> = {
  info: accent.thread,
  error: accent.drift,
  warning: accent.signal,
  success: accent.green,
}

export function toast(buf: OptimizedBuffer, col: number, row: number, cols: number, rows: number, variant: string) {
  const color = TOAST_COLOR[variant] ?? accent.thread
  const bgC = toRGBA(surface.panel)
  const bdC = toRGBA(color)

  buf.fillRect(col, row, cols, rows, bgC)

  // Left accent bar
  for (let y = 0; y < rows; y++) buf.setCell(col, row + y, "┃", bdC, bgC)
  // Right accent bar
  for (let y = 0; y < rows; y++) buf.setCell(col + cols - 1, row + y, "┃", bdC, bgC)
}

// ─── Composer (left-accented input area) ──────────────────────────────

export function composer(buf: OptimizedBuffer, col: number, row: number, cols: number, rows: number, color: number) {
  const bgC = toRGBA(surface.card)
  const acc = toRGBA(color)

  buf.fillRect(col, row, cols, rows, bgC)
  for (let y = 0; y < rows; y++) buf.setCell(col, row + y, "┃", acc, bgC)
}

// ─── Field strip (light bordered bar) ─────────────────────────────────

export function strip(buf: OptimizedBuffer, col: number, row: number, cols: number) {
  const bgC = toRGBA(surface.card)
  const bdC = toRGBA(border.subtle)

  buf.fillRect(col, row, cols, 1, bgC)
  buf.setCell(col, row, "╶", bdC, bgC)
  buf.setCell(col + cols - 1, row, "╴", bdC, bgC)
}

// ─── Divider ──────────────────────────────────────────────────────────

export function divider(buf: OptimizedBuffer, col: number, row: number, cols: number, dir: "h" | "v", color: number) {
  const c = toRGBA(color)
  const bg = toRGBA(0x00000000)
  if (dir === "h") {
    for (let x = 0; x < cols; x++) buf.setCellWithAlphaBlending(col + x, row, "─", c, bg)
  } else {
    for (let y = 0; y < cols; y++) buf.setCellWithAlphaBlending(col, row + y, "│", c, bg)
  }
}
