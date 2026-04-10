import { createMemo, createResource, createSignal, onCleanup, onMount, For } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import type { Session, Todo, FileDiff, Message, AssistantMessage } from "@opencode-ai/sdk/v2"

// --- Graph data model ---

type NodeKind = "thread" | "parent" | "child" | "anchor" | "signal" | "file" | "mcp" | "drift"

type GraphNode = {
  id: string
  kind: NodeKind
  label: string
  ring: number // 0=center, 1=near, 2=mid, 3=far
  col: number // column position in the rendered grid
  row: number // row position in the rendered grid
}

type GraphEdge = {
  from: string
  to: string
}

type Graph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
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

// --- Layout engine ---

function layout(nodes: Omit<GraphNode, "col" | "row">[], edges: GraphEdge[], w: number, h: number): Graph {
  const cx = Math.floor(w / 2)
  const cy = Math.floor(h / 2)
  const placed: GraphNode[] = []

  // Group by ring
  const rings: Map<number, Omit<GraphNode, "col" | "row">[]> = new Map()
  for (const n of nodes) {
    const list = rings.get(n.ring) ?? []
    list.push(n)
    rings.set(n.ring, list)
  }

  // Place center node
  const center = rings.get(0) ?? []
  for (const n of center) {
    placed.push({ ...n, col: cx, row: cy })
  }

  // Place each ring in an ellipse around center
  for (const ring of [1, 2, 3]) {
    const group = rings.get(ring) ?? []
    if (!group.length) continue

    // Radius scales with ring and available space
    const rx = Math.min(Math.floor(w * 0.3 * ring), Math.floor(w / 2) - 4)
    const ry = Math.min(Math.floor(h * 0.25 * ring), Math.floor(h / 2) - 2)
    const step = (2 * Math.PI) / Math.max(group.length, 1)
    // Offset each ring so they don't stack on the same axis
    const offset = ring * 0.4

    for (let i = 0; i < group.length; i++) {
      const angle = step * i + offset
      const col = Math.round(cx + rx * Math.cos(angle))
      const row = Math.round(cy + ry * Math.sin(angle))
      placed.push({
        ...group[i],
        col: Math.max(1, Math.min(w - 2, col)),
        row: Math.max(0, Math.min(h - 1, row)),
      })
    }
  }

  return { nodes: placed, edges, width: w, height: h }
}

// --- Render to character grid ---

type Cell = { char: string; kind: NodeKind | "edge" | "empty"; ring: number }

function render(graph: Graph): Cell[][] {
  const grid: Cell[][] = Array.from({ length: graph.height }, () =>
    Array.from({ length: graph.width }, () => ({ char: " ", kind: "empty" as const, ring: 3 })),
  )

  // Draw edges first (behind nodes)
  const idx = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const edge of graph.edges) {
    const a = idx.get(edge.from)
    const b = idx.get(edge.to)
    if (!a || !b) continue
    drawEdge(grid, a.col, a.row, b.col, b.row, Math.max(a.ring, b.ring))
  }

  // Draw nodes on top
  for (const node of graph.nodes) {
    if (node.row >= 0 && node.row < graph.height && node.col >= 0 && node.col < graph.width) {
      grid[node.row][node.col] = { char: SYMBOL[node.kind], kind: node.kind, ring: node.ring }
    }
    // Draw label to the right of the node
    const lbl = node.label.slice(0, 16)
    const start = node.col + 2
    for (let i = 0; i < lbl.length; i++) {
      const c = start + i
      if (c >= 0 && c < graph.width && node.row >= 0 && node.row < graph.height) {
        if (grid[node.row][c].kind === "empty" || grid[node.row][c].kind === "edge") {
          grid[node.row][c] = { char: lbl[i], kind: node.kind, ring: node.ring }
        }
      }
    }
  }

  return grid
}

