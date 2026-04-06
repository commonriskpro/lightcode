import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useRouteData } from "@tui/context/route"

type Layer = { key: string; tokens: number; hash?: string }
type Profile = {
  sessionID: string
  requestAt: number
  recallReused: boolean
  layers: Layer[]
  cache: { read: number; write: number }
}

const LABELS: Record<string, string> = {
  head: "Head          ",
  rest: "Env/Skills    ",
  working_memory: "Working Mem   ",
  observations_stable: "Obs Stable    ",
  observations_live: "Obs Live      ",
  semantic_recall: "Recall        ",
  tail: "Messages      ",
}

function bar(tokens: number, total: number, width = 18) {
  if (!total) return "░".repeat(width)
  const filled = Math.round(Math.min(1, tokens / total) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function fmt(n: number) {
  return n.toLocaleString()
}

export function DialogCacheDebug() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()

  const route = useRouteData("session")
  const sessionID = () => route?.sessionID as string | undefined

  const [profile, setProfile] = createSignal<Profile | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  async function refresh() {
    const sid = sessionID()
    if (!sid) return
    try {
      const url = new URL(`${sdk.url}/experimental/prompt-profile`)
      url.searchParams.set("sessionID", sid)
      const res = await sdk.fetch(url.toString())
      if (!res.ok) throw new Error(await res.text())
      setProfile(((await res.json()) as Profile | null) ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  let interval: ReturnType<typeof setInterval> | undefined
  onMount(() => {
    void refresh()
    interval = setInterval(() => void refresh(), 2000)
  })
  onCleanup(() => clearInterval(interval))

  const total = createMemo(() => profile()?.layers.reduce((s, l) => s + l.tokens, 0) ?? 0)

  const readPct = createMemo(() => {
    const p = profile()
    if (!p || total() === 0) return 0
    return Math.round((p.cache.read / total()) * 100)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Cache Debug
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={error()}>{(err) => <text fg={theme.error}>{err()}</text>}</Show>

      <Show when={!profile() && !error()}>
        <text fg={theme.textMuted}>No prompt profile yet for this session. Send a message first.</text>
      </Show>

      <Show when={profile()}>
        {(p) => (
          <box gap={1}>
            {/* Header row: time + recall reuse signal */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>{new Date(p().requestAt).toLocaleTimeString()}</text>
              <text
                fg={p().recallReused ? theme.success : theme.textMuted}
                attributes={p().recallReused ? TextAttributes.BOLD : 0}
              >
                {p().recallReused ? "↺ recall reused" : "recall fresh"}
              </text>
            </box>

            {/* Cache counters */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>cache read</text>
              <text fg={p().cache.read > 0 ? theme.success : theme.textMuted}>{fmt(p().cache.read)} tkns</text>
              <text fg={theme.textMuted}>write</text>
              <text fg={p().cache.write > 0 ? theme.warning : theme.textMuted}>{fmt(p().cache.write)} tkns</text>
              <text fg={readPct() >= 30 ? theme.success : readPct() > 0 ? theme.warning : theme.textMuted}>
                {readPct()}% hit
              </text>
            </box>

            {/* Total */}
            <text fg={theme.textMuted}>total {fmt(total())} tokens</text>

            {/* Per-layer breakdown */}
            <For each={p().layers}>
              {(layer) => {
                const pct = total() > 0 ? Math.round((layer.tokens / total()) * 100) : 0
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>{LABELS[layer.key] ?? layer.key.padEnd(14)}</text>
                    <text fg={theme.accent}>{bar(layer.tokens, total())}</text>
                    <text fg={theme.text}>{fmt(layer.tokens)}</text>
                    <text fg={theme.textMuted}>{pct}%</text>
                    <Show when={layer.hash}>
                      <text fg={theme.textMuted}>{layer.hash!.slice(0, 8)}</text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </Show>
    </box>
  )
}
