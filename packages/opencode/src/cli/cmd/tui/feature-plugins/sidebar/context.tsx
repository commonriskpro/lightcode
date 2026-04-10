import type { AssistantMessage, StepFinishPart } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function bar(pct: number, width: number): string {
  const filled = Math.round(Math.min(1, pct) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const parts = (messageID: string) => props.api.state.part(messageID)
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const msgParts = parts(last.id)
    const lastStepFinish = msgParts.findLast((p): p is StepFinishPart => p.type === "step-finish")
    const step = lastStepFinish ?? last
    const tokens =
      step.tokens.input + step.tokens.cache.read + step.tokens.cache.write + step.tokens.output + step.tokens.reasoning

    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const pct = createMemo(() => (state().percent ?? 0) / 100)
  const color = createMemo(() => {
    const p = pct()
    if (p >= 0.9) return theme().error
    if (p >= 0.7) return theme().warning
    return theme().info
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>
          <span style={{ fg: theme().info }}>{"⊡"}</span> Telemetry
        </b>
      </text>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().textMuted}>tokens</text>
        <text fg={theme().text}>{state().tokens.toLocaleString()}</text>
      </box>
      <Show when={state().percent !== null}>
        <text fg={color()}>
          {bar(pct(), 18)} {state().percent}%
        </text>
      </Show>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().textMuted}>cost</text>
        <text fg={theme().text}>{money.format(cost())}</text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
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
