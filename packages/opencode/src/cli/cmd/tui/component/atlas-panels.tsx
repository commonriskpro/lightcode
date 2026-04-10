/**
 * Atlas Field bottom panels — narrative, actions, and drift.
 *
 * Three panels displayed below the atlas graph area, providing
 * contextual information about the active thread state.
 *
 * Layout: horizontal row of 3 flex panels when wide, stacked when narrow.
 */

import { createMemo, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../context/theme"
import { Locale } from "@/util/locale"
import { tags } from "../ui/primitives"

export function AtlasPanels(props: { sessionID: string; width: number }) {
  const sync = useSync()
  const { theme } = useTheme()
  const chips = createMemo(() => tags(theme))

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const todos = createMemo(() => (sync.data.todo[props.sessionID] ?? []).filter((t) => t.status !== "completed"))
  const diffs = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const status = createMemo(() => sync.data.session_status?.[props.sessionID])

  // Active narrative — what the thread is doing
  const narrative = createMemo(() => {
    const s = status()
    const anchors = messages().filter((m) => m.role === "user").length
    const files = diffs().length
    if (s?.type === "busy") return "Thread is actively processing. The field is live — watch for new edges forming."
    if (files > 3) return `${files} files anchored. Strong artifact density in the current path.`
    if (anchors > 10) return "Deep conversation thread. Memory anchors are densely packed around the center."
    if (anchors > 0) return "Thread is building context. Anchors form the navigation backbone of the field."
    return "New thread. Emit signals to activate the field and form connections."
  })

  // Drift status
  const drift = createMemo(() => {
    const s = status()
    const errs = messages().filter((m) => m.role === "assistant" && m.error)
    if (s?.type === "retry") return { active: true, text: "Thread is retrying. Drift detected — check error context." }
    if (errs.length > 2) return { active: true, text: `${errs.length} errors in thread. Tension is building.` }
    if (errs.length > 0) return { active: false, text: "Minor tension detected. Thread recovered from errors." }
    return { active: false, text: "No drift. Thread path is stable." }
  })

  const wide = createMemo(() => props.width > 80)

  return (
    <Show when={session()}>
      <box
        flexDirection={wide() ? "row" : "column"}
        gap={1}
        flexShrink={0}
        paddingTop={1}
        height={wide() ? 6 : undefined}
      >
        {/* Active narrative */}
        <box
          flexGrow={1}
          flexBasis={0}
          backgroundColor={theme.backgroundPanel}
          border={["top"]}
          borderColor={theme.info}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={theme.info} wrapMode="none">
            <b>Active narrative</b>
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {narrative()}
          </text>
        </box>

        {/* Path actions */}
        <box
          flexGrow={1}
          flexBasis={0}
          backgroundColor={theme.backgroundPanel}
          border={["top"]}
          borderColor={theme.info}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={theme.info} wrapMode="none">
            <b>Path actions</b>
          </text>
          <box flexDirection="row" gap={1} paddingTop={1} flexWrap="wrap">
            <text>
              <span style={{ bg: chips().signal.bg, fg: chips().signal.fg }}> inject signal </span>
            </text>
            <text>
              <span style={{ bg: chips().anchor.bg, fg: chips().anchor.fg }}> save anchor </span>
            </text>
            <text>
              <span style={{ bg: chips().thread.bg, fg: chips().thread.fg }}> open path </span>
            </text>
          </box>
        </box>

        {/* Drift */}
        <box
          flexGrow={1}
          flexBasis={0}
          backgroundColor={theme.backgroundPanel}
          border={["top"]}
          borderColor={drift().active ? theme.error : theme.borderSubtle}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={drift().active ? theme.error : theme.textMuted} wrapMode="none">
            <b>Drift</b>
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {drift().text}
          </text>
        </box>
      </box>
    </Show>
  )
}
