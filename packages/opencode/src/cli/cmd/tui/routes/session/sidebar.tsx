import { useSync } from "@tui/context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { Installation } from "@/installation"
import { TuiPluginRuntime } from "../../plugin"
import { getScrollAcceleration } from "../../util/scroll"
import { Locale } from "@/util/locale"
import { sidebar as sidebarPrimitives, tags } from "../../ui/primitives"

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))
  const sb = createMemo(() => sidebarPrimitives(theme))
  const chips = createMemo(() => tags(theme))

  // Atlas state
  const threads = createMemo(() => sync.data.session.filter((s) => !DEFAULT_TITLE.test(s.title)).length)
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((m) => m.status === "connected").length)
  const lsp = createMemo(() => sync.data.lsp.filter((l) => l.status === "connected").length)
  const todos = createMemo(() => (sync.data.todo[props.sessionID] ?? []).filter((t) => t.status !== "completed").length)
  const diffs = createMemo(() => (sync.data.session_diff[props.sessionID] ?? []).length)

  // Recent named threads
  const recent = createMemo(() =>
    sync.data.session
      .filter((s) => !DEFAULT_TITLE.test(s.title) && s.title.length >= 8 && s.id !== props.sessionID)
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, 5),
  )

  return (
    <Show when={session()}>
      <box
        backgroundColor={sb().bg}
        width={28}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1} scrollAcceleration={accel()}>
          <box flexShrink={0} gap={1}>
            {/* Header */}
            <text fg={sb().title}>
              <b>Atlas Index</b>
            </text>

            {/* Legend */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().muted}>
                <span style={{ fg: chips().thread.bg }}>◈</span> active thread
              </text>
              <text fg={sb().muted}>
                <span style={{ fg: chips().anchor.bg }}>●</span> memory anchor
              </text>
              <text fg={sb().muted}>
                <span style={{ fg: chips().signal.bg }}>▲</span> queued signal
              </text>
              <text fg={sb().muted}>
                <span style={{ fg: chips().drift.bg }}>⚠</span> drift / tension
              </text>
            </box>

            {/* Atlas state */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>Atlas state</b>
              </text>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>threads</text>
                <text fg={chips().thread.bg}>{threads()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>signals</text>
                <text fg={todos() > 0 ? chips().signal.bg : sb().muted}>{todos()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>anchored</text>
                <text fg={diffs() > 0 ? sb().body : sb().muted}>{diffs()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>MCP</text>
                <text fg={mcp() > 0 ? theme.success : sb().muted}>{mcp()}</text>
              </box>
              <Show when={lsp() > 0}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={sb().muted}>LSP</text>
                  <text fg={theme.success}>{lsp()}</text>
                </box>
              </Show>
            </box>

            {/* Recent threads */}
            <Show when={recent().length > 0}>
              <box>
                <text fg={sb().title}>
                  <b>Threads</b>
                </text>
                <For each={recent()}>
                  {(s) => (
                    <text fg={sb().muted} wrapMode="none">
                      <span style={{ fg: chips().anchor.bg }}>◇</span> {Locale.truncate(s.title, 20)}
                    </text>
                  )}
                </For>
              </box>
            </Show>

            {/* Plugin content (MCP/LSP details if needed) */}
            <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} paddingTop={1}>
          <text fg={sb().muted}>
            <span style={{ fg: theme.success }}>•</span> <b>Light</b>
            <span style={{ fg: sb().body }}>
              <b>Code</b>
            </span>{" "}
            {Installation.VERSION}
          </text>
        </box>
      </box>
    </Show>
  )
}
