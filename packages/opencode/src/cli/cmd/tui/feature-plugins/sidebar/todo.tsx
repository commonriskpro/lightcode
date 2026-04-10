import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-todo"

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  cancelled: "✕",
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const active = createMemo(() => list().filter((item) => item.status !== "completed" && item.status !== "cancelled"))
  const show = createMemo(() => active().length > 0)

  const color = (status: string) => {
    if (status === "in_progress") return theme().info
    if (status === "pending") return theme().warning
    return theme().textMuted
  }

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => active().length > 2 && setOpen((x) => !x)}>
          <Show when={active().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>
              <span style={{ fg: theme().warning }}>{"▲"}</span> Signals
            </b>
            <span style={{ fg: theme().textMuted }}> {active().length}</span>
          </text>
        </box>
        <Show when={active().length <= 2 || open()}>
          <For each={active()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={color(item.status)}>
                  {STATUS_ICON[item.status] ?? "○"}
                </text>
                <text fg={theme().textMuted} wrapMode="word">
                  {item.content}
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      context_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
