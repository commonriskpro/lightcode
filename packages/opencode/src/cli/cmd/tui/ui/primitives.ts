/**
 * Visual primitives for the Atlas Field design system.
 *
 * Each family returns a color record derived from the active theme.
 * Components consume these instead of reaching into theme tokens directly,
 * ensuring a shared visual grammar across every TUI surface.
 *
 * Families:
 *   1. Surface   – panel backgrounds at increasing elevation
 *   2. Border    – hierarchy from whisper to active focus
 *   3. Tag       – semantic chips (thread, anchor, signal, drift, neutral)
 *   4. Graph     – nodes, edges, clusters and labels
 *   5. Prompt    – composer shell, dividers, metadata
 *   6. Sidebar   – panels, titles, summaries
 */

import type { RGBA } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

type Theme = TuiThemeCurrent

// ─── 1. Surface primitives ────────────────────────────────────────────

export type Surface = {
  /** Deepest background — the void */
  base: RGBA
  /** Sidebar / panel background */
  panel: RGBA
  /** Elevated card within a panel */
  card: RGBA
  /** Contextual element (menu, dropdown, inner block) */
  context: RGBA
  /** Floating overlay / slab */
  floating: RGBA
}

export function surface(t: Theme): Surface {
  return {
    base: t.background,
    panel: t.backgroundPanel,
    card: t.backgroundElement,
    context: t.backgroundMenu,
    floating: t.backgroundMenu,
  }
}

// ─── 2. Border primitives ─────────────────────────────────────────────

export type Border = {
  /** Almost invisible separator */
  subtle: RGBA
  /** Default border for cards */
  normal: RGBA
  /** Active / highlighted border */
  active: RGBA
  /** Focused element border */
  focus: RGBA
  /** Selected item border */
  selected: RGBA
}

export function border(t: Theme): Border {
  return {
    subtle: t.borderSubtle,
    normal: t.border,
    active: t.borderActive,
    focus: t.primary,
    selected: t.info,
  }
}

// ─── 3. Tag / chip primitives ─────────────────────────────────────────

export type Tag = {
  fg: RGBA
  bg: RGBA
}

export type Tags = {
  thread: Tag
  anchor: Tag
  signal: Tag
  drift: Tag
  neutral: Tag
}

export function tags(t: Theme): Tags {
  return {
    thread: { fg: t.background, bg: t.info },
    anchor: { fg: t.background, bg: t.secondary },
    signal: { fg: t.background, bg: t.warning },
    drift: { fg: t.background, bg: t.error },
    neutral: { fg: t.text, bg: t.backgroundElement },
  }
}

// ─── 4. Graph primitives ──────────────────────────────────────────────

export type GraphColors = {
  /** Center node and its label */
  active: RGBA
  /** Ring 1 nodes (parent, child, anchor) */
  near: RGBA
  /** Ring 2+ nodes */
  far: RGBA
  /** Primary edges (strong weight) */
  edge: RGBA
  /** Secondary edges (normal/weak) */
  edgeFaint: RGBA
  /** Cluster halo text */
  cluster: RGBA
  /** Label for close nodes */
  label: RGBA
  /** Label for distant nodes */
  labelFar: RGBA
  /** Thread-type node */
  thread: RGBA
  /** Anchor-type node */
  anchor: RGBA
  /** Signal-type node */
  signal: RGBA
  /** Drift-type node */
  drift: RGBA
  /** File-type node */
  file: RGBA
  /** MCP-type node */
  mcp: RGBA
}

export function graph(t: Theme): GraphColors {
  return {
    active: t.info,
    near: t.secondary,
    far: t.textMuted,
    edge: t.border,
    edgeFaint: t.borderSubtle,
    cluster: t.borderActive,
    label: t.text,
    labelFar: t.textMuted,
    thread: t.info,
    anchor: t.secondary,
    signal: t.warning,
    drift: t.error,
    file: t.text,
    mcp: t.textMuted,
  }
}

// ─── 5. Prompt primitives ─────────────────────────────────────────────

export type PromptColors = {
  /** Textarea background */
  shell: RGBA
  /** Border accent (left bar) — passed externally as agent color */
  focusBorder: RGBA
  /** Divider below textarea */
  divider: RGBA
  /** Metadata row text (model, cost) */
  meta: RGBA
  /** Hint row text (keybinds) */
  hint: RGBA
  /** Placeholder text */
  placeholder: RGBA
}

export function prompt(t: Theme): PromptColors {
  return {
    shell: t.backgroundElement,
    focusBorder: t.primary,
    divider: t.backgroundElement,
    meta: t.textMuted,
    hint: t.textMuted,
    placeholder: t.textMuted,
  }
}

// ─── 6. Sidebar primitives ────────────────────────────────────────────

export type SidebarColors = {
  /** Panel background */
  bg: RGBA
  /** Section title */
  title: RGBA
  /** Body text */
  body: RGBA
  /** Muted text / labels */
  muted: RGBA
  /** Separator between blocks */
  separator: RGBA
  /** Inner card / box */
  card: RGBA
}

export function sidebar(t: Theme): SidebarColors {
  return {
    bg: t.backgroundPanel,
    title: t.text,
    body: t.text,
    muted: t.textMuted,
    separator: t.borderSubtle,
    card: t.backgroundElement,
  }
}

// ─── Aggregate ────────────────────────────────────────────────────────

export type Primitives = {
  surface: Surface
  border: Border
  tags: Tags
  graph: GraphColors
  prompt: PromptColors
  sidebar: SidebarColors
}

export function primitives(t: Theme): Primitives {
  return {
    surface: surface(t),
    border: border(t),
    tags: tags(t),
    graph: graph(t),
    prompt: prompt(t),
    sidebar: sidebar(t),
  }
}
