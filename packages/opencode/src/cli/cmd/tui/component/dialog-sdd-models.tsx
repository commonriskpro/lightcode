import path from "path"
import { createEffect, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { sortBy } from "remeda"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogModel } from "@tui/component/dialog-model"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/keybind"
import {
  addSddProfile,
  deleteSddProfile,
  ensureSddModels,
  forkProfileWithAgent,
  normalizeProfileName,
  parseProviderModel,
  saveSddModelsActive,
  saveSddModelsAgentModel,
  type SddModelsData,
} from "@tui/util/sdd-models-file"
import { isSddBuiltinProfile } from "@tui/util/sdd-models-default"
import type { Agent } from "@opencode-ai/sdk/v2"

type MainRow = { kind: "profile" } | { kind: "agent"; name: string }

function formatModel(m: { providerID: string; modelID: string }) {
  return `${m.providerID}/${m.modelID}`
}

/** Profile file override, else merged agent config, else primary session model. */
function effectiveAgentLabel(
  overlay: string | undefined,
  agent: Agent,
  session: { providerID: string; modelID: string } | undefined,
) {
  const o = overlay?.trim()
  if (o) return o
  if (agent.model?.providerID && agent.model.modelID) return formatModel(agent.model)
  if (session) return formatModel(session)
  return "—"
}

function pickerCurrent(
  overlay: string | undefined,
  agent: Agent,
  session: { providerID: string; modelID: string } | undefined,
): { providerID: string; modelID: string } | undefined {
  const o = overlay?.trim()
  if (o) return parseProviderModel(o) ?? undefined
  if (agent.model?.providerID && agent.model.modelID) return agent.model
  return session
}

const NEW_SENTINEL = "__new__"

function DialogSddProfilePick(props: { fp: string; data: SddModelsData }) {
  const dialog = useDialog()
  const toast = useToast()
  const keybind = useKeybind()
  const d = props.data
  const names = Object.keys(d.profiles).sort()
  const delKey = keybind.all.session_delete?.[0] ?? Keybind.parse("ctrl+d")[0]

  return (
    <DialogSelect<string>
      title="Active profile"
      flat={true}
      skipFilter={true}
      current={d.active}
      options={[
        ...names.map((n) => ({ title: n, value: n, category: "Profiles" })),
        { title: "+ New profile", value: NEW_SENTINEL, category: "Profile" },
      ]}
      keybind={[
        {
          keybind: delKey,
          title: "Delete profile",
          onTrigger: (option) => {
            if (option.value === NEW_SENTINEL) {
              toast.show({ message: "Select a profile to delete", variant: "warning" })
              return
            }
            const name = option.value
            if (isSddBuiltinProfile(name)) {
              toast.show({ message: `Built-in profile "${name}" cannot be deleted`, variant: "warning" })
              return
            }
            void (async () => {
              const ok = await DialogConfirm.show(dialog, "Delete profile", `Remove "${name}"?`)
              if (ok !== true) {
                dialog.replace(() => <DialogSddProfilePick fp={props.fp} data={d} />)
                return
              }
              try {
                await deleteSddProfile(props.fp, name)
                toast.show({ message: `Removed ${name}`, variant: "success" })
                dialog.replace(() => <DialogSddModels />)
              } catch (e: unknown) {
                toast.show({
                  message: e instanceof Error ? e.message : String(e),
                  variant: "error",
                })
                dialog.replace(() => <DialogSddModels />)
              }
            })()
          },
        },
      ]}
      onSelect={(o) => {
        if (o.value === NEW_SENTINEL) {
          dialog.replace(() => (
            <DialogPrompt
              title="New profile name"
              placeholder="e.g. client-a"
              onConfirm={(raw) => {
                const name = normalizeProfileName(raw ?? "")
                if (!name) {
                  toast.show({
                    message: "Invalid name (letters, digits, ._- only)",
                    variant: "error",
                  })
                  dialog.replace(() => <DialogSddModels />)
                  return
                }
                void addSddProfile(props.fp, name, d.active)
                  .then(() => {
                    toast.show({ message: `Profile ${name}`, variant: "success" })
                    dialog.replace(() => <DialogSddModels />)
                  })
                  .catch((e: unknown) => {
                    toast.show({
                      message: e instanceof Error ? e.message : String(e),
                      variant: "error",
                    })
                    dialog.replace(() => <DialogSddModels />)
                  })
              }}
            />
          ))
          return
        }
        void saveSddModelsActive(props.fp, o.value).then(() => {
          toast.show({ message: `Active profile: ${o.value}`, variant: "success" })
          dialog.replace(() => <DialogSddModels />)
        })
      }}
    />
  )
}

