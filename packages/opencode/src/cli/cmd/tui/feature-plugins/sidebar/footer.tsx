import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Global } from "@/global"

const DREAM_FRAMES = [
  "☁     dreaming   ",
  "☁ ☁   dreaming.  ",
  "☁   ☁  dreaming..",
  "☁     ☁ dreaming…",
  "☁   ☁  dreaming..",
  "☁ ☁   dreaming.  ",
  "✦ ☁   dreaming   ",
  "✦ ☁ ✦ dreaming.  ",
  "✦  ☁ ✦ dreaming..",
  "✦ ☁ ✦  dreaming… ",
  "✦ ☁   dreaming.  ",
  "☁     dreaming   ",
]

const OBSERVE_FRAMES = [
  "◎ observing   ",
  "◎ observing.  ",
  "◎ observing.. ",
  "◎ observing...",
  "◉ observing.. ",
  "◉ observing.  ",
  "◉ observing   ",
  "◉ observing.  ",
]

const REFLECT_FRAMES = [
  "◈ reflecting   ",
  "◈ reflecting.  ",
  "◈ reflecting.. ",
  "◈ reflecting...",
  "◇ reflecting.. ",
  "◇ reflecting.  ",
  "◇ reflecting   ",
  "◇ reflecting.  ",
]

const STICKY_MS = 1500

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const [isDreaming, setIsDreaming] = createSignal(false)
  const [isObserving, setIsObserving] = createSignal(false)
  const [isReflecting, setIsReflecting] = createSignal(false)
  const [frame, setFrame] = createSignal(0)
  const [obsFrame, setObsFrame] = createSignal(0)
  const [refFrame, setRefFrame] = createSignal(0)
  const [dreamUntil, setDreamUntil] = createSignal(0)
  const [obsUntil, setObsUntil] = createSignal(0)
  const [refUntil, setRefUntil] = createSignal(0)

  onMount(() => {
    const poll = setInterval(() => {
      void (async () => {
        const now = Date.now()
        const mem = await props.api.client.session.memory({ sessionID: props.session_id }).catch(() => undefined)
        const obs = (mem?.data as { is_observing?: boolean } | undefined)?.is_observing === true
        const ref = (mem?.data as { is_reflecting?: boolean } | undefined)?.is_reflecting === true
        const dream = (mem?.data as { is_dreaming?: boolean } | undefined)?.is_dreaming === true
        if (dream) setDreamUntil(now + STICKY_MS)
        setIsDreaming(dream || now < dreamUntil())
        if (obs) setObsUntil(now + STICKY_MS)
        if (ref) setRefUntil(now + STICKY_MS)
        setIsObserving(obs || now < obsUntil())
        setIsReflecting(ref || now < refUntil())
        if (dream || now < dreamUntil()) setFrame((f) => (f + 1) % DREAM_FRAMES.length)
        if (obs || now < obsUntil()) setObsFrame((f) => (f + 1) % OBSERVE_FRAMES.length)
        if (ref || now < refUntil()) setRefFrame((f) => (f + 1) % REFLECT_FRAMES.length)
      })()
    }, 400)
    onCleanup(() => clearInterval(poll))
  })
  const path = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const out = dir.replace(Global.Path.home, "~")
    const text = props.api.state.vcs?.branch ? out + ":" + props.api.state.vcs.branch : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>OpenCode includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme().text }}>{path().name}</span>
      </text>
      <Show when={isReflecting()}>
        <text fg={theme().warning ?? theme().accent}>{REFLECT_FRAMES[refFrame()]}</text>
      </Show>
      <Show when={isObserving() && !isReflecting()}>
        <text fg={theme().textMuted}>{OBSERVE_FRAMES[obsFrame()]}</text>
      </Show>
      <Show when={isDreaming()}>
        <text fg={theme().accent}>{DREAM_FRAMES[frame()]}</text>
      </Show>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>Open</b>
        <span style={{ fg: theme().text }}>
          <b>Code</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer(_ctx, props) {
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
