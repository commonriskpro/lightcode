import { createMemo, createResource, createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { graph as graphPrimitives } from "../ui/primitives"
import type { Session, Todo, FileDiff, Message, AssistantMessage, Part } from "@opencode-ai/sdk/v2"

// --- Graph data model ---

type NodeKind = "thread" | "parent" | "child" | "anchor" | "signal" | "file" | "mcp" | "drift"

type GraphNode = {
  id: string
  kind: NodeKind
  label: string
  ring: number
  cluster?: string
  col: number
  row: number
}

type EdgeWeight = "strong" | "normal" | "weak"

type GraphEdge = {
  from: string
  to: string
  weight: EdgeWeight
}

type Graph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
  clusters: Map<string, { label: string; cx: number; cy: number }>
}

// --- Helpers ---

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf(" ", max - 1)
  if (cut > max * 0.4) return text.slice(0, cut)
  return text.slice(0, max - 1) + "…"
}

function named(title: string, max: number, fallback: string): string {
  if (DEFAULT_TITLE.test(title)) return fallback
  return truncate(title, max)
}

// --- Node symbols ---

const SYMBOL: Record<NodeKind, string> = {
  thread: "◈",
  parent: "◇",
  child: "◆",
  anchor: "●",
  signal: "▲",
  file: "□",
  mcp: "⊙",
  drift: "⚠",
}

// Big center node (3x3 block)
const CENTER_ART = ["╭─◈─╮", "│   │", "╰───╯"]

// --- Layout engine ---

function layout(nodes: Omit<GraphNode, "col" | "row">[], edges: GraphEdge[], w: number, h: number): Graph {
  const cx = Math.floor(w / 2) - 3
  const cy = Math.floor(h / 2) - 1
  const placed: GraphNode[] = []

  const rings: Map<number, Omit<GraphNode, "col" | "row">[]> = new Map()
  for (const n of nodes) {
    const list = rings.get(n.ring) ?? []
    list.push(n)
    rings.set(n.ring, list)
  }

  // Place center node
  for (const n of rings.get(0) ?? []) {
    placed.push({ ...n, col: cx, row: cy })
  }

  // Place rings with jitter for organic feel
  const jitter = (seed: number, range: number) => {
    const x = Math.sin(seed * 9.8 + 7.1) * 0.5 + 0.5
    return Math.round((x - 0.5) * range)
  }

  for (const ring of [1, 2, 3]) {
    const group = rings.get(ring) ?? []
    if (!group.length) continue

    const rx = Math.min(Math.floor(w * 0.22 * ring) + 4, Math.floor(w / 2) - 8)
    const ry = Math.min(Math.floor(h * 0.2 * ring) + 2, Math.floor(h / 2) - 3)
    const step = (2 * Math.PI) / Math.max(group.length, 1)
    const offset = ring * 0.7

    for (let i = 0; i < group.length; i++) {
      const angle = step * i + offset
      const jx = jitter(i + ring * 17, ring === 1 ? 3 : 5)
      const jy = jitter(i + ring * 31, ring === 1 ? 1 : 2)
      const col = Math.round(cx + rx * Math.cos(angle)) + jx
      const row = Math.round(cy + ry * Math.sin(angle)) + jy
      placed.push({
        ...group[i],
        col: Math.max(2, Math.min(w - 16, col)),
        row: Math.max(1, Math.min(h - 2, row)),
      })
    }
  }

  // Build cluster positions
  const clusters = new Map<string, { label: string; cx: number; cy: number }>()
  const groups = new Map<string, GraphNode[]>()
  for (const n of placed) {
    if (!n.cluster) continue
    const list = groups.get(n.cluster) ?? []
    list.push(n)
    groups.set(n.cluster, list)
  }
  for (const [key, members] of groups) {
    const avgCol = Math.round(members.reduce((s, m) => s + m.col, 0) / members.length)
    const avgRow = Math.min(...members.map((m) => m.row)) - 1
    clusters.set(key, { label: key, cx: avgCol, cy: Math.max(0, avgRow) })
  }

  return { nodes: placed, edges, width: w, height: h, clusters }
}

