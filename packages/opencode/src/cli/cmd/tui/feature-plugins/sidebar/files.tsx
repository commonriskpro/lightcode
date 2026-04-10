import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-files"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.diff(props.session_id))

  const icon = (status?: string) => {
    if (status === "added") return { char: "+", fg: theme().success }
    if (status === "deleted") return { char: "−", fg: theme().error }
    return { char: "~", fg: theme().info }
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>
              <span style={{ fg: theme().secondary }}>{"●"}</span> Anchored
            </b>
            <span style={{ fg: theme().textMuted }}> {list().length}</span>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => {
              const name = item.file.split("/").pop() ?? item.file
              const i = icon(item.status)
              return (
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme().textMuted} wrapMode="none">
                    <span style={{ fg: i.fg }}>{i.char}</span> {name}
                  </text>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    <Show when={item.additions}>
                      <text fg={theme().diffAdded}>+{item.additions}</text>
                    </Show>
                    <Show when={item.deletions}>
                      <text fg={theme().diffRemoved}>-{item.deletions}</text>
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
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
