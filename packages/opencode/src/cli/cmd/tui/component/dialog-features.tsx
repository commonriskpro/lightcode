import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { Keybind } from "@/util/keybind"
import { createMemo, createSignal } from "solid-js"

type Feature = {
  name: string
  key: string
  desc: string
}

const list: Feature[] = [
  { name: "Tool Deferral", key: "tool_deferral.enabled", desc: "Load tools on-demand" },
  { name: "Tool Search", key: "tool_deferral.search_tool", desc: "Enable tool_search helper" },
  { name: "Agent Swarms", key: "agent_swarms", desc: "team_create / send_message / list_peers" },
  { name: "Workflow Scripts", key: "workflow_scripts", desc: "workflow_run / workflow_list" },
  { name: "Cron Jobs", key: "cron_jobs", desc: "cron_create / cron_list / cron_delete" },
  { name: "Web Browser", key: "web_browser", desc: "browser automation tool" },
  { name: "Context Inspection", key: "context_inspection", desc: "ctx_inspect tool" },
  { name: "Session Hooks", key: "session_hooks", desc: "ephemeral per-session hooks" },
]

function get(obj: any, path: string) {
  let cur = obj
  for (const item of path.split(".")) {
    if (cur == null) return undefined
    cur = cur[item]
  }
  return cur
}

function set(obj: any, path: string, value: boolean) {
  const parts = path.split(".")
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {}
    cur = cur[key]
  }
  cur[parts[parts.length - 1]] = value
}

function fail(err: unknown) {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (err && typeof err === "object") {
    const data = (err as any).errors
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0]
      if (typeof first?.message === "string") return first.message
      return JSON.stringify(first)
    }
    if (typeof (err as any).message === "string") return (err as any).message
    return JSON.stringify(err)
  }
  return "Failed to update feature"
}

export function DialogFeatures() {
  const sync = useSync()
  const toast = useToast()
  const sdk = useSDK()
  const [cfg, setCfg] = createSignal<any>((sync.data.config ?? {}) as any)
  let busy = false

  const exp = () => (cfg().experimental ?? {}) as any

  const options = createMemo(() =>
    list.map((item) => {
      const enabled = get(exp(), item.key) === true
      return {
        title: `${enabled ? "[x]" : "[ ]"} ${item.name}`,
        description: `${item.desc} · ${item.key}`,
        value: item,
      }
    }),
  )

  async function toggle(item: Feature) {
    if (busy) return
    busy = true
    try {
      const base = (await sdk.client.config.get({}, { throwOnError: true })).data as any
      const cur = get(base?.experimental ?? {}, item.key) === true
      const next = !cur
      const patch: any = { experimental: {} }
      set(patch, `experimental.${item.key}`, next)
      try {
        await sdk.client.config.update({ config: patch }, { throwOnError: true })
      } catch (err) {
        await sdk.client.config.update(patch, { throwOnError: true }).catch(() => Promise.reject(err))
      }
      const fresh = (await sdk.client.config.get({}, { throwOnError: true })).data as any
      const value = get(fresh?.experimental ?? {}, item.key) === true
      if (value !== next) throw new Error("Config update did not persist")
      if (fresh) setCfg(fresh)
      toast.show({
        variant: "success",
        message: `${item.name}: ${next ? "enabled" : "disabled"}`,
      })
    } catch (err) {
      toast.show({
        variant: "error",
        message: fail(err),
      })
    } finally {
      busy = false
    }
  }

  return (
    <DialogSelect<Feature>
      title="Experimental features"
      options={options()}
      keybind={[
        {
          keybind: Keybind.parse("space")[0],
          title: "Toggle",
          onTrigger: (option) => {
            void toggle(option.value)
          },
        },
      ]}
      onSelect={(option) => {
        void toggle(option.value)
      }}
    />
  )
}
