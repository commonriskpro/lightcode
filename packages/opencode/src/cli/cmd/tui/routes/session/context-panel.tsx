import { useSync } from "@tui/context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { TuiPluginRuntime } from "../../plugin"
import { getScrollAcceleration } from "../../util/scroll"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { sidebar as sidebarPrimitives, tags, border as borderPrimitives } from "../../ui/primitives"
import type { PlacedNode } from "../../component/atlas-graph-tge"

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/

const SYMBOL: Record<string, string> = {
  thread: "◈",
  parent: "◇",
  child: "◆",
  anchor: "●",
  signal: "▲",
  file: "□",
  mcp: "⊙",
  drift: "⚠",
}

const KIND_LABEL: Record<string, string> = {
  thread: "THREAD",
  parent: "PARENT",
  child: "FORK",
  anchor: "ANCHOR",
  signal: "SIGNAL",
  file: "FILE",
  mcp: "MCP",
  drift: "DRIFT",
}

function named(title: string, max: number, fallback: string): string {
  if (DEFAULT_TITLE.test(title)) return fallback
  if (title.length <= max) return title
  const cut = title.lastIndexOf(" ", max - 1)
  if (cut > max * 0.4) return title.slice(0, cut)
  return title.slice(0, max - 1) + "…"
}

