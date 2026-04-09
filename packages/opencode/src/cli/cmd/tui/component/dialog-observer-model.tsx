import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "../ui/toast"
import { pipe, flatMap, entries, filter, sortBy } from "remeda"
import * as fuzzysort from "fuzzysort"

export function DialogObserverModel() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [query, setQuery] = createSignal("")

  const current = createMemo(() => {
    const exp = sync.data.config?.experimental as Record<string, unknown> | undefined
    return (exp?.observer_model as string) ?? "opencode/qwen3.6-plus-free"
  })

  const options = createMemo(() => {
    const needle = query().trim()

    const items = pipe(
      sync.data.provider,
      sortBy(
        (p) => p.id !== "opencode",
        (p) => p.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          sortBy(([_, info]) => info.name ?? ""),
          flatMap(([model, info]) => [
            {
              value: `${provider.id}/${model}`,
              title: info.name ?? model,
              category: provider.name,
              description: current() === `${provider.id}/${model}` ? "(current)" : undefined,
            },
          ]),
        ),
      ),
    )

    if (needle) {
      return fuzzysort.go(needle, items, { keys: ["title", "category"] }).map((x) => x.obj)
    }

    return items
  })

  async function onSelect(value: string) {
    try {
      await sdk.client.global.config.update({
        config: {
          experimental: { observer_model: value },
        },
      })
      toast.show({
        title: "Observer Model",
        message: `Set to ${value}`,
        variant: "success",
        duration: 2000,
      })
    } catch (err) {
      toast.show({
        title: "Observer Model",
        message: `Failed: ${err instanceof Error ? err.message : "unknown"}`,
        variant: "error",
        duration: 3000,
      })
    }
    // Don't close the dialog — let user keep selecting other models
  }

  return (
    <DialogSelect
      title="Observer Memory Model"
      options={options()}
      onSelect={(option) => onSelect(option.value)}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      current={current()}
    />
  )
}
