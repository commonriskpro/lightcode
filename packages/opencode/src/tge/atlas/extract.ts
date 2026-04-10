/**
 * Data extraction for the Atlas Field graph.
 *
 * Extracts graph nodes and edges from LightCode session data.
 * This is a direct port of the extract() function from atlas-graph.tsx,
 * producing the same data model but decoupled from the rendering layer.
 */

export type NodeKind = "thread" | "parent" | "child" | "anchor" | "signal" | "file" | "mcp" | "drift"
export type EdgeWeight = "strong" | "normal" | "weak"

export type GraphNode = {
  id: string
  kind: NodeKind
  label: string
  ring: number
  cluster?: string
}

export type GraphEdge = {
  from: string
  to: string
  weight: EdgeWeight
}

export type GraphData = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─── Helpers ──────────────────────────────────────────────────────────

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  const cut = str.lastIndexOf(" ", max - 1)
  if (cut > max * 0.4) return str.slice(0, cut)
  return str.slice(0, max - 1) + "…"
}

function named(title: string, max: number, fallback: string): string {
  if (DEFAULT_TITLE.test(title)) return fallback
  return truncate(title, max)
}

// ─── Types matching SDK shape ─────────────────────────────────────────

type Session = { id: string; title: string; parentID?: string | null; time: { updated: number } }
type Message = { id: string; role: string; summary?: { title?: string }; error?: unknown; tokens?: { output: number } }
type Part = { type: string; text?: string }
type Todo = { content: string; status: string }
type FileDiff = { file: string }
type McpServer = { name: string; status: string }
type Memory = {
  observations: string | null
  reflections: string | null
  observation_tokens: number
  generation_count: number
  is_observing: boolean
  is_reflecting: boolean
}

/** Extract graph nodes and edges from session data. */
export function extract(
  session: Session,
  sessions: Session[],
  messages: Message[],
  parts: Record<string, Part[]>,
  todos: Todo[],
  diffs: FileDiff[],
  mcp: McpServer[],
  status: string | undefined,
  memory: Memory | null,
): GraphData {
  const nodes: GraphNode[] = []
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
    const content =
      title ??
      (parts[msg.id] ?? []).find((p) => p.type === "text" && "text" in p)?.text?.split("\n")[0] ??
      `anchor ${i + 1}`
    nodes.push({ id, kind: "anchor", label: truncate(content, 16), ring: 1, cluster: "memory cluster" })
    edges.push({ from: session.id, to: id, weight: "normal" })
  }

  // Ring 1: Drift
  const drifts: string[] = []
  if (status === "retry") drifts.push("retry")
  const errs = messages.filter((m): m is Message & { error: unknown } => m.role === "assistant" && !!m.error)
  if (errs.length > 0) {
    const last = errs[errs.length - 1]
    const kind =
      last.error && typeof last.error === "object" && "type" in last.error
        ? String((last.error as Record<string, unknown>).type)
        : "error"
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
      nodes.push({ id: "mem-obs", kind: "anchor", label: "observations", ring: 2, cluster: "memory cluster" })
      edges.push({ from: session.id, to: "mem-obs", weight: "normal" })
    }
    if (memory.reflections) {
      nodes.push({ id: "mem-ref", kind: "anchor", label: "reflections", ring: 2, cluster: "memory cluster" })
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
    nodes.push({ id, kind: "signal", label: truncate(todo.content, 14), ring: 2, cluster: "signal cluster" })
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
  for (const sib of siblings) {
    nodes.push({ id: `sib-${sib.id}`, kind: "parent", label: truncate(sib.title, 12), ring: 3 })
  }

  return { nodes, edges }
}