export function ContextPanel(props: { sessionID: string; width?: number; selectedNode?: PlacedNode | null }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))
  const sb = createMemo(() => sidebarPrimitives(theme))
  const chips = createMemo(() => tags(theme))
  const bd = createMemo(() => borderPrimitives(theme))
  const w = () => props.width ?? 36

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const last = createMemo(() =>
    messages().findLast((m): m is AssistantMessage => m.role === "assistant" && m.tokens.output > 0),
  )
  const status = createMemo(() => sync.data.session_status?.[props.sessionID])
  const todos = createMemo(() => (sync.data.todo[props.sessionID] ?? []).filter((t) => t.status !== "completed"))
  const diffs = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])

  // Thread relations
  const parent = createMemo(() => {
    const pid = session()?.parentID
    if (!pid) return null
    return sync.session.get(pid) ?? null
  })
  const children = createMemo(() => sync.data.session.filter((s) => s.parentID === props.sessionID))

  const model = createMemo(() => {
    const msg = last()
    if (!msg) return null
    const provider = sync.data.provider.find((p) => p.id === msg.providerID)
    return provider?.models[msg.modelID]?.name ?? msg.modelID
  })

  const agent = createMemo(() => last()?.agent ?? "build")

  const badge = createMemo(() => {
    const s = status()
    if (!s) return { text: "IDLE", color: theme.textMuted }
    if (s.type === "busy") return { text: "ACTIVE", color: theme.info }
    if (s.type === "retry") return { text: "DRIFT", color: theme.error }
    return { text: "IDLE", color: theme.textMuted }
  })

  // Related nodes count
  const related = createMemo(() => {
    const count =
      (parent() ? 1 : 0) +
      children().length +
      todos().length +
      diffs().length +
      messages().filter((m) => m.role === "user").length
    return count
  })

  // Field interpretation
  const interpretation = createMemo(() => {
    const drift = status()?.type === "retry"
    const busy = status()?.type === "busy"
    const signals = todos().length
    const anchored = diffs().length
    if (drift) return "Thread is in drift. Check retry errors before continuing."
    if (busy && signals > 0)
      return `Active work with ${signals} pending signal${signals > 1 ? "s" : ""}. Field is live.`
    if (busy) return "Thread is actively processing. Field is live."
    if (signals > 0) return `${signals} signal${signals > 1 ? "s" : ""} queued. Relationship density is moderate.`
    if (anchored > 0) return `${anchored} anchored file${anchored > 1 ? "s" : ""}. Thread has produced artifacts.`
    return "Field is quiet. Emit a signal to activate."
  })

  /** Whether a non-center node is selected */
  const sel = createMemo(() => {
    const n = props.selectedNode
    if (!n || n.ring === 0) return null
    return n
  })

  /** Description for the selected node based on kind */
  const desc = createMemo(() => {
    const n = sel()
    if (!n) return null
    if (n.kind === "thread" || n.kind === "parent" || n.kind === "child")
      return "Thread in the session tree. Connected to the active thread via parent-child relationship."
    if (n.kind === "anchor")
      return n.cluster
        ? `Memory anchor in ${n.cluster}. Anchors form the navigation backbone of the field.`
        : "User message anchor. Represents a conversation turn in the thread."
    if (n.kind === "signal") return "Pending signal (todo). Queued for processing by the active thread."
    if (n.kind === "file") return "Modified file. This artifact was produced or changed during the thread."
    if (n.kind === "mcp") return "Connected MCP server. Provides external tool capabilities to the thread."
    if (n.kind === "drift") return "Drift indicator. The thread encountered errors or retries."
    return "Node in the atlas field."
  })

  /** Chip color for the selected node kind */
  const chip = createMemo(() => {
    const n = sel()
    if (!n) return chips().thread
    const map: Record<string, ReturnType<typeof chips>[keyof ReturnType<typeof chips>]> = {
      thread: chips().thread,
      parent: chips().anchor,
      child: chips().thread,
      anchor: chips().anchor,
      signal: chips().signal,
      file: chips().anchor,
      mcp: chips().anchor,
      drift: chips().signal,
    }
    return map[n.kind] ?? chips().thread
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={sb().bg}
        width={w()}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <scrollbox flexGrow={1} scrollAcceleration={accel()}>
          <box flexShrink={0} gap={1}>
            {/* Panel header */}
            <box>
              <text fg={sb().title}>
                <b>Context panel</b>
              </text>
              <text fg={sb().muted}>
                Selected node / {sel() ? sel()!.label : named(session()!.title, w() - 20, "thread")}
              </text>
            </box>

            {/* ── Selected non-center node card ── */}
            <Show when={sel()}>
              <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
                <text fg={sb().title}>
                  <b>
                    {SYMBOL[sel()!.kind] ?? "·"} {sel()!.label}
                  </b>
                </text>
                <box flexDirection="row" gap={1} paddingTop={1}>
                  <text>
                    <span style={{ bg: chip().bg, fg: chip().fg }}> {KIND_LABEL[sel()!.kind] ?? "NODE"} </span>
                  </text>
                  <text>
                    <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> ring {sel()!.ring} </span>
                  </text>
                </box>
                <Show when={sel()!.cluster}>
                  <text fg={sb().muted} paddingTop={1}>
                    cluster: {sel()!.cluster}
                  </text>
                </Show>
                <text fg={sb().muted} wrapMode="word" paddingTop={1}>
                  {desc()}
                </text>
              </box>
            </Show>

            {/* ── Default: active thread card (when no node or center selected) ── */}
            <Show when={!sel()}>
              <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
                <text fg={sb().title}>
                  <b>{named(session()!.title, w() - 6, "Active thread")}</b>
                </text>
                <box flexDirection="row" gap={1} paddingTop={1}>
                  <text>
                    <span style={{ bg: chips().thread.bg, fg: chips().thread.fg }}> THREAD </span>
                  </text>
                  <text>
                    <span style={{ bg: badge().color, fg: theme.background }}> {badge().text} </span>
                  </text>
                </box>
                <Show when={model()}>
                  <text fg={sb().muted} paddingTop={1}>
                    {model()} · {agent()}
                  </text>
                </Show>
                <text fg={sb().muted} wrapMode="word" paddingTop={1}>
                  Primary thread for current work.{" "}
                  {related() > 0 ? `Highest edge density in the visible atlas field.` : "No edges connected yet."}
                </text>
              </box>
            </Show>

            {/* Closest related nodes */}
            <Show when={related() > 0}>
              <box>
                <text fg={sb().title}>
                  <b>Closest related nodes</b>
                </text>
                <Show when={parent()}>
                  <text fg={sb().muted}>
                    <span style={{ fg: chips().anchor.bg }}>◇</span> {named(parent()!.title, w() - 8, "parent")}
                  </text>
                </Show>
                <For each={children().slice(0, 4)}>
                  {(child) => (
                    <text fg={sb().muted}>
                      <span style={{ fg: chips().thread.bg }}>◆</span> {named(child.title, w() - 8, "fork")}
                    </text>
                  )}
                </For>
                <For each={todos().slice(0, 4)}>
                  {(todo) => (
                    <text fg={sb().muted}>
                      <span style={{ fg: chips().signal.bg }}>▲</span> {Locale.truncate(todo.content, w() - 8)}
                    </text>
                  )}
                </For>
                <For each={diffs().slice(0, 4)}>
                  {(diff) => {
                    const name = diff.file.split("/").pop() ?? diff.file
                    return (
                      <text fg={sb().muted}>
                        <span style={{ fg: sb().body }}>□</span> {Locale.truncate(name, w() - 8)}
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>

            {/* Field interpretation — narrative */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>Field interpretation</b>
              </text>
              <text fg={sb().muted} wrapMode="word">
                {interpretation()}
              </text>
              <text fg={sb().muted} wrapMode="word" paddingTop={1}>
                The graph shows which anchors, memories and signals sit nearest to the active thread. Relationship
                remains the main navigation model.
              </text>
            </box>

            {/* Plugin telemetry content */}
            <TuiPluginRuntime.Slot name="context_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        {/* Actions footer */}
        <box flexShrink={0} paddingTop={1} flexDirection="row" gap={1} flexWrap="wrap">
          <text>
            <span style={{ bg: chips().anchor.bg, fg: chips().anchor.fg }}> focus neighborhood </span>
          </text>
          <text>
            <span style={{ bg: chips().signal.bg, fg: chips().signal.fg }}> save anchor </span>
          </text>
          <text>
            <span style={{ bg: chips().thread.bg, fg: chips().thread.fg }}> inject signal </span>
          </text>
        </box>
      </box>
    </Show>
  )
}
