import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"

type MemoryState = {
  observations: string | null
  reflections: string | null
  observation_tokens: number
  generation_count: number
  last_observed_at: number | null
  is_observing: boolean
  is_reflecting: boolean
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + "…"
}

export function DialogMemory(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [tick, setTick] = createSignal(0)

  // Poll every 2s so the status updates while observer is running
  onMount(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000)
    onCleanup(() => clearInterval(id))
  })

  const [mem] = createResource(tick, async (): Promise<MemoryState | null> => {
    try {
      const res = await sdk.client.session.memory({ sessionID: props.sessionID })
      return (res.data as MemoryState) ?? null
    } catch {
      return null
    }
  })

  const tok = () => {
    const t = mem()?.observation_tokens ?? 0
    if (t === 0) return "—"
    return `${t.toLocaleString()} tokens`
  }

  const status = () => {
    if (mem()?.is_reflecting) return { text: "◈ reflecting…", color: theme.warning ?? theme.accent }
    if (mem()?.is_observing) return { text: "◎ observing…", color: theme.textMuted }
    const gen = mem()?.generation_count ?? 0
    if (gen === 0) return { text: "idle — no observations yet", color: theme.textMuted }
    return { text: `idle · ${gen} cycle${gen === 1 ? "" : "s"}`, color: theme.textMuted }
  }

  const hasReflections = () => !!mem()?.reflections
  const active = () => mem()?.reflections ?? mem()?.observations

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Session Memory
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>Observer</text>
          <text fg={status().color}>{status().text}</text>
        </box>

        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>Observations</text>
          <text fg={theme.text}>{tok()}</text>
        </box>

        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>Reflections</text>
          <text fg={hasReflections() ? theme.success : theme.textMuted}>
            {hasReflections() ? "active (condensed)" : "none"}
          </text>
        </box>

        <Show when={mem()?.last_observed_at}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Last observed</text>
            <text fg={theme.textMuted}>{new Date(mem()!.last_observed_at!).toLocaleTimeString()}</text>
          </box>
        </Show>
      </box>

      <Show when={active()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            {hasReflections() ? "Reflections (condensed)" : "Observations"}
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {truncate(active()!, 800)}
          </text>
        </box>
      </Show>

      <Show when={!active() && mem() !== undefined}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>No observations yet. Observer fires after ~30k tokens of conversation.</text>
        </box>
      </Show>
    </box>
  )
}
