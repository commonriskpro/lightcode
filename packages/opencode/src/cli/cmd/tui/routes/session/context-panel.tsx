import { useSync } from "@tui/context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { TuiPluginRuntime } from "../../plugin"
import { getScrollAcceleration } from "../../util/scroll"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"

export function ContextPanel(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const last = createMemo(() =>
    messages().findLast((m): m is AssistantMessage => m.role === "assistant" && m.tokens.output > 0),
  )
  const status = createMemo(() => sync.data.session_status?.[props.sessionID])

  // Thread relations
  const parent = createMemo(() => {
    const pid = session()?.parentID
    if (!pid) return null
    return sync.session.get(pid) ?? null
  })
  const children = createMemo(() => sync.data.session.filter((s) => s.parentID === props.sessionID))

  // Model display
  const model = createMemo(() => {
    const msg = last()
    if (!msg) return null
    const provider = sync.data.provider.find((p) => p.id === msg.providerID)
    const info = provider?.models[msg.modelID]
    return info?.name ?? msg.modelID
  })

  const agent = createMemo(() => last()?.agent ?? "build")

  const badge = createMemo(() => {
    const s = status()
    if (!s) return { text: "idle", color: theme.textMuted }
    if (s.type === "busy") return { text: "active", color: theme.info }
    if (s.type === "retry") return { text: "drift", color: theme.error }
    return { text: "idle", color: theme.textMuted }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={38}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={accel()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            {/* Thread header */}
            <box>
              <text fg={theme.text}>
                <b>
                  <span style={{ fg: theme.info }}>{"◈"}</span> Thread
                </b>
              </text>
              <text fg={theme.textMuted}>{Locale.truncate(session()!.title, 30)}</text>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>{agent()}</text>
                <text fg={badge().color}>{badge().text}</text>
              </box>
              <Show when={model()}>
                <text fg={theme.textMuted}>{model()}</text>
              </Show>
            </box>

            {/* Relations */}
            <Show when={parent() || children().length > 0}>
              <box>
                <text fg={theme.text}>
                  <b>
                    <span style={{ fg: theme.secondary }}>{"◇"}</span> Relations
                  </b>
                </text>
                <Show when={parent()}>
                  <text fg={theme.textMuted}>
                    ↑ <span style={{ fg: theme.secondary }}>{Locale.truncate(parent()!.title, 24)}</span>
                  </text>
                </Show>
                <For each={children().slice(0, 5)}>
                  {(child) => (
                    <text fg={theme.textMuted}>
                      ↓ <span style={{ fg: theme.secondary }}>{Locale.truncate(child.title, 24)}</span>
                    </text>
                  )}
                </For>
              </box>
            </Show>

            {/* Plugin content: telemetry, signals, anchored files */}
            <TuiPluginRuntime.Slot name="context_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} paddingTop={1}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.info }}>{"◇"}</span> {Locale.time(session()!.time.updated)}
          </text>
        </box>
      </box>
    </Show>
  )
}