// --- Render to character grid ---

type Cell = { char: string; kind: NodeKind | "edge" | "cluster" | "center" | "empty"; ring: number; weight: EdgeWeight }

function render(graph: Graph): Cell[][] {
  const grid: Cell[][] = Array.from({ length: graph.height }, () =>
    Array.from({ length: graph.width }, () => ({
      char: " ",
      kind: "empty" as const,
      ring: 3,
      weight: "normal" as EdgeWeight,
    })),
  )

  // Draw edges behind everything
  const idx = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const edge of graph.edges) {
    const a = idx.get(edge.from)
    const b = idx.get(edge.to)
    if (!a || !b) continue
    drawEdge(grid, a.col, a.row, b.col, b.row, Math.max(a.ring, b.ring), edge.weight)
  }

  // Draw cluster labels
  for (const [, cluster] of graph.clusters) {
    const start = cluster.cx - Math.floor(cluster.label.length / 2)
    for (let i = 0; i < cluster.label.length; i++) {
      const c = start + i
      if (c >= 0 && c < graph.width && cluster.cy >= 0 && cluster.cy < graph.height) {
        if (grid[cluster.cy][c].kind === "empty") {
          grid[cluster.cy][c] = { char: cluster.label[i], kind: "cluster", ring: 2, weight: "normal" }
        }
      }
    }
  }

  // Draw center node art (bigger visual)
  const center = graph.nodes.find((n) => n.ring === 0)
  if (center) {
    for (let dy = 0; dy < CENTER_ART.length; dy++) {
      const chars = [...CENTER_ART[dy]]
      for (let dx = 0; dx < chars.length; dx++) {
        const col = center.col + dx - 1
        const row = center.row + dy - 1
        if (row >= 0 && row < graph.height && col >= 0 && col < graph.width) {
          grid[row][col] = { char: chars[dx], kind: "center", ring: 0, weight: "strong" }
        }
      }
    }
    // Draw label below center
    const lbl = center.label
    const start = center.col + Math.floor(CENTER_ART[0].length / 2) - Math.floor(lbl.length / 2)
    const row = center.row + CENTER_ART.length
    if (row < graph.height) {
      for (let i = 0; i < lbl.length; i++) {
        const c = start + i
        if (c >= 0 && c < graph.width) {
          grid[row][c] = { char: lbl[i], kind: "center", ring: 0, weight: "strong" }
        }
      }
    }
    // "current thread" subtitle
    const sub = "current thread"
    const subStart = center.col + Math.floor(CENTER_ART[0].length / 2) - Math.floor(sub.length / 2)
    const subRow = center.row + CENTER_ART.length + 1
    if (subRow < graph.height) {
      for (let i = 0; i < sub.length; i++) {
        const c = subStart + i
        if (c >= 0 && c < graph.width) {
          grid[subRow][c] = { char: sub[i], kind: "thread", ring: 0, weight: "normal" }
        }
      }
    }
  }

  // Draw other nodes on top
  for (const node of graph.nodes) {
    if (node.ring === 0) continue
    if (node.row >= 0 && node.row < graph.height && node.col >= 0 && node.col < graph.width) {
      grid[node.row][node.col] = { char: SYMBOL[node.kind], kind: node.kind, ring: node.ring, weight: "normal" }
    }
    const lbl = node.label.slice(0, 18)
    const start = node.col + 2
    for (let i = 0; i < lbl.length; i++) {
      const c = start + i
      if (c >= 0 && c < graph.width && node.row >= 0 && node.row < graph.height) {
        if (grid[node.row][c].kind === "empty" || grid[node.row][c].kind === "edge") {
          grid[node.row][c] = { char: lbl[i], kind: node.kind, ring: node.ring, weight: "normal" }
        }
      }
    }
  }

  return grid
}

