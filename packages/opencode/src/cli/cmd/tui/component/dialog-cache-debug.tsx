import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useRouteData } from "@tui/context/route"

type Layer = { key: string; tokens: number; hash?: string }
type Alignment = {
  total: number
  limit: number
  ok: boolean
  systemBP: number[]
  messageBP: { i: number; role: string }[]
  toolBP: string[]
}
type BPStatus = "stable" | "broke" | "new" | "always"
type BPStatusMap = { bp1: BPStatus; bp2: BPStatus; bp3: "always"; bp4: BPStatus }

type Profile = {
  sessionID: string
  requestAt: number
  recallReused: boolean
  layers: Layer[]
  cache: { read: number; write: number; input: number }
  tools?: { count: number; names: string[]; tokens: number }
  alignment?: Alignment
  prevHashes?: Record<string, string>
  bpStatus?: BPStatusMap
}

const LABELS: Record<string, string> = {
  head: "Head          ",
  rest: "Env/Skills    ",
  working_memory: "Working Mem   ",
  observations_stable: "Obs Stable    ",
  observations_live: "Obs Live      ",
  semantic_recall: "Recall        ",
  tools: "Tools         ",
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
  const providerInput = createMemo(() => {
    const p = profile()
    if (!p) return 0
    return p.cache.read + p.cache.write + p.cache.input
  })

  const readPct = createMemo(() => {
    const p = profile()
    if (!p) return 0
    const totalInput = p.cache.read + p.cache.write + p.cache.input
    if (totalInput === 0) return 0
    return Math.round((p.cache.read / totalInput) * 100)
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

            <Show when={p().tools}>
              {(t) => (
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted}>tools</text>
                  <text fg={theme.text}>{t().count}</text>
                  <text fg={theme.textMuted}>defs</text>
                  <text fg={theme.accent}>{fmt(t().tokens)} tkns</text>
                  <text fg={theme.textMuted}>
                    {t().names.slice(0, 4).join(",")}
                    {t().names.length > 4 ? ",…" : ""}
                  </text>
                </box>
              )}
            </Show>

            {/* Cache alignment — breakpoint audit (Anthropic only) */}
            <Show when={p().alignment}>
              {(a) => (
                <box gap={1}>
                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>breakpoints</text>
                    <text fg={a().ok ? theme.success : theme.error} attributes={TextAttributes.BOLD}>
                      {a().total}/{a().limit}
                    </text>
                    <text fg={a().ok ? theme.success : theme.error}>{a().ok ? "✓ ok" : "✗ over limit"}</text>
                  </box>
                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>{"  system"}</text>
                    <text fg={a().systemBP.length > 0 ? theme.success : theme.error}>
                      {a().systemBP.length > 0 ? `[${a().systemBP.join(",")}]` : "none"}
                    </text>
                    <text fg={theme.textMuted}>{"tools"}</text>
                    <text fg={a().toolBP.length > 0 ? theme.success : theme.warning}>
                      {a().toolBP.length > 0 ? a().toolBP[a().toolBP.length - 1] : "none"}
                    </text>
                    <text fg={theme.textMuted}>{"msgs"}</text>
                    <text fg={a().messageBP.length > 0 ? theme.success : theme.textMuted}>
                      {a().messageBP.length > 0
                        ? a()
                            .messageBP.map((m) => `${m.role}[${m.i}]`)
                            .join(",")
                        : "none"}
                    </text>
                  </box>
                </box>
              )}
            </Show>

            {/* Breakpoint stability — only shown for Anthropic-like providers (alignment present) */}
            <Show when={p().alignment && p().bpStatus}>
              {(_) => {
                const bp = () => p().bpStatus!
                const color = (s: BPStatus) =>
                  s === "stable" ? theme.success : s === "broke" ? theme.error : theme.textMuted
                const icon = (s: BPStatus) => (s === "stable" ? "✓" : s === "broke" ? "⚡" : s === "always" ? "↻" : "·")
                const entries: [string, BPStatus][] = [
                  ["BP1 head+sys", bp().bp1],
                  ["BP2 memory  ", bp().bp2],
                  ["BP3 conv    ", bp().bp3],
                  ["BP4 tools   ", bp().bp4],
                ]
                return (
                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>breakpts</text>
                    <For each={entries}>
                      {([label, status]) => (
                        <box flexDirection="row" gap={0}>
                          <text fg={color(status)} attributes={status === "broke" ? TextAttributes.BOLD : 0}>
                            {icon(status)}
                          </text>
                          <text fg={color(status)}>{label}</text>
                        </box>
                      )}
                    </For>
                  </box>
                )
              }}
            </Show>

            {/* Totals */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>local prompt {fmt(total())} tokens</text>
              <text fg={theme.textMuted}>provider input {fmt(providerInput())} tokens</text>
            </box>

            {/* Per-layer breakdown */}
            <For each={p().layers}>
              {(layer) => {
                const pct = total() > 0 ? Math.round((layer.tokens / total()) * 100) : 0
                const prev = p().prevHashes?.[layer.key]
                const broke = layer.hash && prev && layer.hash !== prev
                const stable = layer.hash && prev && layer.hash === prev
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>{LABELS[layer.key] ?? layer.key.padEnd(14)}</text>
                    <text fg={theme.accent}>{bar(layer.tokens, total())}</text>
                    <text fg={theme.text}>{fmt(layer.tokens)}</text>
                    <text fg={theme.textMuted}>{pct}%</text>
                    <Show when={layer.hash}>
                      <text fg={theme.textMuted}>{layer.hash!.slice(0, 8)}</text>
                    </Show>
                    <Show when={broke}>
                      <text fg={theme.error} attributes={TextAttributes.BOLD}>
                        ⚡broke
                      </text>
                    </Show>
                    <Show when={stable}>
                      <text fg={theme.success}>✓</text>
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
