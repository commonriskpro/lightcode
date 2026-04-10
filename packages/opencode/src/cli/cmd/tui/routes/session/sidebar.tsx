import { useSync } from "@tui/context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { Installation } from "@/installation"
import { TuiPluginRuntime } from "../../plugin"
import { getScrollAcceleration } from "../../util/scroll"
import { Locale } from "@/util/locale"

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))

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
        backgroundColor={theme.backgroundPanel}
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
            <text fg={theme.text}>
              <b>Atlas Index</b>
            </text>

            {/* Legend */}
            <box>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.info }}>◈</span> active thread
              </text>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.secondary }}>●</span> memory anchor
              </text>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.warning }}>▲</span> queued signal
              </text>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.error }}>⚠</span> drift / tension
              </text>
            </box>

            {/* Atlas state */}
            <box>
              <text fg={theme.text}>
                <b>Atlas state</b>
              </text>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>threads</text>
                <text fg={theme.info}>{threads()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>signals</text>
                <text fg={todos() > 0 ? theme.warning : theme.textMuted}>{todos()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>anchored</text>
                <text fg={diffs() > 0 ? theme.text : theme.textMuted}>{diffs()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>MCP</text>
                <text fg={mcp() > 0 ? theme.success : theme.textMuted}>{mcp()}</text>
              </box>
              <Show when={lsp() > 0}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.textMuted}>LSP</text>
                  <text fg={theme.success}>{lsp()}</text>
                </box>
              </Show>
            </box>

            {/* Recent threads */}
            <Show when={recent().length > 0}>
              <box>
                <text fg={theme.text}>
                  <b>Threads</b>
                </text>
                <For each={recent()}>
                  {(s) => (
                    <text fg={theme.textMuted} wrapMode="none">
                      <span style={{ fg: theme.secondary }}>◇</span> {Locale.truncate(s.title, 20)}
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
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Light</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            {Installation.VERSION}
          </text>
        </box>
      </box>
    </Show>
  )
}