function drawEdge(grid: Cell[][], x0: number, y0: number, x1: number, y1: number, ring: number, weight: EdgeWeight) {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  let step = 0

  const chars =
    weight === "strong" ? ["─", "·", "─", "·"] : weight === "normal" ? ["·", " ", "·", " "] : ["·", " ", " ", " "]

  while (true) {
    if (x === x1 && y === y1) break
    if (!(x === x0 && y === y0) && !(x === x1 && y === y1)) {
      if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
        if (grid[y][x].kind === "empty") {
          grid[y][x] = { char: chars[step % chars.length], kind: "edge", ring, weight }
        }
      }
    }
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
    step++
  }
}

// --- Data extraction ---

type Memory = {
  observations: string | null
  reflections: string | null
  observation_tokens: number
  generation_count: number
  is_observing: boolean
  is_reflecting: boolean
}

function extract(
  session: Session,
  sessions: Session[],
  messages: Message[],
  parts: Record<string, Part[]>,
  todos: Todo[],
  diffs: FileDiff[],
  mcp: { name: string; status: string }[],
  status: string | undefined,
  memory: Memory | null,
) {
  const nodes: Omit<GraphNode, "col" | "row">[] = []
  const edges: GraphEdge[] = []

  // Ring 0: Active thread
  nodes.push({ id: session.id, kind: "thread", label: named(session.title, 20, "active thread"), ring: 0 })

  // Ring 1: Parent thread
  if (session.parentID) {
    const parent = sessions.find((s) => s.id === session.parentID)
    if (parent) {
      nodes.push({ id: parent.id, kind: "parent", label: named(parent.title, 16, "parent"), ring: 1 })
      edges.push({ from: session.id, to: parent.id, weight: "strong" })
    }
  }

  // Ring 1: Children threads
  const children = sessions.filter((s) => s.parentID === session.id)
  for (const child of children.slice(0, 4)) {
    nodes.push({ id: child.id, kind: "child", label: named(child.title, 14, "fork"), ring: 1 })
    edges.push({ from: session.id, to: child.id, weight: "strong" })
  }

  // Ring 1: Anchors (user messages sampled)
  const anchors = messages.filter((m) => m.role === "user")
  const step = Math.max(1, Math.floor(anchors.length / 6))
  const sampled = anchors.filter((_, i) => i % step === 0).slice(0, 6)
  for (const [i, msg] of sampled.entries()) {
    const id = `anchor-${i}`
    const title = msg.summary?.title
    const text =
      title ??
      (parts[msg.id] ?? []).find((p) => p.type === "text" && "text" in p)?.text?.split("\n")[0] ??
      `anchor ${i + 1}`
    nodes.push({ id, kind: "anchor", label: truncate(text, 16), ring: 1, cluster: "memory" })
    edges.push({ from: session.id, to: id, weight: "normal" })
  }

  // Ring 1: Drift
  const drifts: string[] = []
  if (status === "retry") drifts.push("retry")
  const errs = messages.filter((m): m is AssistantMessage => m.role === "assistant" && !!m.error)
  if (errs.length > 0) {
    const last = errs[errs.length - 1]
    const kind = last.error && "type" in last.error ? last.error.type : "error"
    if (kind === "context_overflow") drifts.push("overflow")
    else if (!drifts.includes("retry")) drifts.push(kind.slice(0, 10))
  }
  for (const [i, lbl] of drifts.entries()) {
    const id = `drift-${i}`
    nodes.push({ id, kind: "drift", label: lbl, ring: 1 })
    edges.push({ from: session.id, to: id, weight: "strong" })
  }

  // Ring 2: Memory artifacts
  if (memory) {
    if (memory.observations) {
      nodes.push({ id: "mem-obs", kind: "anchor", label: "observations", ring: 2, cluster: "memory" })
      edges.push({ from: session.id, to: "mem-obs", weight: "normal" })
    }
    if (memory.reflections) {
      nodes.push({ id: "mem-ref", kind: "anchor", label: "reflections", ring: 2, cluster: "memory" })
      edges.push({ from: session.id, to: "mem-ref", weight: "normal" })
      if (memory.observations) edges.push({ from: "mem-obs", to: "mem-ref", weight: "weak" })
    }
    if (memory.is_observing) {
      nodes.push({ id: "mem-active", kind: "signal", label: "observing", ring: 2 })
      edges.push({ from: session.id, to: "mem-active", weight: "normal" })
    }
    if (memory.is_reflecting) {
      nodes.push({ id: "mem-reflecting", kind: "signal", label: "reflecting", ring: 2 })
      edges.push({ from: session.id, to: "mem-reflecting", weight: "normal" })
    }
  }

  // Ring 2: Signals
  const pending = todos.filter((t) => t.status === "pending" || t.status === "in_progress")
  for (const [i, todo] of pending.slice(0, 5).entries()) {
    const id = `signal-${i}`
    nodes.push({ id, kind: "signal", label: truncate(todo.content, 14), ring: 2, cluster: "signals" })
    edges.push({ from: session.id, to: id, weight: "normal" })
  }

  // Ring 2: Modified files
  for (const [i, diff] of diffs.slice(0, 6).entries()) {
    const id = `file-${i}`
    const name = diff.file.split("/").pop() ?? diff.file
    nodes.push({ id, kind: "file", label: truncate(name, 14), ring: 2 })
    edges.push({ from: session.id, to: id, weight: "weak" })
  }

  // Ring 3: MCP servers
  const active = mcp.filter((m) => m.status === "connected")
  for (const [i, srv] of active.slice(0, 4).entries()) {
    const id = `mcp-${i}`
    nodes.push({ id, kind: "mcp", label: truncate(srv.name, 12), ring: 3 })
    edges.push({ from: session.id, to: id, weight: "weak" })
  }

  // Ring 3: Sibling threads
  const exclude = new Set([session.id, session.parentID ?? "", ...children.map((c) => c.id)])
  const siblings = sessions
    .filter((s) => !exclude.has(s.id) && !s.parentID && !DEFAULT_TITLE.test(s.title) && s.title.length >= 8)
    .sort((a, b) => b.time.updated - a.time.updated)
    .slice(0, 3)
  for (const [i, sib] of siblings.entries()) {
    const id = `sibling-${i}`
    nodes.push({ id, kind: "parent", label: truncate(sib.title, 12), ring: 3 })
  }

  return { nodes, edges }
}