function drawEdge(grid: Cell[][], x0: number, y0: number, x1: number, y1: number, ring: number) {
  // Bresenham-ish line with dotted characters
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  let step = 0

  while (true) {
    if (x === x1 && y === y1) break
    // Skip the node positions themselves
    if (!(x === x0 && y === y0) && !(x === x1 && y === y1)) {
      if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
        if (grid[y][x].kind === "empty") {
          const ch = step % 2 === 0 ? "·" : " "
          grid[y][x] = { char: ch, kind: "edge", ring }
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
  todos: Todo[],
  diffs: FileDiff[],
  mcp: { name: string; status: string }[],
  status: string | undefined,
  memory: Memory | null,
) {
  const nodes: Omit<GraphNode, "col" | "row">[] = []
  const edges: GraphEdge[] = []

  // Ring 0: Active thread
  nodes.push({ id: session.id, kind: "thread", label: session.title.slice(0, 14) || "thread", ring: 0 })

  // Ring 1: Parent thread
  if (session.parentID) {
    const parent = sessions.find((s) => s.id === session.parentID)
    if (parent) {
      nodes.push({ id: parent.id, kind: "parent", label: parent.title.slice(0, 12) || "parent", ring: 1 })
      edges.push({ from: session.id, to: parent.id })
    }
  }

  // Ring 1: Children threads
  const children = sessions.filter((s) => s.parentID === session.id)
  for (const child of children.slice(0, 4)) {
    nodes.push({ id: child.id, kind: "child", label: child.title.slice(0, 12) || "fork", ring: 1 })
    edges.push({ from: session.id, to: child.id })
  }

  // Ring 1: Anchors — user messages as checkpoints (sample evenly, max 5)
  const anchors = messages.filter((m) => m.role === "user")
  const step = Math.max(1, Math.floor(anchors.length / 5))
  const sampled = anchors.filter((_, i) => i % step === 0).slice(0, 5)
  for (const [i, msg] of sampled.entries()) {
    const id = `anchor-${i}`
    const label = msg.summary?.title?.slice(0, 12) ?? `turn ${i + 1}`
    nodes.push({ id, kind: "anchor", label, ring: 1 })
    edges.push({ from: session.id, to: id })
  }

  // Ring 1: Drift — retry, context overflow, or assistant errors
  const drifts: string[] = []
  if (status === "retry") drifts.push("retry")
  const errs = messages.filter((m): m is AssistantMessage => m.role === "assistant" && !!m.error)
  if (errs.length > 0) {
    const last = errs[errs.length - 1]
    const kind = last.error && "type" in last.error ? last.error.type : "error"
    if (kind === "context_overflow") drifts.push("overflow")
    else if (!drifts.includes("retry")) drifts.push(kind.slice(0, 10))
  }
  for (const [i, label] of drifts.entries()) {
    const id = `drift-${i}`
    nodes.push({ id, kind: "drift", label, ring: 1 })
    edges.push({ from: session.id, to: id })
  }

  // Ring 2: Memory artifacts (observer/reflector)
  if (memory) {
    if (memory.observations) {
      nodes.push({ id: "mem-obs", kind: "anchor", label: "observations", ring: 2 })
      edges.push({ from: session.id, to: "mem-obs" })
    }
    if (memory.reflections) {
      nodes.push({ id: "mem-ref", kind: "anchor", label: "reflections", ring: 2 })
      edges.push({ from: session.id, to: "mem-ref" })
      if (memory.observations) edges.push({ from: "mem-obs", to: "mem-ref" })
    }
    if (memory.is_observing) {
      nodes.push({ id: "mem-active", kind: "signal", label: "observing", ring: 2 })
      edges.push({ from: session.id, to: "mem-active" })
    }
    if (memory.is_reflecting) {
      nodes.push({ id: "mem-reflecting", kind: "signal", label: "reflecting", ring: 2 })
      edges.push({ from: session.id, to: "mem-reflecting" })
    }
  }

  // Ring 2: Signals (pending/in-progress todos)
  const pending = todos.filter((t) => t.status === "pending" || t.status === "in_progress")
  for (const [i, todo] of pending.slice(0, 5).entries()) {
    const id = `signal-${i}`
    nodes.push({ id, kind: "signal", label: todo.content.slice(0, 12), ring: 2 })
    edges.push({ from: session.id, to: id })
  }

  // Ring 2: Modified files (anchored changes)
  for (const [i, diff] of diffs.slice(0, 5).entries()) {
    const id = `file-${i}`
    const name = diff.file.split("/").pop() ?? diff.file
    nodes.push({ id, kind: "file", label: name.slice(0, 12), ring: 2 })
    edges.push({ from: session.id, to: id })
  }

  // Ring 3: MCP servers
  const active = mcp.filter((m) => m.status === "connected")
  for (const [i, srv] of active.slice(0, 4).entries()) {
    const id = `mcp-${i}`
    nodes.push({ id, kind: "mcp", label: srv.name.slice(0, 10), ring: 3 })
    edges.push({ from: session.id, to: id })
  }

  // Ring 3: Sibling threads (recent threads in same project, excluding self/parent/children)
  const exclude = new Set([session.id, session.parentID ?? "", ...children.map((c) => c.id)])
  const siblings = sessions
    .filter((s) => !exclude.has(s.id) && !s.parentID && s.id !== session.id)
    .sort((a, b) => b.time.updated - a.time.updated)
    .slice(0, 3)
  for (const [i, sib] of siblings.entries()) {
    const id = `sibling-${i}`
    nodes.push({ id, kind: "parent", label: sib.title.slice(0, 10), ring: 3 })
    // No edge to center — these are ambient context, not direct relations
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

  // Poll memory state
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
    const { nodes, edges } = extract(s, sync.data.session, messages(), todos(), diffs(), mcp(), status(), mem() ?? null)
    return layout(nodes, edges, props.width, props.height)
  })

  const grid = createMemo(() => {
    const g = graph()
    if (!g) return []
    return render(g)
  })

  const color = (cell: Cell) => {
    if (cell.kind === "empty") return theme.background
    if (cell.kind === "edge") return cell.ring <= 1 ? theme.borderActive : theme.borderSubtle

    const base: Record<NodeKind, typeof theme.text> = {
      thread: theme.info,
      parent: theme.secondary,
      child: theme.secondary,
      anchor: theme.secondary,
      signal: theme.warning,
      file: theme.text,
      mcp: theme.textMuted,
      drift: theme.error,
    }

    const c = base[cell.kind]
    // Fade by ring distance — ring 2 keeps color but dimmer, ring 3 fully muted
    if (cell.ring >= 3) return theme.textMuted
    return c
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