/** Same shape as `sdd-models-default.ts` — show UI immediately; disk load can follow. */
const DEFAULT: SddModelsData = {
  active: "balanced",
  profiles: {
    balanced: {},
    quality: {},
    economy: {},
  },
}

export function DialogSddModels() {
  const sync = useSync()
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()
  const [store, setStore] = createStore<{
    data: SddModelsData
    err: string | undefined
  }>({
    data: DEFAULT,
    err: undefined,
  })

  const filepath = createMemo(() =>
    path.resolve(sync.data.path.directory || process.cwd(), ".opencode", "sdd-models.jsonc"),
  )

  let loadGen = 0
  createEffect(() => {
    const fp = filepath()
    const id = ++loadGen
    void ensureSddModels(fp)
      .then((d) => {
        if (id !== loadGen) return
        setStore({
          data: d,
          err: undefined,
        })
      })
      .catch((e: unknown) => {
        if (id !== loadGen) return
        setStore("err", e instanceof Error ? e.message : String(e))
      })
  })

  const agents = createMemo(() =>
    sortBy(
      sync.data.agent.filter((a) => a.name.startsWith("sdd-")),
      (a) => a.name,
    ),
  )

  const options = createMemo(() => {
    const d = store.data
    const prof = d.profiles[d.active] ?? {}
    const session = local.model.current()
    const rows: {
      category: string
      title: string
      description?: string
      value: MainRow
    }[] = [
      {
        category: "Profile",
        title: `Active: ${d.active}`,
        description: "Switch or add profile",
        value: { kind: "profile" },
      },
    ]
    for (const a of agents()) {
      rows.push({
        category: "SDD agents",
        title: a.name,
        description: effectiveAgentLabel(prof[a.name], a, session),
        value: { kind: "agent", name: a.name },
      })
    }
    return rows
  })

  return (
    <Show
      when={!store.err}
      fallback={
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text>{store.err}</text>
        </box>
      }
    >
      <DialogSelect<MainRow>
        title="SDD model profiles"
        flat={true}
        skipFilter={true}
        options={options()}
        onSelect={(opt) => {
          const fp = filepath()
          const d = store.data
          if (opt.value.kind === "profile") {
            dialog.replace(() => <DialogSddProfilePick fp={fp} data={d} />)
            return
          }
          const agent = opt.value.name
          const modelStr = d.profiles[d.active]?.[agent]
          const agentCfg = agents().find((x) => x.name === agent)
          const cur = agentCfg
            ? pickerCurrent(modelStr, agentCfg, local.model.current())
            : undefined
          const activeProfile = d.active
          dialog.replace(() => (
            <DialogModel
              pick={({ providerID, modelID }) => {
                const model = `${providerID}/${modelID}`
                dialog.replace(() => (
                  <DialogSelect<"current" | "new">
                    title={`Save · ${agent}`}
                    flat={true}
                    skipFilter={true}
                    options={[
                      {
                        title: `Update "${activeProfile}"`,
                        value: "current",
                        description: "Overwrite this profile",
                      },
                      {
                        title: "New profile",
                        value: "new",
                        description: `Copy "${activeProfile}" + this change`,
                      },
                    ]}
                    onSelect={(o) => {
                      if (o.value === "current") {
                        void saveSddModelsAgentModel(fp, activeProfile, agent, model).then(() => {
                          toast.show({
                            message: `${agent} → ${model}`,
                            variant: "success",
                          })
                          dialog.replace(() => <DialogSddModels />)
                        })
                        return
                      }
                      dialog.replace(() => (
                        <DialogPrompt
                          title="New profile name"
                          placeholder="e.g. client-a"
                          onConfirm={(raw) => {
                            const name = normalizeProfileName(raw ?? "")
                            if (!name) {
                              toast.show({
                                message: "Invalid name (letters, digits, ._- only)",
                                variant: "error",
                              })
                              dialog.replace(() => <DialogSddModels />)
                              return
                            }
                            void forkProfileWithAgent(fp, name, activeProfile, agent, model)
                              .then(() => {
                                toast.show({
                                  message: `Profile ${name} · ${agent} → ${model}`,
                                  variant: "success",
                                })
                                dialog.replace(() => <DialogSddModels />)
                              })
                              .catch((e: unknown) => {
                                toast.show({
                                  message: e instanceof Error ? e.message : String(e),
                                  variant: "error",
                                })
                                dialog.replace(() => <DialogSddModels />)
                              })
                          }}
                        />
                      ))
                    }}
                  />
                ))
              }}
              current={cur}
            />
          ))
        }}
      />
    </Show>
  )
}
