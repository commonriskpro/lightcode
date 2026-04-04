import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { Keybind } from "@/util/keybind"
import { createMemo, createSignal } from "solid-js"
import { FLAGS, get, mode, modePatch, MODES, set, type Mode } from "@/cli/cmd/features-model"

type Item =
  | { kind: "mode"; mode: Mode; name: string; desc: string }
  | { kind: "flag"; key: string; name: string; desc: string; category: string; defaultValue: boolean }

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
  const active = createMemo(() => mode(exp()))
  const flags = createMemo(() => {
    if (active() === "deferred") return FLAGS.deferred
    if (active() === "xenova") return FLAGS.xenova
    return []
  })

  const options = createMemo(() =>
    [
      ...MODES.map((item): Item => ({ kind: "mode", mode: item.mode, name: item.name, desc: item.desc })),
      ...flags().map(
        (item): Item => ({
          kind: "flag",
          key: item.key,
          name: item.name,
          desc: item.desc,
          defaultValue: item.defaultValue,
          category: `Mode: ${active()}`,
        }),
      ),
      ...FLAGS.extra.map(
        (item): Item => ({
          kind: "flag",
          key: item.key,
          name: item.name,
          desc: item.desc,
          defaultValue: item.defaultValue,
          category: "Extra",
        }),
      ),
    ].map((item) => {
      if (item.kind === "mode") {
        const enabled = active() === item.mode
        return {
          title: `${enabled ? "[x]" : "[ ]"} ${item.name}`,
          description: `${item.desc} · mode.${item.mode}`,
          value: item,
          category: "Mode",
        }
      }
      const enabled = get(exp(), item.key) === true
      const note = get(exp(), item.key) === undefined ? ` (default: ${item.defaultValue ? "on" : "off"})` : ""
      return {
        title: `${enabled ? "[x]" : "[ ]"} ${item.name}${note}`,
        description: `${item.desc} · experimental.${item.key}`,
        value: item,
        category: item.category,
      }
    }),
  )

  async function toggle(item: Item) {
    if (busy) return
    busy = true
    try {
      const base = (await sdk.client.config.get({}, { throwOnError: true })).data as any
      const patch: any = { experimental: {} }
      if (item.kind === "mode") {
        for (const [key, value] of Object.entries(modePatch(item.mode))) {
          set(patch.experimental, key, value)
        }
      }
      if (item.kind === "flag") {
        const cur = get(base?.experimental ?? {}, item.key) === true
        set(patch.experimental, item.key, !cur)
      }
      try {
        await sdk.client.config.update({ config: patch }, { throwOnError: true })
      } catch (err) {
        await sdk.client.config.update(patch, { throwOnError: true }).catch(() => Promise.reject(err))
      }
      const fresh = (await sdk.client.config.get({}, { throwOnError: true })).data as any
      if (item.kind === "mode") {
        const next = mode(fresh?.experimental ?? {})
        if (next !== item.mode) throw new Error("Config update did not persist")
      }
      if (item.kind === "flag") {
        const baseValue = get(base?.experimental ?? {}, item.key) === true
        const nextValue = get(fresh?.experimental ?? {}, item.key) === true
        if (nextValue === baseValue) throw new Error("Config update did not persist")
      }
      if (fresh) setCfg(fresh)
      toast.show({
        variant: "success",
        message:
          item.kind === "mode"
            ? `Mode: ${MODES.find((entry) => entry.mode === item.mode)?.name ?? item.mode}`
            : `${item.name}: ${get(fresh?.experimental ?? {}, item.key) === true ? "enabled" : "disabled"}`,
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
    <DialogSelect<Item>
      title="Features"
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
