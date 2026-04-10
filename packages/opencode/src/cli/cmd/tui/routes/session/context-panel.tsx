import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { TuiPluginRuntime } from "../../plugin"
import { getScrollAcceleration } from "../../util/scroll"

export function ContextPanel(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const accel = createMemo(() => getScrollAcceleration(config))

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
            <TuiPluginRuntime.Slot name="context_title" mode="single_winner" session_id={props.sessionID}>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot name="context_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="context_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.info }}>{"◇"}</span> Thread context
            </text>
          </TuiPluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
