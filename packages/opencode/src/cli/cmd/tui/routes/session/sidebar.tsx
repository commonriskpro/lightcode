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

export function Sidebar(props: { sessionID: string; overlay?: boolean; width?: number }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))
  const sb = createMemo(() => sidebarPrimitives(theme))
  const chips = createMemo(() => tags(theme))
  const w = () => props.width ?? 24

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
        width={w()}
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
            <box>
              <text fg={sb().title}>
                <b>Atlas Index</b>
              </text>
              <text fg={sb().muted}>filters / clusters / legend</text>
            </box>

            {/* Filters */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>Filters</b>
              </text>
              <text fg={sb().muted}>
                <span style={{ bg: chips().thread.bg, fg: chips().thread.fg }}> CURRENT PATH </span>
              </text>
              <text fg={sb().muted}>
                <span style={{ bg: chips().signal.bg, fg: chips().signal.fg }}> HIGH SIGNAL </span>
              </text>
              <text fg={sb().muted}>
                <span style={{ bg: chips().anchor.bg, fg: chips().anchor.fg }}> PROJECT MEMORY </span>
              </text>
            </box>

            {/* Legend */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>Legend</b>
              </text>
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

            {/* Atlas state — field summary */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>Atlas state</b>
              </text>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>visible nodes</text>
                <text fg={chips().thread.bg}>{threads() + diffs()}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>live clusters</text>
                <text fg={chips().anchor.bg}>
                  {(todos() > 0 ? 1 : 0) + (diffs() > 0 ? 1 : 0) + (mcp() > 0 ? 1 : 0)}
                </text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={sb().muted}>signal drift</text>
                <text fg={todos() > 0 ? chips().signal.bg : sb().muted}>
                  {todos() > 3 ? "high" : todos() > 0 ? "medium" : "low"}
                </text>
              </box>
            </box>

            {/* Recent paths / threads */}
            <Show when={recent().length > 0}>
              <box>
                <text fg={sb().title}>
                  <b>Paths</b>
                </text>
                <For each={recent()}>
                  {(s) => (
                    <text fg={sb().muted} wrapMode="none">
                      <span style={{ fg: chips().anchor.bg }}>◇</span> {Locale.truncate(s.title, w() - 6)}
                    </text>
                  )}
                </For>
              </box>
            </Show>

            {/* Plugin content */}
            <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        {/* Bottom action */}
        <box flexShrink={0} paddingTop={1}>
          <text fg={sb().muted}>
            <span style={{ bg: chips().thread.bg, fg: chips().thread.fg }}> + new path </span>
          </text>
        </box>
      </box>
    </Show>
  )
}
