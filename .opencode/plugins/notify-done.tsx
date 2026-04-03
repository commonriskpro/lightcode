/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function desk(sub: string) {
  const body = esc("El agente terminó de trabajar")
  const title = esc("OpenCode")
  const hint = esc(sub)
  if (process.platform === "darwin") {
    Bun.spawn([
      "osascript",
      "-e",
      `display notification "${body}" with title "${title}" subtitle "${hint}"`,
    ])
    return
  }
  if (process.platform === "linux") {
    Bun.spawn(["notify-send", "-a", "OpenCode", title, `${hint} — ${body}`])
  }
}

const tui: TuiPlugin = async (api) => {
  const busy = new Set<string>()

  api.event.on("session.status", (evt) => {
    if (evt.type !== "session.status") return
    const id = evt.properties.sessionID
    if (evt.properties.status.type === "idle") {
      if (!busy.has(id)) return
      busy.delete(id)
      api.ui.toast({
        title: "OpenCode",
        message: "El agente terminó de trabajar",
        variant: "success",
        duration: 5000,
      })
      void api.client.session.get({ sessionID: id }).then(
        (r) => desk(r.data?.title?.trim() || "Sesión"),
        () => desk("Sesión"),
      )
      return
    }
    busy.add(id)
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "notify.done",
  tui,
}

export default plugin