// --- TUI Component ---

export function AtlasGraph(props: { sessionID: string; width: number; height: number }) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()

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

  const graph = createMemo(() => {
    const s = session()
    if (!s) return null
    const { nodes, edges } = extract(
      s,
      sync.data.session,
      messages(),
      sync.data.part,
      todos(),
      diffs(),
      mcp(),
      status(),
      mem() ?? null,
    )
    return layout(nodes, edges, props.width, props.height)
  })

  const grid = createMemo(() => {
    const g = graph()
    if (!g) return []
    return render(g)
  })

  const nodeCount = createMemo(() => graph()?.nodes.length ?? 0)
  const edgeCount = createMemo(() => graph()?.edges.length ?? 0)
  const gp = createMemo(() => graphPrimitives(theme))

  const color = (cell: Cell) => {
    if (cell.kind === "empty") return theme.background
    if (cell.kind === "cluster") return gp().cluster
    if (cell.kind === "center") return gp().active

    if (cell.kind === "edge") {
      if (cell.weight === "strong") return gp().edge
      if (cell.weight === "weak") return gp().edgeFaint
      return cell.ring <= 1 ? gp().edge : gp().edgeFaint
    }

    const base: Record<NodeKind, typeof theme.text> = {
      thread: gp().thread,
      parent: gp().anchor,
      child: gp().anchor,
      anchor: gp().anchor,
      signal: gp().signal,
      file: gp().file,
      mcp: gp().mcp,
      drift: gp().drift,
    }

    if (cell.ring >= 3) return gp().labelFar
    if (cell.ring >= 2) return gp().far
    return base[cell.kind as NodeKind]
  }

  return (
    <box width={props.width} height={props.height}>
      <For each={grid()}>
        {(row) => (
          <text>
            <For each={row}>{(cell) => <span style={{ fg: color(cell) }}>{cell.char}</span>}</For>
          </text>
        )}
      </For>
    </box>
  )
}
