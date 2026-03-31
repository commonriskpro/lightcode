import { createMemo, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "../context/sync"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

export function DialogMeter(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const turns = createMemo(() => {
    const msgs = messages()
    return msgs
      .filter((m): m is AssistantMessage => m.role === "assistant" && m.tokens && m.tokens.output > 0)
      .map((m) => ({
        id: m.id,
        input: m.tokens!.input,
        output: m.tokens!.output,
        reasoning: m.tokens!.reasoning,
        cacheRead: m.tokens!.cache.read,
        cacheWrite: m.tokens!.cache.write,
        total: m.tokens!.total ?? m.tokens!.input + m.tokens!.output + m.tokens!.reasoning,
        cost: m.cost ?? 0,
        model: m.modelID,
        agent: m.agent,
        time: m.time,
      }))
  })

  const sessionTotals = createMemo(() => {
    const t = turns()
    return {
      input: t.reduce((sum, t) => sum + t.input, 0),
      output: t.reduce((sum, t) => sum + t.output, 0),
      reasoning: t.reduce((sum, t) => sum + t.reasoning, 0),
      cacheRead: t.reduce((sum, t) => sum + t.cacheRead, 0),
      cacheWrite: t.reduce((sum, t) => sum + t.cacheWrite, 0),
      total: t.reduce((sum, t) => sum + t.total, 0),
      cost: t.reduce((sum, t) => sum + t.cost, 0),
      turns: t.length,
    }
  })

  const lastTurn = createMemo(() => {
    const t = turns()
    return t.length > 0 ? t[t.length - 1] : null
  })

  const formatNum = (n: number) => n.toLocaleString()

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Token Meter
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* Last turn */}
      <Show when={lastTurn()} fallback={<text fg={theme.textMuted}>No turns yet</text>}>
        {(lt) => (
          <box flexDirection="column" gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Last turn
            </text>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                Input: <span style={{ fg: theme.primary }}>{formatNum(lt().input)}</span>
              </text>
              <text fg={theme.text}>
                Output: <span style={{ fg: theme.success }}>{formatNum(lt().output)}</span>
              </text>
              <text fg={theme.text}>
                Total: <span style={{ fg: theme.accent }}>{formatNum(lt().total)}</span>
              </text>
            </box>
            <Show when={lt().cacheRead > 0 || lt().cacheWrite > 0}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>
                  Cache read: <span style={{ fg: theme.text }}>{formatNum(lt().cacheRead)}</span>
                </text>
                <text fg={theme.textMuted}>
                  Cache write: <span style={{ fg: theme.text }}>{formatNum(lt().cacheWrite)}</span>
                </text>
              </box>
            </Show>
            <Show when={lt().reasoning > 0}>
              <text fg={theme.textMuted}>
                Reasoning: <span style={{ fg: theme.text }}>{formatNum(lt().reasoning)}</span>
              </text>
            </Show>
            <Show when={lt().cost > 0}>
              <text fg={theme.textMuted}>Cost: ${lt().cost.toFixed(4)}</text>
            </Show>
          </box>
        )}
      </Show>

      {/* Session totals */}
      <Show when={sessionTotals().turns > 0}>
        <box flexDirection="column" gap={0} marginTop={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Session total ({sessionTotals().turns} turns)
          </text>
          <box flexDirection="row" gap={2}>
            <text fg={theme.text}>
              Input: <span style={{ fg: theme.primary }}>{formatNum(sessionTotals().input)}</span>
            </text>
            <text fg={theme.text}>
              Output: <span style={{ fg: theme.success }}>{formatNum(sessionTotals().output)}</span>
            </text>
            <text fg={theme.text}>
              Total: <span style={{ fg: theme.accent }}>{formatNum(sessionTotals().total)}</span>
            </text>
          </box>
          <Show when={sessionTotals().cost > 0}>
            <text fg={theme.textMuted}>Total cost: ${sessionTotals().cost.toFixed(4)}</text>
          </Show>
        </box>
      </Show>

      {/* Per-turn breakdown */}
      <Show when={turns().length > 1}>
        <box flexDirection="column" gap={0} marginTop={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            All turns
          </text>
          <box flexDirection="column" gap={0}>
            <For each={turns()}>
              {(turn, idx) => (
                <text fg={theme.textMuted}>
                  #{idx() + 1} <span style={{ fg: theme.primary }}>{formatNum(turn.input)}</span> in{" "}
                  <span style={{ fg: theme.success }}>{formatNum(turn.output)}</span> out{" "}
                  <span style={{ fg: theme.textMuted }}>= {formatNum(turn.total)}</span>
                  <Show when={turn.cost > 0}>
                    {" "}
                    <span style={{ fg: theme.textMuted }}>${turn.cost.toFixed(4)}</span>
                  </Show>
                </text>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  )
}
