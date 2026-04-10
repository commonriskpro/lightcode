import { useSync } from "@tui/context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { TuiPluginRuntime } from "../../plugin"
import { getScrollAcceleration } from "../../util/scroll"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { sidebar as sidebarPrimitives, tags, border as borderPrimitives } from "../../ui/primitives"

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/

function named(title: string, max: number, fallback: string): string {
  if (DEFAULT_TITLE.test(title)) return fallback
  if (title.length <= max) return title
  const cut = title.lastIndexOf(" ", max - 1)
  if (cut > max * 0.4) return title.slice(0, cut)
  return title.slice(0, max - 1) + "…"
}

export function ContextPanel(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))
  const sb = createMemo(() => sidebarPrimitives(theme))
  const chips = createMemo(() => tags(theme))
  const bd = createMemo(() => borderPrimitives(theme))

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

  return (
    <Show when={session()}>
      <box
        backgroundColor={sb().bg}
        width={34}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <scrollbox flexGrow={1} scrollAcceleration={accel()}>
          <box flexShrink={0} gap={1}>
            {/* Selected node header */}
            <box>
              <text fg={sb().title}>
                <b>Context panel</b>
              </text>
              <text fg={sb().muted}>Selected node / {named(session()!.title, 18, "thread")}</text>
            </box>

            {/* Node detail card */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>{named(session()!.title, 24, "Active thread")}</b>
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={chips().thread.fg}>
                  <span style={{ bg: chips().thread.bg, fg: chips().thread.fg }}> THREAD </span>
                </text>
                <text fg={badge().color}>
                  <span style={{ bg: badge().color, fg: theme.background }}> {badge().text} </span>
                </text>
              </box>
              <Show when={model()}>
                <text fg={sb().muted}>
                  {model()} · {agent()}
                </text>
              </Show>
            </box>

            {/* Closest related nodes */}
            <Show when={related() > 0}>
              <box>
                <text fg={sb().title}>
                  <b>Related nodes</b>
                </text>
                <Show when={parent()}>
                  <text fg={sb().muted}>
                    <span style={{ fg: chips().anchor.bg }}>◇</span> {named(parent()!.title, 22, "parent")}
                  </text>
                </Show>
                <For each={children().slice(0, 3)}>
                  {(child) => (
                    <text fg={sb().muted}>
                      <span style={{ fg: chips().anchor.bg }}>◆</span> {named(child.title, 22, "fork")}
                    </text>
                  )}
                </For>
                <For each={todos().slice(0, 3)}>
                  {(todo) => (
                    <text fg={sb().muted}>
                      <span style={{ fg: chips().signal.bg }}>▲</span> {Locale.truncate(todo.content, 22)}
                    </text>
                  )}
                </For>
                <For each={diffs().slice(0, 3)}>
                  {(diff) => {
                    const name = diff.file.split("/").pop() ?? diff.file
                    return (
                      <text fg={sb().muted}>
                        <span style={{ fg: sb().body }}>□</span> {Locale.truncate(name, 22)}
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>

            {/* Field interpretation */}
            <box backgroundColor={sb().card} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
              <text fg={sb().title}>
                <b>Field interpretation</b>
              </text>
              <text fg={sb().muted} wrapMode="word">
                {interpretation()}
              </text>
            </box>

            {/* Plugin telemetry content */}
            <TuiPluginRuntime.Slot name="context_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        {/* Actions footer */}
        <box flexShrink={0} paddingTop={1} flexDirection="row" gap={1}>
          <text>
            <span style={{ bg: chips().anchor.bg, fg: chips().anchor.fg }}> /atlas </span>
          </text>
          <text>
            <span style={{ bg: chips().signal.bg, fg: chips().signal.fg }}> /signal </span>
          </text>
        </box>
      </box>
    </Show>
  )
}
